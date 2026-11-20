/**
 * Host half of dsh-connect-updream.
 *
 * Responsibilities, in order of importance:
 *   1. Keep the Updream API key in the credential vault and never in config.
 *   2. Serve the settings page's HTTP routes (status, config save/verify,
 *      project and model listings, credit reads).
 *   3. Register the generation/canvas tools the user has switched on.
 *
 * The browser half talks only to this module's own `/plugins/dsh-connect-updream/*`
 * routes, so the `sk-` key never reaches a page.
 *
 * @module dsh-connect-updream
 */

import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

import { annotatedModels, normalizeConfig, taskTimeoutOf } from './config.js';
import { AccountStore, CREDENTIAL_SCOPE, maskKey, publicAccount } from './accounts.js';
import { UpdreamClient, UpdreamError, normalizeBaseURL } from './upstream.js';
import { cliLogin, cliStatus, CliError, runCli } from './cli.js';
import { registerTools } from './tools.js';

/** Host route prefix; the browser half mirrors these paths. */
const ROUTE_BASE = '/plugins/dsh-connect-updream';

export const name = 'dsh-connect-updream';
export const inject = ['tools', 'credentials'];

/** Image bytes accepted for one upload; Updream's own limit is 20 MB. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Video bytes accepted for one upload; larger files use Updream's chunked path. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** Extensions mapped to an upload MIME type. */
const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
]);

/**
 * Answer one Host route with a JSON envelope.
 * @param res - the HTTP response.
 * @param status - HTTP status.
 * @param body - `{ ok: true, data }` or `{ ok: false, error }`.
 */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

/**
 * Read a request body as text, bounded so a hostile page cannot exhaust memory.
 * @param req - the HTTP request.
 * @param limit - maximum bytes.
 * @returns the body text.
 */
async function readBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Whether a request arrived over the loopback interface. The settings routes
 * write credentials, so they are not exposed to a LAN or proxied origin.
 * @param req - the HTTP request.
 * @returns true when the peer is loopback.
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Snapshot of the plugin's saved configuration, passed to the tools.
 * @param config - the row's config.
 * @param credential - the current API key.
 * @param workspace - working directory used to resolve relative paths.
 */
function buildSettings(config, credential, workspace) {
  const client = new UpdreamClient({
    baseURL: normalizeBaseURL(config.baseURL),
    apiKey: credential,
    teamId: config.teamId,
  });
  return {
    config,
    client,
    taskTimeoutMs: taskTimeoutOf(config),
    models: {
      image: annotatedModels(config, 'image'),
      video: annotatedModels(config, 'video'),
      text: annotatedModels(config, 'text'),
    },
    /**
     * Read one local image for upload, refusing anything outside the size cap
     * before a single byte is sent.
     */
    async readImageFile(path, signal) {
      return readMediaFile(path, 'image', workspace, signal);
    },
    async readMediaFile(path, kind, signal) {
      return readMediaFile(path, kind, workspace, signal);
    },
  };
}

/**
 * Resolve the base directory a relative asset path is read against.
 *
 * `process.cwd()` is the HOST's launch directory, which is not necessarily the
 * session's working directory: a user who opened DSH in project B and then said
 * "上传 ./cover.png" from a session whose directory is project A would have the
 * file read from B. The `workingDirectory` service is the only correct source,
 * and it needs the Agent, so a tool call supplies its own `exec.agent`.
 *
 * Falls back to the process directory only when the service or the agent is
 * absent, which is the situation in a headless unit test — not a silent guess
 * in production, where `workingDirectory` is always mounted.
 * @param ctx - the plugin context carrying optional services.
 * @param agent - the calling Agent, when the caller has one.
 * @param fallback - directory to use when nothing else is available.
 * @returns an absolute base directory.
 */
