// Render the plugin's UI from the REAL bundle and the REAL CSS.
//
// The bundle is evaluated against a small React implementation whose hooks
// really behave: setState re-renders, effects run, promises settle, and the
// render loop repeats until the tree stops changing. The markup this emits is
// therefore what a user actually sees — the previous preview generator
// hand-copied the markup, which is exactly how the layout bugs it was meant to
// catch stayed invisible.
//
// Usage: node tests/make_preview.cjs <out.html> [dark|light] [settings|pill]
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'tests/_p/preview.html';
const THEME = process.argv[3] === 'light' ? 'light' : 'dark';
const WHICH = process.argv[4] === 'pill' ? 'pill' : 'settings';
const TAB = process.argv[5] || 'accounts';

const fixture = require('./fixtures.cjs');

/* -------------------------------------------------------------------- */
/* Minimal React with real state, effects and an async settle loop      */
/* -------------------------------------------------------------------- */

function createRuntime() {
  // Hook state is keyed by `componentName#occurrence:hookIndex`. The component
  // tree is stable between passes, so a key always identifies the same hook and
  // state survives a re-render the way React's does. Without this the settings
  // page re-mounted on every pass and stayed on its "loading" skeleton forever.
  const slots = [];
  let cursor = 0;
  let dirty = false;
  const ranEffects = new Set();
  const occurrences = new Map();

  const isFn = (v) => typeof v === 'function';

  function keyFor() {
    return `${globalThis.__compKey}:${cursor++}`;
  }

  function useState(init) {
    const key = keyFor();
    if (!(key in slots)) {
      let seed = isFn(init) ? init() : init;
      // Preview hook: let the harness open a tab other than 'accounts' without
      // synthesising a DOM click.
      if (seed === 'accounts' && typeof globalThis.__seedTab === 'string' && globalThis.__seedTab !== 'accounts') {
        seed = globalThis.__seedTab;
      }
      // Preview hook: seed the model catalogue and project list, which the page
      // only fills after an explicit "refresh" click. Without this the models
      // tab renders permanently empty and its layout is unverifiable.
      if (seed !== null && typeof seed === 'object' && 'image' in seed && Array.isArray(seed.image)) {
        seed = { ...fixture.MODELS };
      }
      if (Array.isArray(seed) && seed.length === 0 && globalThis.__seedProjects === true) {
        seed = [...fixture.PROJECTS];
      }
      // Preview hook: open the composer popover. `open` seeds false and
      // `position` seeds null; once open is flipped, position must be a real
      // rect or the portal renders nothing.
      if (seed === false && globalThis.__seedOpen === true && globalThis.__sawOpen !== true) {
        globalThis.__sawOpen = true;
        seed = true;
      } else if (seed === null && globalThis.__sawOpen === true && globalThis.__seedOpen === true) {
        seed = { left: 24, bottom: 120 };
      }
      slots[key] = { value: seed, set: null };
    }
    const slot = slots[key];
    if (slot.set === null) {
      slot.set = (next) => {
        const value = isFn(next) ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        dirty = true;
      };
    }
    return [slot.value, slot.set];
  }
  const useRef = (init) => { const key = keyFor(); if (!(key in slots)) slots[key] = { ref: { current: init } }; return slots[key].ref; };
  const useMemo = (fn) => { cursor++; return fn(); };
  const useCallback = (fn) => { cursor++; return fn; };
  const useEffect = (fn) => { cursor++; pendingEffects.push(fn); };
  let pendingEffects = [];

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== true && c !== false && c !== null && c !== undefined) }),
    useState, useEffect, useMemo, useRef, useCallback,
    Fragment: Symbol.for('React.Fragment'),
    createPortal: (el) => el,
  };

  /** Expand function components and Fragments into host elements. */
  function expand(node) {
    let current = node;
    for (let depth = 0; depth < 80; depth += 1) {
      if (current === null || current === undefined || current === false) return null;
      if (Array.isArray(current)) return current.map(expand).filter(Boolean);
      if (typeof current !== 'object') return String(current);
      if (current.type === React.Fragment) return (current.children ?? []).map(expand).filter(Boolean);
      if (isFn(current.type)) {
        const name = current.type.name || 'anon';
        const seen = (occurrences.get(name) ?? 0);
        occurrences.set(name, seen + 1);
        const savedKey = globalThis.__compKey;
        const savedCursor = cursor;
        globalThis.__compKey = `${name}#${seen}`;
        cursor = 0;
        // React hands positional children to a component inside props.children;
        // a component that reads props.children would otherwise render empty.
        const kids = current.children ?? [];
        const childProps = kids.length === 0
          ? current.props ?? {}
          : { ...(current.props ?? {}), children: kids.length === 1 ? kids[0] : kids };
        const out = current.type(childProps);
        globalThis.__compKey = savedKey;
        cursor = savedCursor;
        current = out;
        continue;
      }
      return { type: current.type, props: current.props ?? {}, children: (current.children ?? []).map(expand).filter(Boolean) };
    }
    return null;
  }

  function walk(node, out = []) {
    if (node === null || node === undefined || node === false) return out;
    if (Array.isArray(node)) { node.forEach((c) => walk(c, out)); return out; }
    if (typeof node !== 'object') return out;
    out.push(node);
    if (node.children) walk(node.children, out);
    return out;
  }

  async function renderStable(component, props) {
    let html = '';
    let tree = null;
    for (let pass = 0; pass < 60; pass += 1) {
      cursor = 0; dirty = false; pendingEffects = []; occurrences.clear();
      tree = expand({ type: component, props: props ?? {}, children: [] });
      html = toHtml(tree);
      // Each effect runs once at mount, like React's dependency-free effect.
      // Re-running them every pass would re-fire the network reads forever.
      for (const fn of pendingEffects) {
        const key = `${pass}`;
        if (ranEffects.has(fn)) continue;
        ranEffects.add(fn);
        try { fn(); } catch { /* ignore */ }
        void key;
      }
      // Let the promises those effects started settle before re-rendering.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      if (!dirty) break;
    }
    return { tree, html, nodes: walk(tree) };
  }

  function toHtml(node) {
    if (node === null || node === undefined || node === false) return '';
    if (Array.isArray(node)) return node.map(toHtml).join('');
    if (typeof node === 'string' || typeof node === 'number') return esc(String(node));
    if (typeof node !== 'object') return '';
    const { type, props, children } = node;
    const attrs = Object.entries(props ?? {})
      .filter(([k, v]) => v !== undefined && v !== null && v !== false && !k.startsWith('on') && k !== 'children' && k !== 'key' && k !== 'ref')
      .map(([k, v]) => {
        if (k === 'style' && typeof v === 'object') return ` style="${escAttr(Object.entries(v).map(([p, val]) => `${camelToKebab(p)}:${val}`).join(';'))}"`;
        if (k === 'className') return ` class="${escAttr(String(v))}"`;
        return ` ${k}="${escAttr(String(v))}"`;
      }).join('');
    if (type === 'input' || type === 'br' || type === 'img') {
      const v = type === 'input' && typeof props.value === 'string' ? ` value="${escAttr(props.value)}"` : '';
      return `<${type}${attrs}${v}>`;
    }
    return `<${type}${attrs}>${(children ?? []).map(toHtml).join('')}</${type}>`;
  }

  return { React, ReactDOM: { createPortal: (el) => el }, renderStable, walk };
}

