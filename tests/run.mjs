/**
 * Test entry point: every check this plugin can run without a live account.
 *
 * `tests/test_project_delete.mjs` is deliberately NOT here: it deletes a real
 * project and needs an API key and a project id, so it stays a manual script
 * (`node tests/test_project_delete.mjs <api-key> <project-id>`).
 *
 * Run: node tests/run.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Cheap, hermetic checks. Order is stable so output is diffable. */
const SUITES = [
  ['tool definitions', 'test_tool_definitions.mjs'],
  ['config normalization', 'test_config.mjs'],
  ['CLI bridge', 'test_cli_bridge.mjs'],
  ['composer readout', 'test_composer_readout.cjs'],
  ['stylesheet quality', 'test_css.cjs'],
  // Real React, in-process: the only check that can see a component throwing
  // "Objects are not valid as a React child", which blanks the whole page.
  ['real-React render', 'test_realrender.cjs'],
  // A real DOM plus real React: proves the pill's click actually mounts the
  // popover, which a static render cannot show.
  ['composer click opens popover', 'test_click.cjs'],
];

let failed = 0;
for (const [label, file] of SUITES) {
  process.stdout.write(`\n=== ${label} (${file}) ===\n`);
  const result = spawnSync(process.execPath, [join(here, file)], {
    stdio: 'inherit',
    cwd: join(here, '..'),
    timeout: 120_000,
  });
  if (result.status !== 0) {
    failed += 1;
    process.stdout.write(`--- ${label}: FAILED (exit ${String(result.status ?? result.signal)})\n`);
  }
}

if (failed > 0) {
  console.error(`\n${String(failed)} suite(s) failed`);
  process.exit(1);
}
console.log('\nAll suites passed.');
