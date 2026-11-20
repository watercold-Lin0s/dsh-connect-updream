/**
 * Offline checks for the CLI bridge: argument building and JSON envelope
 * parsing. No live CLI or account needed — a fake script stands in for it.
 *
 * Run: node tests/test_cli_bridge.mjs
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, cliBinary, CliError } from '../src/cli.js';

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
};

check(cliBinary({}) === 'updream', 'default binary resolves from PATH');
check(cliBinary({ cliPath: 'C:\\bin\\updream.exe' }) === 'C:\\bin\\updream.exe', 'explicit cliPath wins');

const dir = mkdtempSync(join(tmpdir(), 'dcu-cli-test-'));
const argvLog = join(dir, 'argv.log');
// A Node script used as the fake binary: runCli spawns `process.execPath` with
// this script as its first argument, so pass it through cliPath + args.
const fake = join(dir, 'fake-cli.mjs');
writeFileSync(fake, `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(argvLog)}, process.argv.slice(2).join(' '));
if (process.argv[2] === 'fail') {
  process.stdout.write(JSON.stringify({ schema: 'updream.cli/v1', ok: false, error: { code: 'AUTH_INVALID', message: 'bad key' } }));
  process.exit(3);
}
process.stdout.write(JSON.stringify({ schema: 'updream.cli/v1', ok: true, data: { task_id: 't-1' } }));
`);
// cliPath is the Node binary; the fake script is prepended to every command's
// argv by wrapping runCli below.
// runCli spawns cliPath with the given args. Use Node as the binary and the
// fake script as the first argument so this works on every platform.
const cfg = { cliPath: process.execPath, baseURL: 'https://example.test/api', teamId: '' };
const data = await runCli(cfg, [fake, 'task', 'get', 't-1'], { apiKey: 'sk-TEST', project: 'p1' });
check(data?.task_id === 't-1', 'parses ok envelope data');
const argv = readFileSync(argvLog, 'utf8');
check(argv.includes('--api-key sk-TEST'), 'passes API key as argument');
check(argv.includes('--project p1'), 'passes project id');
check(argv.includes('--base-url https://example.test/api'), 'passes configured base URL');

let caught;
try { await runCli(cfg, [fake, 'fail']); } catch (cause) { caught = cause; }
check(caught instanceof CliError, 'non-ok envelope throws CliError');
check(caught?.code === 'AUTH_INVALID' && caught?.status === 3, 'carries CLI error code and exit status');

rmSync(dir, { recursive: true, force: true });
if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nPASS');
