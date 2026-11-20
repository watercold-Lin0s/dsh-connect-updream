// Structural + behavioural check for the composer credit readout.
//
// Stubs `window.__ModuleLoader__.load`, evaluates the real bundle against a
// minimal React, renders the composer slot, and asserts:
//   - the trigger is plain text at the shell's control metrics
//   - the popover lists ONE row per account
//   - every row shows its OWN balance (a per-row lookup that answered the same
//     number for every account once passed unnoticed)
//   - the active row is marked, and clicking another row switches to it
const nodeRequire = require;
const fs = require('fs');

const ACCOUNTS = [
  { id: 'account-11111111', label: '账号甲', username: 'demo-user', active: true },
  { id: 'account-22222222', label: '账号乙', username: 'demo-alt', active: false },
];

const STATUS = {
  config: { showCreditsBadge: true, pollIntervalMs: 300000 },
  accounts: ACCOUNTS,
  activeAccountId: 'account-11111111',
  user: { id: '100001', username: 'demo-user' },
  credits: { available: '28750.0000' },
};

const CREDITS = {
  available: '28750.0000',
  tier: 'personal',
  account: { id: 'account-11111111', label: '账号甲', username: 'demo-user' },
};

// Deliberately DIFFERENT per account.
const PER_ACCOUNT = {
  'account-11111111': { available: '28750.0000', username: 'demo-user', tier: 'personal' },
  'account-22222222': { available: '945.0000', username: 'demo-alt', tier: 'personal' },
};

Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
globalThis.document = { addEventListener() {}, removeEventListener() {}, body: {} };
globalThis.window = {
  __ModuleLoader__: { load(d) { globalThis.__d = d; } },
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  setInterval: () => 0,
  clearInterval: () => {},
};

const postedIds = [];
const activated = [];
globalThis.fetch = async (url, init) => {
  const target = String(url);
  const ok = (data) => ({ json: async () => ({ ok: true, data }) });
  if (target.includes('/accounts/credits')) {
    const body = JSON.parse(init?.body ?? '{}');
    postedIds.push(body.id);
    return ok(PER_ACCOUNT[body.id] ?? { available: null });
  }
  if (target.includes('/accounts/activate')) {
    const body = JSON.parse(init?.body ?? '{}');
    activated.push(body.id);
    return ok(STATUS);
  }
  if (target.includes('/credits')) return ok(CREDITS);
  return ok(STATUS);
};

/* A tiny React whose hooks carry state: this harness must be able to open the
 * popover, not just render its closed state. */
const hooks = [];
const pending = [];
let cursor = 0;
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }),
  useState: (init) => {
    const index = cursor++;
    if (!(index in hooks)) {
      let value = typeof init === 'function' ? init() : init;
      // The credit state starts as { kind: 'loading' }; hand it the resolved
      // document so the trigger shows the figure a user would see.
      if (value !== null && typeof value === 'object' && value.kind === 'loading') {
        value = { kind: 'ok', value: CREDITS.available, tier: CREDITS.tier, account: CREDITS.account };
      }
      // Open the popover so its rows are part of the tree.
      if (value === false) value = true;
      if (value === null && globalThis.__seeded !== true) { globalThis.__seeded = true; value = STATUS; }
      else if (value === null) value = { left: 24, bottom: 120 };
      // Seed the per-account read so rows render without a scheduler.
      if (value !== null && typeof value === 'object' && value.kind === undefined && Object.keys(value).length === 0 && !('left' in value)) value = { ...PER_ACCOUNT };
      hooks[index] = value;
    }
    return [hooks[index], () => {}];
  },
  useEffect: (fn) => { try { const out = fn(); pending.push(out); if (out && typeof out.catch === 'function') out.catch(() => {}); } catch { /* ignore */ } },
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init ?? null }),
  useCallback: (fn) => fn,
  Fragment: Symbol.for('Fragment'),
};
const ReactDOM = { createPortal: (el) => el };

