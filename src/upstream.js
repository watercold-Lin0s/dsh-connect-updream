/**
 * Updream REST client: the only module that knows Updream's wire shapes.
 *
 * Every request carries `Authorization: Bearer <sk-…>` plus the workspace
 * header. All documented Updream endpoints the plugin uses are collected here
 * so a shape change is one edit, not a hunt through tool code.
 *
 * @module dsh-connect-updream/upstream
 */

const DEFAULT_BASE_URL = 'https://www.updream.cn/api';

/** Per-request HTTP timeout; generation calls are asynchronous on the server. */
const REQUEST_TIMEOUT_MS = 60_000;

/** A failure Updream reported (or that happened while talking to it). */
export class UpdreamError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'UpdreamError';
    this.code = options.code ?? 'UPSTREAM_ERROR';
    this.status = options.status ?? 0;
    this.backendCode = options.backendCode ?? '';
  }
}

/**
 * Normalize the configured base URL to `scheme://host[/path]` with one trailing
 * segment removed, so `…/api/` and `…/api` both work.
 * @param value - user-configured base URL, possibly empty.
 * @returns the base URL without a trailing slash.
 */
export function normalizeBaseURL(value) {
  const raw = String(value ?? '').trim();
  return (raw === '' ? DEFAULT_BASE_URL : raw).replace(/\/+$/, '');
}

/**
 * Pull a human message out of whatever shape Updream answered with. Updream
 * uses `{"detail": "…"}`, `{"detail": {"code","message"}}`, `{"error": …}`,
 * and the task endpoints use `error`/`error_code`/`message`.
 * @param payload - parsed response body, or undefined.
 * @param fallback - message used when the payload carries none.
 * @returns the message to show.
 */
export function messageOf(payload, fallback) {
  if (payload === null || payload === undefined) return fallback;
  if (typeof payload === 'string') return payload === '' ? fallback : payload;
  const detail = payload.detail;
  if (typeof detail === 'string' && detail !== '') return detail;
  if (detail !== null && typeof detail === 'object') {
    if (typeof detail.message === 'string' && detail.message !== '') return detail.message;
    if (typeof detail.code === 'string' && detail.code !== '') return detail.code;
  }
  for (const key of ['error', 'message', 'msg']) {
    const value = payload[key];
    if (typeof value === 'string' && value !== '') return value;
    if (value !== null && typeof value === 'object' && typeof value.message === 'string' && value.message !== '') return value.message;
  }
  if (typeof payload.error_code === 'string' && payload.error_code !== '') return payload.error_code;
  return fallback;
}

/**
 * Backend business code carried beside a message, when Updream names one.
 * @param payload - parsed response body.
 * @returns the code, or an empty string.
 */
function backendCodeOf(payload) {
  if (payload === null || typeof payload !== 'object') return '';
  const detail = payload.detail;
  if (detail !== null && typeof detail === 'object' && typeof detail.code === 'string') return detail.code;
  for (const key of ['error_code', 'code']) {
    if (typeof payload[key] === 'string' && payload[key] !== '') return payload[key];
  }
  return '';
}

/**
 * One Updream API client bound to an immutable credential + endpoint pair.
 * Instances are cheap; the Host builds one per request from current settings so
 * a rotated key applies without a restart.
 */
export class UpdreamClient {
  /**
   * @param options - endpoint and credential for every call this client makes.
   */
  constructor(options) {
    this.baseURL = normalizeBaseURL(options.baseURL);
    this.apiKey = String(options.apiKey ?? '');
    this.workspace = String(options.teamId ?? '').trim() === '' ? 'personal' : `team:${String(options.teamId).trim()}`;
    this.language = options.language === 'en' ? 'en' : 'zh';
  }

