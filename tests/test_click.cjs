// Drive the composer pill's real click path with real React and a real DOM.
//
// The user sees the pill but clicking it does nothing, so the question is not
// "does it render" but "does the popover appear after a click". That requires an
// actual DOM with layout, because the panel is portaled to document.body and
// positioned from the trigger's measured rect.
//
// Uses happy-dom (a DOM implementation) plus the real React + ReactDOM from
// tests/_p, so the component mounts, runs its effects, and receives a genuine
// click event the way the app does.
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');

function load(file) {
  const full = path.join(HERE, '_p', file);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

const reactSrc = load('react.js');
const reactDomSrc = load('react-dom.js');
if (reactSrc === null || reactDomSrc === null) {
  console.log('skip  click check (tests/_p/react.js or react-dom.js missing)');
  process.exit(0);
}

let HappyDOM;
try {
  HappyDOM = require(path.join(ROOT, 'node_modules', 'happy-dom')).Window;
} catch {
  try {
    HappyDOM = require('happy-dom').Window;
  } catch {
    console.log('skip  click check (happy-dom not installed)');
    process.exit(0);
  }
}

(async () => {
  const window = new HappyDOM({ url: 'http://localhost/' });
  const { document } = window;

  globalThis.window = window;
  globalThis.document = document;
  globalThis.navigator = { language: 'zh-CN' };
  // Give the trigger a real, non-degenerate rect: the panel only renders once
  // the anchor measurement succeeds, and a zero rect is what a headless DOM
  // returns unless it is stubbed.
  const realRect = () => ({ left: 120, top: 600, right: 200, bottom: 624, width: 80, height: 24, x: 120, y: 600, toJSON() { return this; } });
  if (typeof window.Element.prototype.getBoundingClientRect !== 'function') {
    window.Element.prototype.getBoundingClientRect = realRect;
  } else {
    window.Element.prototype.getBoundingClientRect = realRect;
  }
  window.innerWidth = 1440;
  window.innerHeight = 900;

  const STATUS = {
    connected: true,
    config: { showCreditsBadge: true, pollIntervalMs: 300000 },
    accounts: [
      { id: 'a1', label: '账号甲', username: 'demo-user' },
      { id: 'a2', label: '账号乙', username: 'demo-alt' },
    ],
    activeAccountId: 'a1',
    credits: { available: '28750.0000' },
    user: { id: '100001', username: 'demo-user' },
    lastError: '',
  };

  /*
   * Per-account figures, deliberately far apart and DIFFERENT from the active
   * account's own balance. The reported bug was a popover where both rows showed
   * the same number (945) because a row borrowed the trigger's figure; a stub
   * that answered the same amount everywhere could never expose that.
   */
  const PER_ACCOUNT = {
    a1: { available: '24655.0000', username: 'demo-user', tier: 'personal' },
    a2: { available: '945.0000', username: 'demo-alt', tier: 'personal' },
  };

  let activeId = 'a1';
  const activations = [];

  globalThis.fetch = async (url, init) => {
    const t = String(url);
    const ok = (data) => ({ json: async () => ({ ok: true, data }) });
    if (t.includes('/accounts/activate')) {
      const body = JSON.parse(init?.body ?? '{}');
      activations.push(body.id);
      activeId = body.id;
      return ok({ ...STATUS, activeAccountId: activeId });
    }
    if (t.includes('/accounts/credits')) {
      const body = JSON.parse(init?.body ?? '{}');
      return ok(PER_ACCOUNT[body.id] ?? { available: null });
    }
    if (t.includes('/status')) {
      return ok({ ...STATUS, activeAccountId: activeId, credits: { available: PER_ACCOUNT[activeId].available } });
    }
    if (t.includes('/credits')) {
      return ok({ available: PER_ACCOUNT[activeId].available, tier: 'personal', account: { label: activeId === 'a1' ? '账号甲' : '账号乙' } });
    }
    return ok(STATUS);
  };

  // Load React and ReactDOM into this realm with the happy-dom globals in place.
  const run = (src, name) => {
    const fn = new Function('module', 'exports', 'require', 'window', 'document', 'self', src);
    const module = { exports: {} };
    fn(module, module.exports, (n) => {
      if (n === 'react') return window.React;
      throw new Error(`unexpected require: ${n}`);
    }, window, document, window);
    return module.exports;
  };

  window.__ModuleLoader__ = { load(d) { window.__loaded = d; } };

  const req = (n) => {
    if (n === 'react') return window.React;
    if (n === 'react-dom') return window.ReactDOM;
    return require(n);
  };

  // React's UMD needs a browser-ish global; bind it into the happy-dom window.
  // The UMD wrapper tests for `exports`/`module` first, so a CommonJS-shaped
  // caller makes it take that branch and it then calls require('react') — hand
  // it a resolver that returns the module already loaded there.
  const reactModule = { exports: {} };
  new Function('module', 'exports', 'require', 'window', 'self', 'document', reactSrc)(
    reactModule, reactModule.exports, (name) => {
      if (name === 'react') return reactModule.exports;
      throw new Error(`react build asked for ${name}`);
    }, window, window, document,
  );
  window.React = reactModule.exports;

  const reactDomModule = { exports: {} };
  new Function('module', 'exports', 'require', 'window', 'self', 'document', reactDomSrc)(
    reactDomModule, reactDomModule.exports, (name) => {
      if (name === 'react') return window.React;
      throw new Error(`react-dom build asked for ${name}`);
    }, window, window, document,
  );
  window.ReactDOM = reactDomModule.exports;

  const React = window.React;
  const ReactDOM = window.ReactDOM;
  if (typeof React?.createElement !== 'function' || typeof ReactDOM?.createRoot !== 'function') {
    console.log('skip  click check (React/ReactDOM did not initialise in happy-dom)');
    process.exit(0);
  }

  // Evaluate the plugin bundle.
  const bundle = fs.readFileSync(path.join(ROOT, 'src', 'client.js'), 'utf8');
  new Function('require', bundle)(req);
  const api = window.__loaded.factory(req);

  const registry = [];
  api.apply({
    slots: { inject: (n, f) => f(), register: (d, c) => { registry.push({ name: d.name, c }); return () => {}; } },
    locale: { getLocale: () => ({ id: 'zh-CN' }), getSnapshot: () => ({ id: 'zh-CN' }) },
    effect: () => () => {},
  });

  const slot = registry.find((r) => r.name === 'conversation.input.right');
  if (slot === undefined) { console.error('FAIL  composer slot not registered'); process.exit(1); }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  root.render(React.createElement(slot.c, { slotProps: { locale: 'zh-CN' }, onOpenSettings: () => {} }));

  const settle = async (ms = 60) => { await new Promise((r) => setTimeout(r, ms)); };
  await settle(120);

  const trigger = host.querySelector('.dcu-pill');
  const pillRendered = trigger !== null;
  const panelBefore = document.querySelectorAll('.dcu-pop').length;

  /*
   * The pill must arrive STYLED. Without its stylesheet it renders as the
   * browser's default button — grey fill, white text, no gap — which is exactly
   * how it looked in the reported screenshot while still mounting correctly in
   * a DOM test. happy-dom cannot do layout, but it does expose a <style> node
   * and the class names, so the check is that the sheet is present and that the
   * trigger carries the class the sheet targets.
   */
  const styleText = Array.from(document.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n');
  const styled = styleText.includes('.dcu-pill') && styleText.includes('.dcu-pop');

  /*
   * Dispatch the FULL native sequence, not just `click`.
   *
   * A browser sends pointerdown -> mousedown -> mouseup -> click. The component
   * closes on `mousedown` outside the trigger, captured on document. Testing
   * only `click` hides every interaction between those two listeners, which is
   * exactly the class of bug where "clicking does nothing".
   */
  if (trigger !== null) {
    const sequence = [];
    if (typeof window.PointerEvent === 'function') {
      sequence.push(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    }
    sequence.push(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    sequence.push(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    sequence.push(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    for (const event of sequence) trigger.dispatchEvent(event);
  }
  await settle(150);

  const panelAfter = document.querySelectorAll('.dcu-pop').length;
  const popover = document.querySelector('.dcu-pop');
  const panelHtml = popover?.innerHTML ?? '';

  /* Each row must show its OWN balance: 24,655 for 账号甲, 945 for 账号乙. */
  const rowValues = Array.from(popover?.querySelectorAll('.dcu-pop-value') ?? []).map((n) => n.textContent.trim());
  const rowNames = Array.from(popover?.querySelectorAll('.dcu-pop-name') ?? []).map((n) => n.textContent.trim());

  /*
   * Now switch account the way the user did: click the row for the account that
   * is NOT active, and assert the pill follows the Host afterwards.
   */
  const targetRow = Array.from(popover?.querySelectorAll('.dcu-row-button') ?? [])
    .find((row) => (row.textContent ?? '').includes('账号乙'));
  if (targetRow !== undefined) {
    targetRow.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    targetRow.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    targetRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  await settle(200);

  const pillText = host.querySelector('.dcu-pill')?.textContent ?? '';

  const checks = [
    ['pill renders in the composer slot', pillRendered],
    // The regression that produced the screenshot: the pill mounted but its
    // stylesheet was never rendered, so it looked like a raw default button and
    // the popover had no fixed positioning.
    ['pill carries the stylesheet', styled],
    ['no popover before the click', panelBefore === 0],
    ['popover mounts after a full click sequence', panelAfter === 1],
    ['popover lists both accounts', rowNames.length === 2],
    // THE REPORTED BUG: both rows showed 945 (the active account's figure).
    ['row 账号甲 shows its own 24,655', rowValues[0] === '24,655'],
    ['row 账号乙 shows its own 945', rowValues[1] === '945'],
    ['rows do not share one figure', new Set(rowValues).size === rowValues.length],
    ['popover positioned off the trigger', /left:\s*\d+px/.test(popover?.outerHTML ?? '')],
    // The panel is portaled to <body>, so without `position: fixed` the inline
    // left/bottom are ignored and it lands in normal flow at the end of the
    // document — mounted but nowhere near the trigger.
    ['popover is fixed-positioned', /position:\s*fixed/.test(styleText)],
    // Switching must reach the Host, and the pill must then name/price the NEW
    // account instead of keeping the one it started on.
    ['switching posts the activation', activations.includes('a2')],
    ['pill follows the new account', pillText.includes('账号乙') && pillText.includes('945')],
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`\npanels: before=${panelBefore} after=${panelAfter}, accounts in panel=${(panelHtml.match(/dcu-row-button/g) ?? []).length}`);

  if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nPASS');
  // The component polls on an interval; exit explicitly or node waits on it.
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