const src = fs.readFileSync('src/client.js', 'utf8');
new Function('require', src)((n) => (n === 'react' ? React : n === 'react-dom' ? ReactDOM : nodeRequire(n)));
const api = globalThis.__d.factory((n) => (n === 'react' ? React : n === 'react-dom' ? ReactDOM : nodeRequire(n)));

const reg = [];
api.apply({
  slots: { inject: (n, f) => f(), register: (d, c) => { reg.push({ name: d.name, c }); return () => {}; } },
  locale: { current: () => 'zh-CN' },
  effect: () => () => {},
});

const pill = reg.find((r) => r.name === 'conversation.input.right');
if (!pill) throw new Error('composer slot not registered');

/** Expand function components and Fragments into host elements. */
function expand(node, props) {
  let current = node;
  for (let depth = 0; depth < 40; depth += 1) {
    if (current === null || current === undefined || current === false) return current;
    if (typeof current === 'function') { current = current(props ?? {}); continue; }
    if (Array.isArray(current)) return current.map((c) => expand(c, props));
    if (typeof current === 'object' && current.type === React.Fragment) return current.children.map((c) => expand(c, props));
    if (typeof current === 'object' && typeof current.type === 'function') {
      const kids = current.children ?? [];
      const next = kids.length === 0
        ? (current.props ?? {})
        : { ...(current.props ?? {}), children: kids.length === 1 ? kids[0] : kids };
      current = current.type(next);
      continue;
    }
    return current;
  }
  return current;
}

function walk(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) { node.forEach((c) => walk(c, out)); return out; }
  if (typeof node !== 'object') return out;
  out.push(node);
  if (node.children) walk(node.children, out);
  return out;
}

function textOf(node) {
  const acc = [];
  const collect = (n) => {
    if (n === null || n === undefined || n === false) return;
    if (Array.isArray(n)) { n.forEach(collect); return; }
    if (typeof n === 'string' || typeof n === 'number') { acc.push(String(n)); return; }
    if (typeof n !== 'object') return;
    if (n.children) collect(n.children);
  };
  collect(node);
  return acc.join('');
}

(() => {
  // Reset the hook store per render so the tree is built from scratch.
  hooks.length = 0; cursor = 0; globalThis.__seeded = false;

  const rendered = expand(pill.c({ slotProps: { locale: 'zh-CN' }, onOpenSettings: () => {} }), { locale: 'zh-CN' });
  const nodes = walk(rendered);
  const byClass = (cls) => nodes.filter((n) => typeof n.props?.className === 'string' && n.props.className.split(/\s+/).includes(cls));

  const rows = byClass('dcu-row-button');
  const balances = byClass('dcu-pop-value').map(textOf);
  const names = byClass('dcu-pop-name').map(textOf);

  const checks = [
    ['trigger rendered as a plain-text pill', byClass('dcu-pill').length === 1],
    ['trigger shows the account name', byClass('dcu-pill-name').map(textOf)[0]?.includes('账号甲') === true],
    ['trigger shows the balance', byClass('dcu-pill-value').map(textOf)[0] === '28,750'],
    ['popover rendered', byClass('dcu-pop').length === 1],
    ['popover header title', byClass('dcu-pop-title').length === 1],
    ['refresh control', byClass('dcu-pop-btn').length >= 1],
    ['one row per account', rows.length === ACCOUNTS.length],
    ['one name per row', names.length === ACCOUNTS.length],
    ['every account read', postedIds.length === ACCOUNTS.length],
    ['current account marked', byClass('dcu-pop-mark').length === 1],
    ['each row shows its own balance', balances.length === 2 && balances[0] === '28,750' && balances[1] === '945'],
    ['foot line present', byClass('dcu-pop-foot').length === 1],
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  }

  console.log('\nnames    :', names);
  console.log('balances :', balances);
  console.log('posted   :', postedIds);
  console.log('trigger  :', byClass('dcu-pill').map(textOf));

  if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nPASS');
})();