  /**
   * Issue one authenticated request and parse the JSON answer.
   * @param path - path below the base URL, starting with `/`.
   * @param init - method, body, query, and cancellation.
   * @returns the parsed body.
   */
  async request(path, init = {}) {
    if (this.apiKey === '') throw new UpdreamError('未配置 Updream API Key：请到「设置 → Updream」填入 sk- 开头的 Key', { code: 'AUTH_MISSING' });
    const url = new URL(this.baseURL + path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
    }

    const timeout = AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = init.signal === undefined ? timeout : AbortSignal.any([init.signal, timeout]);
    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      'accept-language': this.language,
      'x-workspace': this.workspace,
    };
    let body;
    if (init.body !== undefined) {
      if (init.body instanceof Uint8Array) {
        body = init.body;
        headers['content-type'] = 'application/octet-stream';
      } else if (typeof init.body === 'string') {
        body = init.body;
        headers['content-type'] = 'application/json';
      } else {
        body = JSON.stringify(init.body);
        headers['content-type'] = 'application/json';
      }
    }
    if (init.idempotencyKey !== undefined) headers['idempotency-key'] = init.idempotencyKey;

    let response;
    try {
      response = await fetch(url, { method: init.method ?? 'GET', headers, body, signal });
    } catch (cause) {
      if (cause?.name === 'TimeoutError') throw new UpdreamError(`Updream 请求超时（${path}）`, { code: 'NETWORK_ERROR' });
      if (cause?.name === 'AbortError') throw new UpdreamError('Updream 请求已取消', { code: 'ABORTED' });
      throw new UpdreamError(`连接 Updream 失败：${cause?.message ?? cause}`, { code: 'NETWORK_ERROR' });
    }

