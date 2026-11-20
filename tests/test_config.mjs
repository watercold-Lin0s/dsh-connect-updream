/**
 * Config normalization: the guard between a hand-edited profile row and an
 * outbound request.
 *
 * The `cordis.patch.yml` row is user-editable, so every value reaching this
 * module is untrusted: a typo'd string where a boolean belongs, a model list
 * holding nulls, a poll interval that does not match the offered set. Each of
 * those must degrade to the default rather than propagate — a `pollIntervalMs`
 * of 1000 would turn a display refresh into a rate-limited poll, and a
 * non-string in `imageModels` would be sent upstream as a model id.
 *
 * Run: node tests/test_config.mjs
 */
import {
  DEFAULT_BASE_URL,
  DEFAULT_TASK_TIMEOUT_MS,
  MAX_TASK_TIMEOUT_MS,
  POLL_INTERVALS,
  annotatedModels,
  normalizeConfig,
  taskTimeoutOf,
} from '../src/config.js';

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
};
const eq = (actual, expected, label) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(ok, `${label}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
};

/* --- defaults ------------------------------------------------------- */

const empty = normalizeConfig(undefined);
eq(empty.baseURL, DEFAULT_BASE_URL, 'undefined raw gives the default base URL');
eq(empty.taskTimeoutMs, DEFAULT_TASK_TIMEOUT_MS, 'undefined raw gives the default task timeout');
for (const field of ['allowImageTools', 'allowVideoTools', 'allowTextTool', 'allowCanvasTools', 'allowProjectDelete', 'showCreditsBadge']) {
  eq(empty[field], false, `${field} defaults to false (nothing spends before the user opts in)`);
}
for (const field of ['imageModels', 'videoModels', 'textModels']) {
  eq(empty[field], [], `${field} defaults to an empty list`);
}
eq(empty.teamId, '', 'teamId defaults to empty');

// A non-object row (null, a string, an array) must not throw: the plugin is
// expected to mount with a valid default rather than fail the whole profile.
for (const raw of [null, 'nope', 42, [], true]) {
  let ok = true;
  try {
    const config = normalizeConfig(raw);
    ok = config.baseURL === DEFAULT_BASE_URL;
  } catch {
    ok = false;
  }
  check(ok, `raw ${JSON.stringify(raw)} is tolerated and yields defaults`);
}

/* --- type coercion -------------------------------------------------- */

// A wrong type falls back to the default rather than reaching a request.
eq(normalizeConfig({ allowImageTools: 'true' }).allowImageTools, false, 'string "true" is not accepted as a boolean');
eq(normalizeConfig({ allowImageTools: 1 }).allowImageTools, false, 'number 1 is not accepted as a boolean');
eq(normalizeConfig({ allowCanvasTools: true }).allowCanvasTools, true, 'a real boolean is kept');

// Strings are trimmed, and a blank one does not blank out the base URL.
eq(normalizeConfig({ baseURL: '  https://example.test/api  ' }).baseURL, 'https://example.test/api', 'baseURL is trimmed');
eq(normalizeConfig({ baseURL: '   ' }).baseURL, DEFAULT_BASE_URL, 'a blank baseURL falls back to the default');
eq(normalizeConfig({ teamId: '  team-9  ' }).teamId, 'team-9', 'teamId is trimmed');

/* --- poll interval: a closed set ------------------------------------ */

for (const interval of POLL_INTERVALS) {
  eq(normalizeConfig({ pollIntervalMs: interval }).pollIntervalMs, interval, `pollIntervalMs ${String(interval)} is accepted`);
}
// Anything outside the offered set must not become a live timer.
for (const interval of [0, 1000, 5000, 365 * 24 * 3600 * 1000, -60000, 'nope', 60000.5]) {
  eq(normalizeConfig({ pollIntervalMs: interval }).pollIntervalMs, 300_000, `pollIntervalMs ${JSON.stringify(interval)} is rejected`);
}

/* --- task timeout: clamped, never above the host cap ---------------- */

eq(normalizeConfig({ taskTimeoutMs: 60_000 }).taskTimeoutMs, 60_000, 'a valid task timeout is kept');
eq(normalizeConfig({ taskTimeoutMs: 5_000 }).taskTimeoutMs, DEFAULT_TASK_TIMEOUT_MS, 'below the floor falls back');
eq(normalizeConfig({ taskTimeoutMs: 900_000 }).taskTimeoutMs, DEFAULT_TASK_TIMEOUT_MS, 'above the ceiling falls back');
eq(normalizeConfig({ taskTimeoutMs: 'x' }).taskTimeoutMs, DEFAULT_TASK_TIMEOUT_MS, 'a non-number falls back');
check(MAX_TASK_TIMEOUT_MS < 600_000, 'the task ceiling stays below the host tool cap');

// Strings that look numeric are accepted, because a hand-edited YAML row may
// quote them; the value is what matters, not the quoting.
eq(normalizeConfig({ taskTimeoutMs: '120000' }).taskTimeoutMs, 120_000, 'a numeric string is coerced');
eq(taskTimeoutOf(undefined), DEFAULT_TASK_TIMEOUT_MS, 'taskTimeoutOf(undefined) is the default');
eq(taskTimeoutOf({ taskTimeoutMs: 900_000 }), DEFAULT_TASK_TIMEOUT_MS, 'taskTimeoutOf clamps an over-cap value');

/* --- model lists ---------------------------------------------------- */

eq(normalizeConfig({ imageModels: [' a ', 'b', '', null, 7] }).imageModels, ['a', 'b'], 'model ids are trimmed and non-strings dropped');
eq(normalizeConfig({ imageModels: 'not-a-list' }).imageModels, [], 'a non-array model list becomes empty');

// `annotatedModels` returns undefined for "no restriction", which is different
// from an empty list: undefined means every catalog model is eligible.
eq(annotatedModels({ imageModels: [] }, 'image'), undefined, 'an empty list means "no restriction"');
eq(annotatedModels({ imageModels: ['m1'] }, 'image'), ['m1'], 'a populated list is returned');
eq(annotatedModels({}, 'video'), undefined, 'a missing list means "no restriction"');
eq(annotatedModels({ imageModels: ['m1'] }, 'video'), undefined, 'each kind reads its own list');

if (failed > 0) {
  console.error(`\n${String(failed)} check(s) failed`);
  process.exit(1);
}
console.log('\nPASS');