function baseDirectoryOf(ctx, agent, fallback) {
  if (agent === undefined || agent === null) return fallback;
  try {
    const service = ctx.get('workingDirectory');
    if (service === undefined) return fallback;
    const directory = service.get(agent);
    return typeof directory === 'string' && directory !== '' ? directory : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read a local file into the shape {@link UpdreamClient.upload} expects.
 * @param path - absolute or session-relative path.
 * @param kind - asset kind, which decides the size cap.
 * @param workspace - base for relative paths.
 * @param signal - cancellation.
 * @returns filename, MIME type, and bytes.
 */
async function readMediaFile(path, kind, workspace, signal) {
  const resolved = isAbsolute(path) ? path : resolve(workspace, path);
  const extension = extname(resolved).toLowerCase();
  const mimeType = MIME_BY_EXTENSION.get(extension);
  if (mimeType === undefined) throw new Error(`不支持的素材类型：${extension || '(无扩展名)'}`);
  let bytes;
  try {
    bytes = await readFile(resolved, { signal });
  } catch (cause) {
    throw new Error(`读不到文件 ${resolved}：${cause?.message ?? cause}`);
  }
  const cap = kind === 'video' ? MAX_VIDEO_BYTES : kind === 'audio' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (bytes.length > cap) {
    throw new Error(`文件过大：${Math.round(bytes.length / 1024 / 1024)} MB，上限 ${Math.round(cap / 1024 / 1024)} MB`);
  }
  return { name: resolved.split(/[\\/]/).pop(), mimeType, bytes };
}

/**
 * The config the browser may read: everything except secrets.
 * @param config - the row's config.
 * @param connected - whether a key is stored.
 * @returns plain JSON.
 */
function publicConfig(config, connected) {
  return {
    baseURL: config.baseURL,
    teamId: config.teamId,
    defaultProjectId: config.defaultProjectId,
    allowImageTools: config.allowImageTools === true,
    allowVideoTools: config.allowVideoTools === true,
    allowTextTool: config.allowTextTool === true,
    allowCanvasTools: config.allowCanvasTools === true,
    allowProjectDelete: config.allowProjectDelete === true,
    showCreditsBadge: config.showCreditsBadge === true,
    pollIntervalMs: config.pollIntervalMs,
    imageModels: Array.isArray(config.imageModels) ? config.imageModels : [],
    videoModels: Array.isArray(config.videoModels) ? config.videoModels : [],
    textModels: Array.isArray(config.textModels) ? config.textModels : [],
    taskTimeoutMs: taskTimeoutOf(config),
    apiKeyConfigured: connected,
  };
}

/**
 * Mount the plugin.
 * @param ctx - the plugin's owning context.
 * @param config - the validated row config.
 */
export function apply(ctx, rawConfig) {
  // The profile's patch row is user-editable, so nothing below trusts its
  // shape: one normalization here means no later reader has to re-check.
  const config = normalizeConfig(rawConfig);
  const credentials = ctx.credentials;
  /** Last upstream failure, surfaced on the diagnostics tab. */
  let lastError = '';
  /** Working directory used to resolve relative asset paths. */
  const workspace = process.cwd();

  /**
   * Read the stored API key. Returns an empty string when none is stored, which
   * every caller treats as "not configured" rather than as an error.
   */
  /**
   * The account store. Every key lives here; nothing reads the credential
   * vault directly, so the multi-account rules have one home.
   */
  const accounts = new AccountStore(credentials, async (key) => {
    const candidate = new UpdreamClient({ baseURL: normalizeBaseURL(config.baseURL), apiKey: key, teamId: config.teamId });
    const me = await candidate.account();
    const user = me?.user ?? me?.data?.user ?? me;
    return { id: user?.id === undefined ? '' : String(user.id), username: typeof user?.username === 'string' ? user.username : '' };
  });

  /** The key the active account supplies, or an empty string. */
  const apiKey = async () => {
    const account = await accounts.active();
    return account === undefined ? '' : account.key;
  };

  /** Read the CLI's configured identity without changing it (best-effort). */
  const cliIdentity = async () => {
    try {
      const status = await cliStatus(config, '');
      const user = status?.user ?? null;
      return {
        configured: status?.authenticated === true,
        upstreamId: user?.id === undefined ? '' : String(user.id),
        username: typeof user?.username === 'string' ? user.username : '',
        configPath: String(status?.config_path ?? ''),
      };
    } catch (cause) {
      return { configured: false, upstreamId: '', username: '', error: String(cause?.message ?? cause) };
    }
  };

  /** Build a client from the ACTIVE account, so a switch applies immediately. */
  const client = async () => buildSettings(config, await apiKey(), workspace);

  /**
   * Mirror the active Updream account into the CLI's own config.
   *
   * The CLI is the single execution layer of this plugin, so every command it
   * runs must carry the same identity as the account shown in the UI. The key
   * goes in on stdin (`auth login --api-key -`), never through argv or shell
   * history. A failed sync leaves the CLI on its previous account and raises,
   * so the caller never reports a switch that did not really happen.
   */
  const syncCliAccount = async () => {
    const active = await accounts.active();
    if (active === undefined || active.key === '') return;
    try {
      await cliLogin(config, active.key);
      const status = await cliStatus(config, active.key);
      const cliUser = status?.user ?? null;
      if (cliUser !== null && String(cliUser.id ?? '') !== String(active.upstreamId ?? '')) {
        // Key config was written but belongs to a different account: surface it
        // instead of silently running tools under the wrong identity.
        lastError = `CLI 账号不一致：插件为 ${active.upstreamId}，CLI 为 ${String(cliUser.id ?? '')}`;
        throw new Error(lastError);
      }
      lastError = '';
    } catch (cause) {
      if (cause instanceof CliError || cause instanceof Error) {
        lastError = `同步 CLI 账号失败：${String(cause?.message ?? cause)}`;
      }
      throw cause;
    }
  };

  /**
   * Every stored account with its masked key and its active flag. A migrated
   * account has no stored identity, so it is described once here — otherwise
   * the list would show a record id where a person's name belongs.
   */
  const accountList = async () => {
    const [list, activeId] = await Promise.all([accounts.list(), accounts.activeId()]);
    const described = await Promise.all(list.map((account) => accounts.describe(account)));
    return described.map((account) => ({
      ...publicAccount(account),
      maskedKey: maskKey(account.key),
      active: account.id === activeId,
    }));
  };

  /**
   * Persist a patch through the config editor rather than rewriting the
   * profile's patch file.
   *
   * Editing an ordinary field restarts this plugin, which tears down the HTTP
   * route that is currently answering. The write is therefore fired after the
   * caller's response has been flushed (`deferred`), so the page reads a real
   * `ok: true` instead of a dropped connection. A failure after the response
   * is logged rather than reported — the next status read shows the old
   * config, which is exactly the truth.
   */
  const saveConfig = (patch) => {
    const entry = ctx.fiber.entry;
    const editor = ctx.get('configEditor');
    if (entry === undefined || editor === undefined) {
      throw new Error('当前 profile 无法保存配置（缺少配置编辑器）：请改用 cordis.patch.yml 配置本插件');
    }
    return editor.edit(entry, (current) => ({ ...current, ...patch })).catch((cause) => {
      ctx.logger?.warn?.(`[dsh-connect-updream] 配置写入失败：${String(cause?.message ?? cause)}`);
    });
  };

  /**
   * The status document the settings page opens with: every stored account,
   * which one is live, its upstream identity and credits, and the public config.
   */
  const statusDocument = async () => {
    const [stored, list] = await Promise.all([apiKey(), accountList()]);
    const connected = stored !== '';
    const activeAccount = list.find((account) => account.active) ?? null;
    const document = {
      connected,
      apiKeyConfigured: connected,
      config: publicConfig(config, connected),
      accounts: list,
      activeAccountId: activeAccount === null ? '' : activeAccount.id,
      user: null,
      credits: null,
      tier: '',
      cli: await cliIdentity(),
      lastError,
    };
    if (!connected) return document;
    try {
      const settings = buildSettings(config, stored, workspace);
      const [account, credits] = await Promise.all([
        settings.client.account(),
        settings.client.credits().catch(() => null),
      ]);
      const user = account?.user ?? account?.data?.user ?? account;
      if (user !== null && typeof user === 'object') {
        document.user = {
          id: user.id === undefined ? '' : String(user.id),
          username: typeof user.username === 'string' ? user.username : '',
        };
      }
      if (credits !== null && typeof credits === 'object') {
        document.credits = {
          available: credits.balance_credits ?? credits.available_credits ?? null,
          permanent: credits.permanent_credits ?? null,
          temporary: credits.temporary_credits ?? null,
        };
        document.tier = typeof credits.scope === 'string' ? credits.scope : '';
      }
    } catch (cause) {
      document.lastError = String(cause?.message ?? cause);
      lastError = document.lastError;
    }
    return document;
  };

  /* ------------------------------------------------------------------ */
  /* Routes                                                              */
  /* ------------------------------------------------------------------ */

  ctx.inject(['webServer'], (webCtx) => {
    const disposers = [];
    const route = (path, method, handler) => {
      disposers.push(webCtx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (req.method !== method) return json(res, 405, { ok: false, error: 'method not allowed' });
          if (!isLoopback(req)) return json(res, 403, { ok: false, error: 'this route is loopback only' });
          try {
            const result = await handler(req);
            json(res, 200, { ok: true, data: result });
          } catch (cause) {
            if (!(cause instanceof UpdreamError)) lastError = String(cause?.message ?? cause);
            json(res, 200, { ok: false, error: String(cause?.message ?? cause) });
          }
        },
      }));
    };

    route(`${ROUTE_BASE}/status`, 'GET', async () => statusDocument());

    /** Explicitly re-sync the CLI config to the active account. */
    route(`${ROUTE_BASE}/cli/sync`, 'POST', async () => {
      await syncCliAccount();
      return statusDocument();
    });

    route(`${ROUTE_BASE}/credits`, 'GET', async () => {
      const active = await accounts.active();
      if (active === undefined) throw new Error('还没有添加任何账号');
      const settings = buildSettings(config, active.key, workspace);
      const credits = await settings.client.credits();
      return {
        available: credits?.balance_credits ?? null,
        tier: credits?.scope ?? '',
        account: { id: active.id, label: active.label, username: active.username },
      };
    });

    route(`${ROUTE_BASE}/projects`, 'POST', async () => {
      const settings = await client();
      const projects = await settings.client.projects({ size: 100 });
      return {
        projects: projects.map((project) => ({
          id: String(project.project_id ?? ''),
          name: String(project.name ?? ''),
          teamId: String(project.team_id ?? ''),
        })).filter((project) => project.id !== ''),
      };
    });

    route(`${ROUTE_BASE}/models`, 'POST', async () => {
      const settings = await client();
      if (settings.client.apiKey === '') throw new Error('未配置 Updream API Key');
      const [image, video, text] = await Promise.all([
        settings.client.models('image').catch(() => ({ models: [], tier: '' })),
        settings.client.models('video').catch(() => ({ models: [], tier: '' })),
        settings.client.models('text').catch(() => ({ models: [], tier: '' })),
      ]);
      const flatten = (catalog) => catalog.models.map((model) => ({
        id: String(model.value ?? ''),
        label: String(model.label ?? model.value ?? ''),
        tier: String(model.min_tier ?? ''),
      })).filter((model) => model.id !== '');
      return { image: flatten(image), video: flatten(video), text: flatten(text) };
    });

    /**
     * Add an account, or verify the active one.
     *
     * With a key: the key is checked upstream first, so a typo reads as
     * "invalid key" rather than as a mysterious failure on the first
     * generation, then stored as a new account.
     * Without a key: a plain connectivity check of the active account.
     */
    route(`${ROUTE_BASE}/verify`, 'POST', async (req) => {
      const body = JSON.parse(await readBody(req) || '{}');
      const candidate = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (candidate !== '') {
        const before = await accounts.activeId();
        const account = await accounts.add(candidate, typeof body.label === 'string' ? body.label : '');
        const after = await accounts.activeId();
        // Adding the first account (or a replacement after removing the old
        // one) makes it active, so the CLI must follow. On failure, undo the
        // newly stored account rather than leave a half-added identity.
        if (after === account?.id && before !== after) {
          try {
            await syncCliAccount();
          } catch (cause) {
            if (account?.id) await accounts.remove(account.id);
            throw cause;
          }
        }
      } else {
        const settings = await client();
        if (settings.client.apiKey === '') throw new Error('还没有添加任何账号');
        await settings.client.account();
      }
      lastError = '';
      return statusDocument();
    });

    /** Switch the active account: the CLI config is updated to match. */
    route(`${ROUTE_BASE}/accounts/activate`, 'POST', async (req) => {
      const body = JSON.parse(await readBody(req) || '{}');
      const target = String(body.id ?? '');
      const previous = await accounts.activeId();
      await accounts.activate(target);
      try {
        await syncCliAccount();
      } catch (cause) {
        // Roll the vault pointer back so the plugin and CLI never disagree
        // about which account is live.
        if (previous !== '' && previous !== target) await accounts.activate(previous);
        throw cause;
      }
      return statusDocument();
    });

    /** Rename an account (an empty label falls back to the upstream username). */
    route(`${ROUTE_BASE}/accounts/rename`, 'POST', async (req) => {
      const body = JSON.parse(await readBody(req) || '{}');
      await accounts.rename(String(body.id ?? ''), String(body.label ?? ''));
      return statusDocument();
    });

    /** Remove an account; the next remaining one takes over when it was active. */
    route(`${ROUTE_BASE}/accounts/remove`, 'POST', async (req) => {
      const body = JSON.parse(await readBody(req) || '{}');
      const wasActive = (await accounts.activeId()) === String(body.id ?? '');
      await accounts.remove(String(body.id ?? ''));
      if (wasActive && (await accounts.active())) await syncCliAccount();
      else if (!(await accounts.active())) lastError = '已删除所有账号，CLI 仍保留最后一次登录的 Key';
      return statusDocument();
    });

    /** Re-read one account's credits without switching to it. */
    route(`${ROUTE_BASE}/accounts/credits`, 'POST', async (req) => {
      const body = JSON.parse(await readBody(req) || '{}');
      const id = String(body.id ?? '');
      const record = await credentials.readRecord(`${CREDENTIAL_SCOPE}/${id}`);
      const key = record !== undefined && record.kind === 'api-key' && typeof record.key === 'string' ? record.key : '';
      if (key === '') throw new Error('没有这个账号');
      const settings = buildSettings(config, key, workspace);
      const [me, credits] = await Promise.all([
        settings.client.account().catch(() => null),
        settings.client.credits().catch(() => null),
      ]);
      const user = me?.user ?? me?.data?.user ?? me;
      return {
        id,
        username: typeof user?.username === 'string' ? user.username : '',
        available: credits?.balance_credits ?? null,
        tier: typeof credits?.scope === 'string' ? credits.scope : '',
      };
    });

    route(`${ROUTE_BASE}/config`, 'POST', async (req) => {
      const body = JSON.parse(await readBody(req) || '{}');
      if (typeof body.removeAccountId === 'string' && body.removeAccountId !== '') {
        const wasActive = (await accounts.activeId()) === body.removeAccountId;
        await accounts.remove(body.removeAccountId);
        if (wasActive && (await accounts.active())) await syncCliAccount();
        return statusDocument();
      }
      if (body.clearApiKey === true) {
        // Kept for a page opened before the multi-account upgrade: "clear" now
        // means "remove every account", which is what that button promised.
        for (const account of await accounts.list()) await accounts.remove(account.id);
        lastError = '已删除所有账号，CLI 仍保留最后一次登录的 Key';
        return statusDocument();
      }
      const patch = {};
      for (const field of ['baseURL', 'teamId', 'defaultProjectId']) {
        if (typeof body[field] === 'string') patch[field] = body[field];
      }
      for (const field of ['allowImageTools', 'allowVideoTools', 'allowTextTool', 'allowCanvasTools', 'allowProjectDelete', 'showCreditsBadge']) {
        if (typeof body[field] === 'boolean') patch[field] = body[field];
      }
      if (typeof body.pollIntervalMs === 'number') patch.pollIntervalMs = body.pollIntervalMs;
      if (typeof body.taskTimeoutMs === 'number') patch.taskTimeoutMs = body.taskTimeoutMs;
      for (const field of ['imageModels', 'videoModels', 'textModels']) {
        if (Array.isArray(body[field])) patch[field] = body[field].filter((id) => typeof id === 'string');
      }
      if (Object.keys(patch).length > 0) {
        // Flush the answer first: this write restarts the plugin.
        setTimeout(() => { void saveConfig(patch); }, 0);
        const [stored, list] = await Promise.all([apiKey(), accountList()]);
        const activeAccount = list.find((account) => account.active) ?? null;
        return {
          connected: stored !== '',
          apiKeyConfigured: stored !== '',
          config: publicConfig({ ...config, ...patch }, stored !== ''),
          accounts: list,
          activeAccountId: activeAccount === null ? '' : activeAccount.id,
          user: null,
          credits: null,
          tier: '',
          lastError,
          applied: true,
        };
      }
      return statusDocument();
    });

    ctx.effect(() => () => { for (const dispose of disposers) try { dispose(); } catch { /* already gone */ } });
  });

  /* ------------------------------------------------------------------ */
  /* Tools                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Register the tool surface. `config` is the activation-time snapshot, so a
   * settings change restarts the plugin and re-runs this — which is exactly how
   * a switch turns into a registered (or absent) tool.
   */
  ctx.effect(() => {
    let settings;
    const ready = (async () => {
      settings = buildSettings(config, await apiKey(), workspace);
    })();

    /**
     * A deferred settings handle: tools await `ready` before their first call so
     * a slow credential read never looks like "no key configured".
     */
    const handle = {
      get config() { return config; },
      get client() { return settings.client; },
      get taskTimeoutMs() { return settings.taskTimeoutMs; },
      get models() { return settings.models; },
      /** The active account's key; tools pass it to every CLI invocation. */
      apiKey,
      /**
       * Resolve a possibly-relative media path against the calling Agent's
       * working directory. The CLI does the actual upload; we only supply the
       * path so byte handling and face precheck stay in one implementation.
       */
      resolveMediaPath(path, agent) {
        const resolved = isAbsolute(path) ? path : resolve(baseDirectoryOf(ctx, agent, workspace), path);
        return resolved;
      },
      async readImageFile(path, signal, agent) {
        await ready;
        return readMediaFile(path, 'image', baseDirectoryOf(ctx, agent, workspace), signal);
      },
      async readMediaFile(path, kind, signal, agent) {
        await ready;
        return readMediaFile(path, kind, baseDirectoryOf(ctx, agent, workspace), signal);
      },
    };

    return registerTools(ctx, handle);
  });
}
