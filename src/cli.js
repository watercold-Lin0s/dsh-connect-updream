/**
 * Updream CLI bridge: the single execution layer of this plugin.
 *
 * Every Updream operation goes through the `updream` binary. The CLI owns the
 * request shapes, the default generation parameters, the version gate and the
 * idempotency rules, so this module stays deliberately thin: spawn, pass the
 * active key and project, parse the `{schema, ok, data|error}` envelope.
 *
 * The one exception is project deletion — the CLI has no `project delete`
 * command — which is why `upstream.js` is still shipped for that single call.
 *
 * @module dsh-connect-updream/cli
 */

import { spawn } from 'node:child_process';

/** Resolve the CLI binary. An explicit path wins; otherwise use PATH. */
export function cliBinary(config) {
  const configured = String(config?.cliPath ?? '').trim();
  return configured === '' ? 'updream' : configured;
}

/**
 * Run one CLI command and return its `data` payload.
 *
 * @param config - plugin config (cliPath, baseURL, teamId).
 * @param args - command arguments, without the binary name.
 * @param options - `apiKey`, `project`, `signal`, `stdin`, `timeoutMs`.
 * @returns the `data` field of the CLI's JSON envelope.
 * @throws CliError on a non-zero exit or `ok:false` envelope.
 */
export async function runCli(config, args, options = {}) {
  const binary = cliBinary(config);
  const argv = [...args];
  if (String(config?.baseURL ?? '').trim() !== '') argv.push('--base-url', String(config.baseURL).trim());
  if (String(config?.teamId ?? '').trim() !== '') argv.push('--team', String(config.teamId).trim());
  if (typeof options.project === 'string' && options.project !== '') argv.push('--project', options.project);
  if (typeof options.apiKey === 'string' && options.apiKey !== '') argv.push('--api-key', options.apiKey);

  const timeoutMs = Number(options.timeoutMs) || 120_000;
  const result = await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (cause) {
      reject(new CliError(`无法启动 updream CLI：${cause?.message ?? cause}`, { code: 'CLI_UNAVAILABLE' }));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new CliError(`updream CLI 超时（${argv.slice(0, 3).join(' ')}）`, { code: 'CLI_TIMEOUT' }));
    }, timeoutMs);
    const onAbort = () => {
      child.kill();
      finish(reject, new CliError('updream CLI 调用已取消', { code: 'ABORTED' }));
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (cause) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      finish(reject, new CliError(
        cause?.code === 'ENOENT'
          ? '找不到 updream CLI：请安装并把 updream 放进 PATH，或在设置里指定绝对路径'
          : `无法运行 updream CLI：${cause?.message ?? cause}`,
        { code: 'CLI_UNAVAILABLE' },
      ));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      finish(resolve, { code, stdout, stderr });
    });
    if (typeof options.stdin === 'string') child.stdin.end(options.stdin);
    else child.stdin.end();
  });

  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' ');
    throw new CliError(`updream CLI 返回了非 JSON 输出（exit ${result.code}）：${detail || '(空)'}`, {
      code: 'CLI_BAD_OUTPUT', status: result.code ?? 0,
    });
  }

  if (envelope?.ok === false || result.code !== 0) {
    const error = envelope?.error ?? {};
    throw new CliError(error.message || `updream CLI 失败（exit ${result.code}）`, {
      code: error.code ?? 'CLI_ERROR',
      status: error.http_status ?? result.code ?? 0,
      backendCode: error.details?.backend_code ?? '',
      data: error.data ?? envelope?.data,
    });
  }
  return envelope?.data;
}

/** An error reported by the CLI, carrying its code and any partial data. */
export class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliError';
    this.code = options.code ?? 'CLI_ERROR';
    this.status = options.status ?? 0;
    this.backendCode = options.backendCode ?? '';
    this.data = options.data;
  }
}

/**
 * Save a key into the CLI's own config (`~/.updream/cli.json`, 0600).
 * The key is passed on stdin so it never enters the shell history or argv.
 */
export async function cliLogin(config, apiKey) {
  await runCli(config, ['auth', 'login', '--api-key', '-'], {
    apiKey: '', stdin: apiKey, timeoutMs: 90_000,
  });
}

/** Read the CLI's current identity, credits and config paths. */
export function cliStatus(config, apiKey) {
  return runCli(config, ['auth', 'status'], { apiKey, timeoutMs: 60_000 });
}