    const text = await response.text();
    let payload;
    if (text !== '') {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const status = response.status;
      const code = status === 401 || status === 403 ? 'AUTH_INVALID' : status === 402 ? 'INSUFFICIENT_CREDIT' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 422 || status === 400 ? 'INVALID_ARGUMENT' : 'UPSTREAM_ERROR';
      const message = messageOf(payload, `Updream 返回 HTTP ${status}`);
      const backend = backendCodeOf(payload);
      throw new UpdreamError(backend === '' ? message : `${message}（${backend}）`, { code, status, backendCode: backend });
    }
    return payload;
  }

  /** Current account, credits, and tier. */
  async account() {
    const me = await this.request('/auth/me');
    return me;
  }

  /** Credit balance document. */
  async credits() {
    const payload = await this.request('/model-credit/balance');
    // The model-credit endpoint wraps its payload in `{code,msg,data}`.
    return payload?.data ?? payload;
  }

  /** Projects visible to this account, newest first. */
  async projects(options = {}) {
    const payload = await this.request('/projects', {
      query: { page: options.page ?? 1, size: options.size ?? 50, search: options.search },
      signal: options.signal,
    });
    return Array.isArray(payload?.projects) ? payload.projects : [];
  }

  /** Create one project and return it. */
  async createProject(name, options = {}) {
    return this.request('/projects', { method: 'POST', body: { name }, signal: options.signal });
  }

  /**
   * Delete one project.
   *
   * Unlike node deletion this is NOT recoverable: Updream exposes no trash or
   * restore route for projects (`/projects/trash`, `/recycle` and friends are
   * all 404), so whatever the canvas holds goes with it. Callers are expected
   * to have shown the user what is inside first.
   * @param projectId - the project id to remove.
   */
  async deleteProject(projectId, options = {}) {
    return this.request(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      signal: options.signal,
    });
  }

  /** The whole canvas: nodes plus connections. */
  async canvas(projectId, options = {}) {
    const [nodes, connections] = await Promise.all([
      this.request(`/canvas-nodes/project/${projectId}`, {
        query: { include_generation_history: options.full === true ? 'true' : 'false' },
        signal: options.signal,
      }),
      this.request(`/canvas-nodes/project/${projectId}/connections`, { signal: options.signal }),
    ]);
    return {
      nodes: Array.isArray(nodes?.nodes) ? nodes.nodes : [],
      connections: Array.isArray(connections?.connections) ? connections.connections : [],
    };
  }

  /** One canvas node. */
  async node(id, options = {}) {
    return this.request(`/canvas-nodes/${id}`, { signal: options.signal });
  }

  /** Create a node of one type. */
  async createNode(projectId, node, options = {}) {
    return this.request(`/canvas-nodes/project/${projectId}`, { method: 'POST', body: node, signal: options.signal });
  }

  /** Update the fields explicitly named in `patch`. */
  async updateNode(id, patch, options = {}) {
    return this.request(`/canvas-nodes/${id}`, { method: 'PUT', body: patch, signal: options.signal });
  }

  /** Soft-delete one node. */
  async deleteNode(projectId, id, options = {}) {
    return this.request(`/canvas-nodes/${id}`, { method: 'DELETE', query: { project_id: projectId }, signal: options.signal });
  }

  /** Connect `from` → `to`. */
  async connect(projectId, from, to, options = {}) {
    return this.request(`/canvas-nodes/project/${projectId}/connections`, {
      method: 'POST',
      body: { from_node_id: from, to_node_id: to },
      signal: options.signal,
    });
  }

  /** Remove one connection. */
  async disconnect(id, options = {}) {
    return this.request(`/canvas-nodes/connections/${id}`, { method: 'DELETE', signal: options.signal });
  }

  /** Project assets, optionally filtered by type. */
  async assets(projectId, options = {}) {
    const payload = await this.request('/asset-nodes/files', {
      query: { limit: options.limit ?? 100, owner_id: projectId, owner_type: 'project' },
      signal: options.signal,
    });
    const list = Array.isArray(payload?.files) ? payload.files : Array.isArray(payload?.assets) ? payload.assets : [];
    const type = options.type;
    return type === undefined ? list : list.filter((asset) => asset?.type === type);
  }

  /**
   * Upload one local file and return its public URL.
   * @param file - filename, MIME type, and bytes.
   * @param kind - `image`, `video`, or `audio`.
   */
  async upload(file, kind, options = {}) {
    const path = kind === 'video' ? '/upload/video' : kind === 'audio' ? '/upload/audio' : '/upload/image';
    const form = new FormData();
    form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.name);
    const url = new URL(this.baseURL + path);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          'accept-language': this.language,
          'x-workspace': this.workspace,
        },
        body: form,
        signal: options.signal === undefined ? AbortSignal.timeout(180_000) : AbortSignal.any([options.signal, AbortSignal.timeout(180_000)]),
      });
    } catch (cause) {
      throw new UpdreamError(`上传失败：${cause?.message ?? cause}`, { code: 'NETWORK_ERROR' });
    }
    const text = await response.text();
    let payload;
    try {
      payload = text === '' ? undefined : JSON.parse(text);
    } catch {
      payload = text;
    }
    if (!response.ok) throw new UpdreamError(messageOf(payload, `上传失败（HTTP ${response.status}）`), { code: 'UPSTREAM_ERROR', status: response.status });
    const uploaded = payload?.url ?? payload?.data?.url ?? payload?.file_url;
    if (typeof uploaded !== 'string' || uploaded === '') throw new UpdreamError('上传成功但 Updream 未返回文件地址', { code: 'UPSTREAM_ERROR' });
    return { url: uploaded, name: payload?.filename ?? file.name };
  }

  /** The server's model catalog for one generation type. */
  async models(type, options = {}) {
    const path = type === 'image' ? '/ai/models' : type === 'video' ? '/ai/video-models' : type === 'audio' ? '/ai/audio-models' : type === 'music' ? '/ai/music-models' : '/ai/text-models';
    const payload = await this.request(path, { signal: options.signal });
    return {
      models: Array.isArray(payload?.models) ? payload.models : [],
      tier: typeof payload?.user_tier === 'string' ? payload.user_tier : '',
    };
  }

  /**
   * Submit one generation task. Returns the created task id.
   * @param kind - which generation endpoint to call.
   * @param body - generation fields, already shaped for that endpoint.
   * @param options - cancellation and idempotency.
   */
  async submit(kind, body, options = {}) {
    const path = kind === 'image' ? '/ai/generate-image/async' : kind === 'video' ? '/ai/generate-video/async' : kind === 'audio' ? '/ai/generate-audio/async' : kind === 'music' ? '/ai/generate-music/async' : '/ai/generate-text/async';
    const prefix = kind === 'image' ? 'image' : kind === 'video' ? 'video' : kind;
    return this.request(path, {
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey ?? `${prefix}:${globalThis.crypto.randomUUID()}`,
      signal: options.signal,
      timeoutMs: 120_000,
    });
  }

  /** Read one task's current state. */
  async task(id, options = {}) {
    return this.request(`/ai/task/${id}`, { signal: options.signal });
  }

  /**
   * Poll a task until it settles, a deadline passes, or the caller cancels.
   * @param id - task id from {@link Updream.submit}.
   * @param options - polling cadence, deadline, and cancellation.
   * @returns the final task document.
   */
  async waitForTask(id, options = {}) {
    const interval = Math.max(1000, options.intervalMs ?? 3000);
    const deadline = Date.now() + Math.max(interval, options.timeoutMs ?? 300_000);
    let last;
    for (;;) {
      last = await this.task(id, { signal: options.signal });
      const status = String(last?.status ?? '');
      if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'waiting_asset_review') return last;
      if (Date.now() >= deadline) {
        throw new UpdreamError(`等待任务 ${id} 超时（最后状态 ${status || '未知'}）。任务仍在服务端运行，可用 updream_task 继续查询。`, { code: 'TASK_TIMEOUT' });
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, interval);
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new UpdreamError('已取消等待', { code: 'ABORTED' })); }, { once: true });
      });
    }
  }
}

