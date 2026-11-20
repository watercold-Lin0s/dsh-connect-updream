/**
 * Plugin configuration: the durable switches, plus the shape adapters that keep
 * malformed values from reaching upstream requests.
 *
 * Deliberately dependency-free. A locally installed bundle resolves its imports
 * from its own directory, not from the DSH installation, so importing the
 * loader's schema library here would make the plugin fail to load with
 * `ERR_MODULE_NOT_FOUND` on exactly the installs this plugin is meant for. The
 * Host hands `apply` whatever the profile's patch row carries — including
 * fields a hand-edit typo'd — so every value is normalized below before use.
 *
 * Secrets are NOT here: the API key lives in the credential vault, so a synced
 * or shared settings file never carries it.
 *
 * @module dsh-connect-updream/config
 */

/** Endpoint root used when the row names none. */
export const DEFAULT_BASE_URL = 'https://www.updream.cn/api';

/** Polling cadences the settings page offers, in milliseconds. */
export const POLL_INTERVALS = [60_000, 300_000, 600_000, 1_800_000, 3_600_000];

/** Default per-call wait budget for a generation task. */
export const DEFAULT_TASK_TIMEOUT_MS = 300_000;

/**
 * Ceiling for one task wait, whatever the config says.
 *
 * This is NOT the largest number the plugin could wait: the host kills any
 * tool call at 600 s, so a budget above that can never be honoured. Offering
 * one anyway would let the settings page promise a two-minute-longer wait than
 * the runtime can deliver, and the failure would arrive as the host's own
 * timeout with no task id attached. Kept at 570 s so our timeout always fires
 * first and can name the task.
 */
export const MAX_TASK_TIMEOUT_MS = 570_000;

/** Every field the plugin reads, with its default. */
const DEFAULTS = {
  baseURL: DEFAULT_BASE_URL,
  teamId: '',
  defaultProjectId: '',
  allowImageTools: false,
  allowVideoTools: false,
  allowTextTool: false,
  allowCanvasTools: false,
  allowProjectDelete: false,
  showCreditsBadge: false,
  pollIntervalMs: 300_000,
  imageModels: [],
  videoModels: [],
  textModels: [],
  taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
};

/** The switch fields, whose only legal values are booleans. */
const BOOLEAN_FIELDS = ['allowImageTools', 'allowVideoTools', 'allowTextTool', 'allowCanvasTools', 'allowProjectDelete', 'showCreditsBadge'];

/** The model-list fields, whose only legal values are arrays of id strings. */
const LIST_FIELDS = ['imageModels', 'videoModels', 'textModels'];

/**
 * Coerce one value into a finite number inside a range.
 * @param value - candidate.
 * @param min - inclusive floor.
 * @param max - inclusive ceiling.
 * @param fallback - used when the candidate is unusable or outside the range.
 * @returns the number to use.
 */
function clampNumber(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return fallback;
  return number;
}

/**
 * Normalize whatever the profile stored into a complete, safe configuration.
 * Unknown fields are dropped; a wrong type falls back to the default rather
 * than propagating into a request.
 * @param raw - the row's config, as handed to `apply`.
 * @returns a complete configuration.
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const config = { ...DEFAULTS };

  if (typeof source.baseURL === 'string' && source.baseURL.trim() !== '') config.baseURL = source.baseURL.trim();
  for (const field of ['teamId', 'defaultProjectId']) {
    if (typeof source[field] === 'string') config[field] = source[field].trim();
  }
  for (const field of BOOLEAN_FIELDS) {
    if (typeof source[field] === 'boolean') config[field] = source[field];
  }
  if (POLL_INTERVALS.includes(source.pollIntervalMs)) config.pollIntervalMs = source.pollIntervalMs;
  for (const field of LIST_FIELDS) {
    if (Array.isArray(source[field])) {
      config[field] = source[field].filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
    }
  }
  config.taskTimeoutMs = clampNumber(source.taskTimeoutMs, 10_000, MAX_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS);
  return config;
}

/**
 * Read the effective per-task wait budget.
 * @param config - a normalized configuration.
 * @returns milliseconds.
 */
export function taskTimeoutOf(config) {
  return clampNumber(config?.taskTimeoutMs, 10_000, MAX_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS);
}

/**
 * The enabled model list for one generation type, or `undefined` when the
 * switch means "every model in the catalog".
 * @param config - a normalized configuration.
 * @param kind - `image`, `video`, or `text`.
 * @returns the configured ids, or undefined for "no restriction".
 */
export function annotatedModels(config, kind) {
  const list = kind === 'image' ? config?.imageModels : kind === 'video' ? config?.videoModels : config?.textModels;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list.filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
}