/* ------------------------------------------------------------------ */
/* Command helpers — one per CLI command the plugin uses.              */
/* ------------------------------------------------------------------ */

export const cli = {
  projects: (cfg, key, { size = 100, search, signal } = {}) =>
    runCli(cfg, ['project', 'list', '--size', String(size), ...(search ? ['--search', search] : [])], { apiKey: key, signal }),
  projectUse: (cfg, key, projectId, signal) =>
    runCli(cfg, ['project', 'use', projectId], { apiKey: key, signal }),
  canvas: (cfg, key, projectId, { full = false, signal } = {}) =>
    runCli(cfg, ['canvas', 'inspect', projectId, ...(full ? ['--full'] : [])], { apiKey: key, signal, timeoutMs: 180_000 }),
  nodeGet: (cfg, key, id, { full = false, signal } = {}) =>
    runCli(cfg, ['node', 'get', id, ...(full ? ['--full'] : [])], { apiKey: key, signal }),
  nodeCreate: (cfg, key, projectId, fields, signal) =>
    runCli(cfg, [
      'node', 'create', '--type', fields.type,
      ...fields.title ? ['--title', String(fields.title)] : [],
      ...fields.prompt ? ['--prompt', String(fields.prompt)] : [],
      ...fields.model ? ['--model', String(fields.model)] : [],
      ...fields.x !== undefined ? ['--x', String(fields.x)] : [],
      ...fields.y !== undefined ? ['--y', String(fields.y)] : [],
      ...fields.ratio ? ['--ratio', String(fields.ratio)] : [],
    ], { apiKey: key, project: projectId, signal }),
  nodeUpdate: (cfg, key, id, fields, signal) =>
    runCli(cfg, [
      'node', 'update', id,
      ...fields.title !== undefined ? ['--title', String(fields.title)] : [],
      ...fields.prompt !== undefined ? ['--prompt', String(fields.prompt)] : [],
      ...fields.model !== undefined ? ['--model', String(fields.model)] : [],
      ...fields.x !== undefined ? ['--x', String(fields.x)] : [],
      ...fields.y !== undefined ? ['--y', String(fields.y)] : [],
    ], { apiKey: key, signal }),
  nodeDelete: (cfg, key, id, projectId, signal) =>
    runCli(cfg, ['node', 'delete', id], { apiKey: key, project: projectId, signal }),
  connect: (cfg, key, projectId, from, to, signal) =>
    runCli(cfg, ['connection', 'add', '--from', String(from), '--to', String(to)], { apiKey: key, project: projectId, signal }),
  disconnect: (cfg, key, id, signal) =>
    runCli(cfg, ['connection', 'remove', String(id)], { apiKey: key, signal }),
  upload: (cfg, key, projectId, file, type, signal) =>
    runCli(cfg, ['asset', 'upload', file, ...(type ? ['--type', type] : [])], {
      apiKey: key, project: projectId, signal, timeoutMs: 180_000,
    }),
  models: (cfg, key, type, signal) =>
    runCli(cfg, ['model', 'list', '--type', type], { apiKey: key, signal }),
  /**
   * Submit a generation. `--wait` is deliberately not used: the host kills a
   * tool call at 600 s, so we submit, learn the task id, and let `updream_task`
   * continue polling in later calls instead of losing the id on timeout.
   */
  generate: (cfg, key, projectId, kind, { prompt, model, node, newTitle, params = {} }, signal) =>
    runCli(cfg, [
      'generate', kind, '--prompt', String(prompt), '--model', String(model),
      ...node ? ['--node', String(node)] : [],
      ...newTitle ? ['--new-node', '--title', String(newTitle)] : [],
      ...Object.entries(params).flatMap(([k, v]) => ['--param', `${k}=${JSON.stringify(v)}`]),
    ], { apiKey: key, project: projectId, signal, timeoutMs: 180_000 }),
  task: (cfg, key, taskId, signal) =>
    runCli(cfg, ['task', 'get', String(taskId)], { apiKey: key, signal }),
  taskWait: (cfg, key, taskId, seconds, signal) =>
    runCli(cfg, ['task', 'wait', String(taskId), '--timeout', `${Math.max(5, Math.min(500, seconds))}s`], {
      apiKey: key, signal, timeoutMs: Math.max(5, Math.min(500, seconds)) * 1000 + 15_000,
    }),
};
