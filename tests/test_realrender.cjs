// Render both slots with REAL React and fail if either comes out empty.
//
// This is the regression guard for a defect the fake-React harnesses could not
// see. A component declared as `fn(props, ...rest)` captures React's SECOND
// argument — a legacy context object — and any code that treats that object as
// a child makes React throw "Objects are not valid as a React child" (#31),
// which blanks the entire subtree. A hand-rolled React that renders plain
// objects as tags hides exactly this class of bug, so this check uses the real
// library: react-dom/server renders a tree synchronously, in-process, with no
// browser and no timing window.
//
// The UMD builds are vendored under tests/_p/ so the check runs offline.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;

function need(file, hint) {
  const full = path.join(HERE, '_p', file);
  if (!fs.existsSync(full)) {
    console.log(`skip  real-React render check (${file} missing — ${hint})`);
    process.exit(0);
  }
  return fs.readFileSync(full, 'utf8');
}

const reactSrc = need('react.js', 'run: curl -o tests/_p/react.js https://unpkg.com/react@18.3.1/umd/react.production.min.js');
const serverSrc = need('react-dom-server.js', 'run: curl -o tests/_p/react-dom-server.js https://unpkg.com/react-dom@18.3.1/umd/react-dom-server.browser.production.min.js');

/* Load React + react-dom/server into an isolated context, the way a page would. */
const sandbox = {
  console, setTimeout, clearTimeout, Promise, Symbol,
  // react-dom/server reaches for these; the vm context does not inherit them.
  TextEncoder, TextDecoder, URL, ArrayBuffer, Uint8Array,
};
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(reactSrc, sandbox, { filename: 'react.js' });
vm.runInContext(serverSrc, sandbox, { filename: 'react-dom-server.js' });

const React = sandbox.React;
const ReactDOMServer = sandbox.ReactDOMServer ?? sandbox.ReactDOM;
if (typeof React === 'undefined' || typeof ReactDOMServer?.renderToString !== 'function') {
  console.log('skip  real-React render check (vendored React did not expose renderToString)');
  process.exit(0);
}

/* The bundle, evaluated with the real React bound to `require`. */
const bundle = fs.readFileSync(path.join(HERE, '..', 'src', 'client.js'), 'utf8');

const STATUS = {
  connected: true,
  apiKeyConfigured: true,
  config: {
    baseURL: 'https://www.updream.cn/api', teamId: '', defaultProjectId: '',
    allowImageTools: true, allowVideoTools: true, allowTextTool: false,
    allowCanvasTools: true, allowProjectDelete: true, showCreditsBadge: true,
    pollIntervalMs: 300000, imageModels: ['qwen-image-3.0-pro'], videoModels: [], textModels: [],
  },
  accounts: [{ id: 'a1', label: '账号甲', username: 'demo-user', maskedKey: 'sk-…' }],
  activeAccountId: 'a1',
  user: { id: '100001', username: 'demo-user' },
  credits: { available: '28750.0000' },
  lastError: '',
};

globalThis.navigator = { language: 'zh-CN' };
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  body: {}, createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }),
};
globalThis.window = {
  __ModuleLoader__: { load(d) { globalThis.__d = d; } },
  innerWidth: 1440, innerHeight: 900,
  addEventListener() {}, removeEventListener() {},
  setInterval: () => 0, clearInterval: () => {},
};
globalThis.fetch = async (url) => {
  const target = String(url);
  const ok = (data) => ({ json: async () => ({ ok: true, data }) });
  if (target.includes('/accounts/credits')) return ok({ available: '28750.0000' });
  if (target.includes('/credits')) return ok({ available: '28750.0000', tier: 'personal', account: { label: '账号甲' } });
  return ok(STATUS);
};

const requireStub = (name) => {
  if (name === 'react') return React;
  if (name === 'react-dom') return { createPortal: (el) => el };
  return require(name);
};

let loadError = null;
try {
  new Function('require', bundle)(requireStub);
} catch (error) {
  loadError = error;
}

if (loadError !== null) {
  console.log('FAIL  bundle evaluates without throwing');
  console.error(`      ${loadError.message}`);
  process.exit(1);
}

const api = globalThis.__d.factory(requireStub);
const registry = [];
api.apply({
  slots: { inject: (n, f) => f(), register: (d, c) => { registry.push({ name: d.name, c }); return () => {}; } },
  locale: { getLocale: () => ({ id: 'zh-CN' }), getSnapshot: () => ({ id: 'zh-CN' }), subscribe: () => () => {} },
  effect: () => () => {},
});

/**
 * Render one slot to HTML. The component reads its data in an effect, so the
 * first pass shows the loading state; that is still a real render of real React
 * and is enough to prove the tree does not throw.
 */
function renderSlot(name, props) {
  const entry = registry.find((row) => row.name === name);
  if (entry === undefined) return { registered: false, html: '', error: null };
  try {
    const html = ReactDOMServer.renderToString(React.createElement(entry.c, props));
    return { registered: true, html, error: null };
  } catch (error) {
    return { registered: true, html: '', error };
  }
}

/**
 * Exercise every helper component DIRECTLY.
 *
 * The slot render above only reaches the loading skeleton, so the cards and the
 * composer popover are never built and a defect inside them would pass unseen.
 * That is precisely how the `...rest` bug shipped: the page rendered its
 * skeleton fine and blanked the moment real data arrived.
 */
const registryHelpers = api.__internals ?? {};
const helpers = ['Card', 'Badge', 'Switch', 'UpdreamLogo', 'RefreshIcon', 'GearIcon', 'StyleSheet'];
const helperResults = helpers.map((name) => {
  const fn = registryHelpers[name];
  if (typeof fn !== 'function') return { name, ok: false, reason: 'not exported for the test' };
  try {
    const html = ReactDOMServer.renderToString(React.createElement(fn, {
      title: 'probe', desc: 'probe', tone: 'brand', checked: false, onChange: () => {}, size: 16, spinning: false,
    }, React.createElement('span', null, 'child')));
    return { name, ok: true, html };
  } catch (error) {
    return { name, ok: false, reason: error.message };
  }
});

const settings = renderSlot('settings.section', { locale: 'zh-CN' });
const pill = renderSlot('conversation.input.right', { slotProps: { locale: 'zh-CN' }, onOpenSettings: () => {} });

const checks = [
  ['both slots registered', settings.registered && pill.registered],
  ['settings page renders without throwing', settings.error === null],
  // renderToString renders the FIRST pass only — the loading skeleton, before
  // the effect that fetches /status resolves. That is exactly what is wanted
  // for this assertion: it asks whether the slot renders at all. The cards are
  // covered separately below.
  ['settings page produces markup', settings.html.length > 50],
  ['settings page carries its root class', settings.html.includes('dcu-page')],
  ['composer slot renders without throwing', pill.error === null],
  // Every helper component, rendered directly with a child. This is the check
  // that would have caught the rest-parameter defect: Card receives a child and
  // must render it, not throw React error #31.
  ...helperResults.map((result) => [`${result.name} renders with a child`, result.ok]),
  ['no "Objects are not valid"', !/Objects are not valid as a React child/.test(
    String(settings.error) + String(pill.error) + helperResults.filter((r) => !r.ok).map((r) => r.reason).join(' '),
  )],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}

if (settings.error !== null) console.error(`\nsettings threw: ${settings.error.message}`);
if (pill.error !== null) console.error(`\npill threw: ${pill.error.message}`);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nsettings markup: ${settings.html.length} chars`);
console.log('PASS');
