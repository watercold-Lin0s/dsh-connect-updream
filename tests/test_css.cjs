// Structural checks on the REWRITTEN stylesheet.
//
// The old suite asserted that this plugin's CSS was a byte-for-byte copy of
// dsh-connect-workbuddy's. That test was passing while the page it described
// rendered 293 dead rules, 16 undefined theme variables and an invisible
// primary button, so it is replaced by checks of what actually matters:
//
//   1. every --dsw-* variable used is a token the shell really registers
//   2. no var() relies on an inline fallback (a missing token must fail loudly)
//   3. no selector is defined twice
//   4. the stylesheet contains no backtick (it is embedded in a template literal)
//   5. every class the stylesheet styles is applied by client.js, and every
//      class client.js applies is styled (allowing the dynamic tone families)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* The tokens the running Client composition registers (cordis_inspect Theme). */
const REAL_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-brand-primary',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]);

/* Built from a template prefix at runtime, so they never appear verbatim. */
const DYNAMIC_OK = new Set(['dcu-badge-ok', 'dcu-badge-warn', 'dcu-badge-error', 'dcu-badge-brand', 'dcu-tab-on']);

const css = fs.readFileSync(path.join(ROOT, 'src', 'ui.css'), 'utf8');
const source = fs.readFileSync(path.join(ROOT, 'src', 'client.js'), 'utf8');

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n      ${detail}`}`);
  if (!ok) failed += 1;
};

/* 1. Undefined tokens. */
const used = [...new Set(css.match(/--dsw-[a-z0-9-]+/g) ?? [])];
const unknown = used.filter((token) => !REAL_TOKENS.has(token));
check(`every theme token is real (${used.length} used)`, unknown.length === 0, unknown.join(', '));

/* 2. No inline fallbacks. The old sheet had 11 of these; a fallback hides a
 *    renamed token by pinning one theme's colour into the other. */
const fallbacks = [...css.matchAll(/var\((--[a-z0-9-]+)\s*,/g)].map((m) => m[1]);
check('no var() carries an inline fallback', fallbacks.length === 0, fallbacks.join(', '));

/* 3. No duplicate selectors at the SAME nesting level. A selector repeated
 *    inside a @media block is a legitimate override, not a redefinition, so the
 *    check only looks at what sits outside any at-rule. */
const topLevel = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const selectors = [...topLevel.matchAll(/(?:\n|^)([^{}\n][^{}]*)\{/g)]
  .map((m) => m[1].trim())
  .filter((sel) => sel !== '' && !sel.startsWith('@') && !sel.startsWith('/*'));
const seen = new Map();
for (const sel of selectors) seen.set(sel, (seen.get(sel) ?? 0) + 1);
const duplicated = [...seen].filter(([, count]) => count > 1).map(([sel]) => sel);
check('no selector is defined twice', duplicated.length === 0, duplicated.join(' | '));

/* 4. No backtick — it would terminate the CSS template literal. */
check('stylesheet contains no backtick', !css.includes('`'));

/* 5. Class coverage both ways. */
const cssClasses = new Set([...css.matchAll(/\.(dcu-[a-z0-9-]+)/g)].map((m) => m[1]));
const jsClasses = new Set();
for (const m of source.matchAll(/['"`]([^'"`\n]*dcu-[a-z0-9 -]+[^'"`\n]*)['"`]/g)) {
  for (const token of m[1].split(/[\s${}]+/)) if (/^dcu-[a-z0-9-]+$/.test(token)) jsClasses.add(token);
}
const styled = [...cssClasses].filter((c) => !jsClasses.has(c) && !DYNAMIC_OK.has(c));
const unstyled = [...jsClasses].filter((c) => !cssClasses.has(c) && !DYNAMIC_OK.has(c));
check('no dead CSS classes', styled.length === 0, styled.join(', '));
check('no unstyled classes in use', unstyled.length === 0, unstyled.join(', '));

/* 6. Size guard: the old sheet was 146 KB / 556 rules, 79% of it unused. */
const rules = (css.match(/\{/g) ?? []).length;
check(`stylesheet stays lean (${rules} rules, ${(css.length / 1024).toFixed(1)} KB)`, rules < 200 && css.length < 45000);

/* 7. The primary button must not be built out of label colours. That is the
 *    exact defect that made 保存 invisible in the light theme. */
const brandRule = css.match(/\.dcu-btn-brand\{([^}]*)\}/)?.[1] ?? '';
check('primary button uses the brand token', brandRule.includes('--dsw-alias-brand-primary'));
check('primary button does not paint text with a background token', !/color:var\(--dsw-alias-bg-/.test(css));

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nPASS');