/**
 * Result URLs carried by one finished task document.
 *
 * Scoped by generation kind on purpose: the fields are disjoint per endpoint,
 * but a task document occasionally carries a cover thumbnail beside a video,
 * and mixing them would hand the model a `.jpg` where it asked for a video.
 * @param task - the final task document.
 * @param kind - which generation produced it.
 * @returns every URL the task produced, in server order.
 */
export function resultURLsOf(task, kind) {
  // The CLI's `task get` returns a flat `result_urls` array in addition to the
  // raw `result` document. Prefer it: it is the platform's canonical answer,
  // while the shape inside `result` varies per model.
  if (Array.isArray(task?.result_urls) && task.result_urls.length > 0) {
    return [...new Set(task.result_urls.filter((url) => typeof url === 'string' && url !== ''))];
  }
  const result = task?.result;
  if (result === null || typeof result !== 'object') return [];
  const urls = [];
  const push = (value) => { if (typeof value === 'string' && value !== '' && !urls.includes(value)) urls.push(value); };

  if (kind === 'image') {
    for (const image of Array.isArray(result.images) ? result.images : []) push(image);
    if (urls.length === 0) push(result.url);
    if (urls.length === 0) push(result.cover_url);
    return urls;
  }
  if (kind === 'video') {
    for (const video of Array.isArray(result.videos) ? result.videos : []) {
      push(video?.video_url);
    }
    if (urls.length === 0) push(result.video_url);
    return urls;
  }
  if (kind === 'audio' || kind === 'music') {
    push(result.audio_url);
    push(result.music_url);
    return urls;
  }
  // Unknown kind: report everything rather than nothing, so a new endpoint
  // still surfaces its result instead of looking empty.
  for (const image of Array.isArray(result.images) ? result.images : []) push(image);
  for (const video of Array.isArray(result.videos) ? result.videos : []) push(video?.video_url);
  push(result.audio_url);
  push(result.music_url);
  push(result.url);
  return urls;
}

/**
 * The text a finished text task produced.
 * @param task - the final task document.
 * @returns the text, or an empty string.
 */
export function resultTextOf(task) {
  const text = task?.result?.text ?? task?.result_text;
  return typeof text === 'string' ? text : '';
}