const camelToKebab = (n) => n.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* -------------------------------------------------------------------- */
/* Load the bundle                                                      */
/* -------------------------------------------------------------------- */

function loadBundle(rt) {
  globalThis.navigator = { language: 'zh-CN' };
  globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    get body() { return globalThis.document.__b ?? (globalThis.document.__b = {}); },
    createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }),
  };
  globalThis.window = {
    __ModuleLoader__: { load(d) { globalThis.__d = d; } },
    innerWidth: 1440, innerHeight: 900,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 0, clearInterval: () => {},
  };
  globalThis.fetch = fixture.fetch;

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'client.js'), 'utf8');
  const req = (n) => (n === 'react' ? rt.React : n === 'react-dom' ? rt.ReactDOM : require(n));
  new Function('require', source)(req);
  const api = globalThis.__d.factory(req);

  const registry = [];
  api.apply({
    slots: { inject: (n, f) => f(), register: (d, c) => { registry.push({ name: d.name, c }); return () => {}; } },
    locale: { current: () => 'zh-CN' },
    effect: () => () => {},
  });
  return registry;
}

/* -------------------------------------------------------------------- */
/* Main                                                                 */
/* -------------------------------------------------------------------- */

(async () => {
  const rt = createRuntime();
  const registry = loadBundle(rt);
  const want = WHICH === 'pill' ? 'conversation.input.right' : 'settings.section';
  const entry = registry.find((r) => r.name === want);
  if (!entry) throw new Error(`${want} not registered`);

  // The active tab is component state seeded to 'accounts'. To preview another
  // tab, pre-seed that hook: `__seedTab` makes the first useState('accounts')
  // call return the wanted value, which is exactly what a user's click does.
  globalThis.__seedTab = TAB;
  globalThis.__seedOpen = process.env.PREVIEW_OPEN === '1';

  const props = WHICH === 'pill'
    ? { slotProps: { locale: 'zh-CN' }, onOpenSettings: () => {} }
    : { locale: 'zh-CN' };

  const { html } = await rt.renderStable(entry.c, props);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'client.js'), 'utf8');
  const cssMatch = source.match(/const CSS = `([\s\S]*?)`;/);
  if (!cssMatch) throw new Error('CSS template literal not found');

  const tokens = THEME === 'light' ? fixture.LIGHT_TOKENS : fixture.DARK_TOKENS;
  const tokenCss = Object.entries(tokens).map(([k, v]) => `  ${k}:${v};`).join('\n');

  const page = `<!doctype html>
<html lang="zh" data-theme="${THEME}"><head><meta charset="utf-8">
<title>Updream UI · ${WHICH} · ${THEME}</title>
<style>
:root{
${tokenCss}
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.shell{width:${WHICH === 'pill' ? 640 : 800}px;margin:0 auto;padding:28px 24px 56px}
${cssMatch[1]}
</style></head>
<body><div class="shell">${html}</div></body></html>`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, page);
  console.log(`wrote ${OUT} (${(page.length / 1024).toFixed(0)} KB, ${WHICH}, ${THEME})`);
})().catch((error) => { console.error(error); process.exit(1); });
