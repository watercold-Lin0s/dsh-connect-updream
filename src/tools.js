/**
 * Model-facing tools: image, video, and text generation, plus canvas and asset
 * operations. Each family is registered only while its switch is on, so a user
 * who has not opted in never pays for a call they did not expect.
 *
 * Definitions are written as raw JSON Schema (the registry's `ToolSchema`
 * shape) rather than through `defineTool`, so this module imports no Harness
 * package: a version bump of `dsh-tools` cannot break loading here.
 *
 * The generation tools are the reason this plugin exists, so their descriptions
 * state the price model plainly rather than burying it: an image costs credits
 * per picture, a video per second, and both are billed whether or not the user
 * likes the result.
 *
 * @module dsh-connect-updream/tools
 */

import { resultTextOf, resultURLsOf } from './upstream.js';

/**
 * The host kills a tool call at 600 s. Stay under it on purpose.
 *
 * A `timeoutMs` at or above the host cap does not extend the wait — the host
 * wins, and it wins with a bare `tool call timed out after 600000ms` that
 * carries neither the task id nor a reason. Throwing our own error first means
 * the model still learns the task id and that the job is *continuing upstream*,
 * which is the difference between "retry blindly" and "go poll it".
 */
const HOST_TOOL_CAP_MS = 600_000;
/** Slack below the host cap so our own timeout always fires first. */
const TOOL_TIMEOUT_MARGIN_MS = 30_000;

/** Poll cadence for every generation task. */
const POLL_INTERVAL_MS = 3000;


/**
 * Resolve the project a call should act on: explicit argument, then config.
 * @param args - validated tool arguments.
 * @param settings - plugin settings bundle.
 * @returns the project id.
 */
function projectOf(args, settings) {
  const explicit = typeof args?.project_id === 'string' ? args.project_id.trim() : '';
  if (explicit !== '') return explicit;
  const configured = String(settings.config?.defaultProjectId ?? '').trim();
  if (configured !== '') return configured;
  throw new Error('没有指定项目：调用时传 project_id，或在「设置 → Updream」里设一个默认项目');
}

/**
 * Whether a catalog entry is usable by the account that listed it.
 *
 * Updream lists every model the platform offers, each tagged with the minimum
 * membership tier it needs, beside the account's own tier. A `pro` model on an
 * `origin` account appears in the list and then fails at submit time with
 * `MODEL_LEVEL_INSUFFICIENT` — so "first in the catalog" is the wrong default:
 * it picks exactly the row the account cannot use. Preference is
 * account-allowed first, catalog order second.
 * @param model - one catalog entry.
 * @param userTier - the account's tier from the same response.
 * @returns true when the entry is not known to be out of reach.
 */
function usableByTier(model, userTier) {
  // `min_tier` is the wire field; `tier` is accepted too because the settings
  // page's flattened model rows use that name.
  const needs = typeof model?.min_tier === 'string' ? model.min_tier : typeof model?.tier === 'string' ? model.tier : '';
  if (needs === '' || userTier === '') return true;
  // Tiers are ordered `origin` < `pro`; an exact match is always allowed, and
  // an unknown vocabulary is treated as usable rather than silently dropping
  // every model.
  const order = { origin: 0, pro: 1 };
  const need = order[needs];
  const have = order[userTier];
  if (need === undefined || have === undefined) return true;
  return have >= need;
}

/**
 * Pick the model for a call: the explicit request, else the first enabled id,
 * else the first catalog entry the account can actually use.
 * @param requested - model id from the tool call.
 * @param enabled - ids enabled in settings, or undefined for "all".
 * @param catalog - ids the server currently offers for that kind.
 * @param kind - generation kind, for the error message.
 * @param preferred - catalog entries already filtered for this account, in
 *   catalog order; the first is the default.
 * @returns the model id.
 */
function pickModel(requested, enabled, catalog, kind, preferred = []) {
  const wanted = typeof requested === 'string' && requested.trim() !== '' ? requested.trim() : '';
  if (wanted !== '') {
    if (catalog.length > 0 && !catalog.includes(wanted)) {
      const hint = (enabled === undefined ? catalog : enabled.filter((id) => catalog.includes(id))).slice(0, 12).join(', ');
      throw new Error(`Updream 目录里没有${kind}模型 "${wanted}"。可选：${hint || '(目录为空，请先在设置页刷新模型目录)'}`);
    }
    return wanted;
  }
  const usable = preferred.length > 0 ? preferred : catalog;
  const candidates = enabled === undefined ? usable : enabled.filter((id) => usable.includes(id));
  if (candidates.length === 0) {
    const hint = enabled !== undefined && enabled.length > 0
      ? `设置页勾选的模型（${enabled.slice(0, 6).join(', ')}）当前都不在 Updream 目录里，请刷新模型目录后重选`
      : '请在「设置 → Updream → 模型」里勾选至少一个，或显式传 model';
    throw new Error(`没有可用的 ${kind} 模型：${hint}`);
  }
  return candidates[0];
}

/**
 * Submit one generation task and wait for it to settle.
 * @param settings - plugin settings bundle.
 * @param options - endpoint kind, request body, and wait budget.
 * @returns the task id and its final document.
 */
async function runGeneration(settings, options) {
  const { client, signal } = settings;
  const submitted = await client.submit(options.kind, options.body, { signal });
  const taskId = typeof submitted?.task_id === 'string' ? submitted.task_id : '';
  if (taskId === '') throw new Error('Updream 未返回 task_id，任务没有提交成功');

  // A submission may already report a terminal failure (quota, wrong model).
  if (submitted.status === 'failed') {
    const reason = typeof submitted.error === 'string' ? submitted.error : submitted.error?.message ?? submitted.message ?? '未知原因';
    throw new Error(`Updream 拒绝了这个任务：${reason}`);
  }

  // `taskTimeoutMs` is user-editable and its ceiling is higher than the host's
  // tool cap. Without this clamp a configured 900 s wait would always lose the
  // race to the host's 600 s kill — and lose it with no task id in the error.
  const waitBudget = Math.min(
    Number(options.timeoutMs) || HOST_TOOL_CAP_MS,
    HOST_TOOL_CAP_MS - TOOL_TIMEOUT_MARGIN_MS,
  );

  const task = await client.waitForTask(taskId, {
    signal,
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: waitBudget,
  });

  const status = String(task?.status ?? '');
  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    const reason = typeof task?.error === 'string' ? task.error : task?.error?.message ?? task?.message ?? '未知原因';
    throw new Error(`Updream 生成失败：${reason}${typeof task?.error_code === 'string' && task.error_code !== '' ? `（${task.error_code}）` : ''}`);
  }
  if (status === 'waiting_asset_review') {
    return { taskId, task, status };
  }
  return { taskId, task, status };
}

/**
 * Turn reference-image arguments into the URLs Updream accepts. Local paths are
 * uploaded first; an entry that is neither a URL nor a readable file fails
 * before anything is billed.
 * @param settings - plugin settings bundle.
 * @param entries - model-supplied strings.
 * @param signal - cancellation.
 * @returns absolute URLs.
 */
async function resolveImages(settings, entries, signal, agent) {
  const urls = [];
  for (const entry of entries.slice(0, 5)) {
    const value = String(entry ?? '').trim();
    if (value === '') continue;
    if (/^https?:\/\//i.test(value)) {
      urls.push(value);
      continue;
    }
    const file = await settings.readMediaFile(value, 'image', signal, agent);
    const uploaded = await settings.client.upload(file, 'image', { signal });
    urls.push(uploaded.url);
  }
  return urls;
}

/**
 * Register the whole tool surface this configuration allows.
 * @param ctx - the plugin's context.
 * @param settings - live settings bundle.
 * @returns a disposer removing exactly what was registered.
 */
export function registerTools(ctx, settings) {
  const disposers = [];
  const add = (definition) => { disposers.push(ctx.tools.register(definition)); };

  if (settings.config?.allowImageTools === true) add(imageTool(settings));
  if (settings.config?.allowVideoTools === true) add(videoTool(settings));
  if (settings.config?.allowTextTool === true) add(textTool(settings));
  if (settings.config?.allowCanvasTools === true) for (const definition of canvasTools(settings)) add(definition);
  if (settings.config?.allowProjectDelete === true) add(projectDeleteTool(settings));

  return () => { for (const dispose of disposers) try { dispose(); } catch { /* already gone */ } };
}

/** The `{ task_id, urls, model, node_id }` output every media tool reports. */
const MEDIA_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['task_id', 'urls', 'model', 'node_id'],
  properties: {
    task_id: { type: 'string' },
    urls: { type: 'array', items: { type: 'string' } },
    model: { type: 'string' },
    node_id: { type: 'string', description: '写回的画布节点 id；空字符串表示没有写回画布。' },
  },
};

/**
 * Build the model-facing text for one finished media task.
 * @param label - what was generated, for the opening line.
 * @param value - the tool's output value.
 * @param note - closing caveat, or an empty string.
 */
function mediaRender(label, value, note) {
  const lines = [`Updream 已生成${label}（${value.model}，task ${value.task_id}）：`];
  for (const url of value.urls) lines.push(`- ${url}`);
  if (value.node_id !== '') lines.push(`已写回画布节点 ${value.node_id}。`);
  if (note !== '') lines.push(note);
  return [{ type: 'text', text: lines.join('\n') }];
}

/* -------------------------------------------------------------------- */
/* Image                                                                 */
/* -------------------------------------------------------------------- */

function imageTool(settings) {
  return {
    name: 'updream_generate_image',
    description:
      '在 Updream 上生成图片，返回图片地址。每张图按张消耗 Updream 积分（普通档位约 15 积分/张，'
      + '实际以账号档位与所选模型为准），所以一次只生成一张、确认满意再要更多。'
      + '图片链接是 Updream CDN 上的临时地址，需要保留就尽快下载。'
      + '支持参考图：把图片 URL（或本地路径）放进 reference_images，模型会以它们为构图或风格参考。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: '画面描述。写清主体、构图、光线与风格；中文或英文都可以。' },
        ratio: { type: 'string', description: '画面比例，例如 1:1、16:9、9:16、4:3、3:4。不传则用该模型的默认值。' },
        resolution: { type: 'string', description: '分辨率档位，例如 1K、2K、4K。不传则用该模型的默认值。' },
        quality: { type: 'string', description: '画质档位，例如 low、medium、high。不传则用该模型的默认值。' },
        model: { type: 'string', description: '模型 id。不传则用设置页勾选的第一个可用模型。' },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图，最多 5 张。每一项可以是 http(s) URL 或本机文件路径（本地文件会先上传）。',
        },
        project_id: { type: 'string', description: '要使用的项目 id。不传则用设置页的默认项目。' },
        node_id: { type: 'string', description: '写回已有画布节点：结果会追加到该节点的生成历史。' },
        on_canvas: { type: 'boolean', description: 'true 则先在画布上建一个图片节点再生成，结果落在节点上。默认 false，只生成不上画布。' },
      },
    },
    output: {
      schema: MEDIA_OUTPUT,
      render(_args, value) {
        return mediaRender('图片', value, '这些链接是临时地址，需要保留请立刻下载。');
      },
    },
    timeoutMs: 420_000,
    async execute(args, exec) {
      const { client } = settings;
      const listing = await client.models('image').catch(() => ({ models: [], tier: '' }));
      const catalog = listing.models.map((model) => String(model.value ?? ''));
      const usable = listing.models.filter((model) => usableByTier(model, listing.tier)).map((model) => String(model.value ?? ''));
      const model = pickModel(args.model, settings.models?.image, catalog, '图片', usable);
      const projectId = projectOf(args, settings);

      let nodeId = typeof args.node_id === 'string' && args.node_id.trim() !== '' ? args.node_id.trim() : '';
      if (nodeId === '' && args.on_canvas === true) {
        const node = await client.createNode(projectId, {
          node_type: 'image',
          title: String(args.prompt ?? '').slice(0, 40),
          prompt: args.prompt,
          model_name: model,
        }, { signal: exec.signal });
        nodeId = node?.id === undefined ? '' : String(node.id);
      }

      const body = {
        prompt: args.prompt,
        model_name: model,
        project_id: projectId,
        num_images: 1,
        ...nodeId === '' ? {} : { node_id: Number(nodeId) },
        ...args.ratio === undefined ? {} : { ratio: args.ratio },
        ...args.resolution === undefined ? {} : { image_resolution: args.resolution },
        ...args.quality === undefined ? {} : { image_quality: args.quality },
      };
      if (Array.isArray(args.reference_images) && args.reference_images.length > 0) {
        body.reference_images = await resolveImages(settings, args.reference_images, exec.signal, exec.agent);
      }

      const { taskId, task } = await runGeneration(settings, {
        kind: 'image',
        body,
        timeoutMs: settings.taskTimeoutMs,
      });
      return { task_id: taskId, urls: resultURLsOf(task, 'image'), model, node_id: nodeId };
    },
  };
}

/* -------------------------------------------------------------------- */
/* Video                                                                 */
/* -------------------------------------------------------------------- */

function videoTool(settings) {
  return {
    name: 'updream_generate_video',
    description:
      '在 Updream 上生成视频，返回视频地址。视频按秒计费，一次调用消耗的积分远高于图片，'
      + '所以先把提示词、时长与分辨率确认清楚再提交，不要为了试探而反复调用。生成是异步任务，通常几十秒到几分钟。'
      + '给 image 就是图生视频（以该图为内容依据），不给就是文生视频。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: '视频内容描述：主体动作、镜头运动、场景与氛围。' },
        duration: { type: 'number', description: '时长（秒）。合法值由模型决定，常见 5 或 10。不传则用该模型的默认值。' },
        resolution: { type: 'string', description: '分辨率，例如 720p、1080p。不传则用该模型的默认值。' },
        aspect_ratio: { type: 'string', description: '画面比例，例如 16:9、9:16、1:1。图生视频时通常由输入图决定。' },
        image: { type: 'string', description: '图生视频的首帧：图片 URL 或本机文件路径。' },
        model: { type: 'string', description: '模型 id。不传则用设置页勾选的第一个可用模型。' },
        project_id: { type: 'string', description: '要使用的项目 id。不传则用设置页的默认项目。' },
        on_canvas: { type: 'boolean', description: 'true 则先在画布上建一个视频节点再生成。默认 false。' },
      },
    },
    output: {
      schema: MEDIA_OUTPUT,
      render(_args, value) {
        return mediaRender('视频', value, '');
      },
    },
    timeoutMs: HOST_TOOL_CAP_MS - TOOL_TIMEOUT_MARGIN_MS,
    async execute(args, exec) {
      const { client } = settings;
      const listing = await client.models('video').catch(() => ({ models: [], tier: '' }));
      const catalog = listing.models.map((model) => String(model.value ?? ''));
      const usable = listing.models.filter((model) => usableByTier(model, listing.tier)).map((model) => String(model.value ?? ''));
      const model = pickModel(args.model, settings.models?.video, catalog, '视频', usable);
      const projectId = projectOf(args, settings);

      let nodeId = '';
      if (args.on_canvas === true) {
        const node = await client.createNode(projectId, {
          node_type: 'video',
          title: String(args.prompt ?? '').slice(0, 40),
          prompt: args.prompt,
          model_name: model,
        }, { signal: exec.signal });
        nodeId = node?.id === undefined ? '' : String(node.id);
      }

      const body = {
        prompt: args.prompt,
        model_name: model,
        project_id: projectId,
        ...nodeId === '' ? {} : { node_id: Number(nodeId) },
        ...args.duration === undefined ? {} : { duration: args.duration },
        ...args.resolution === undefined ? {} : { resolution: args.resolution },
        ...args.aspect_ratio === undefined ? {} : { aspect_ratio: args.aspect_ratio },
      };
      if (typeof args.image === 'string' && args.image.trim() !== '') {
        body.image = (await resolveImages(settings, [args.image], exec.signal, exec.agent))[0];
        body.generate_type = 'image_to_video';
      }

      const { taskId, task } = await runGeneration(settings, {
        kind: 'video',
        body,
        timeoutMs: settings.taskTimeoutMs,
      });
      return { task_id: taskId, urls: resultURLsOf(task, 'video'), model, node_id: nodeId };
    },
  };
}

/* -------------------------------------------------------------------- */
/* Text                                                                  */
/* -------------------------------------------------------------------- */

function textTool(settings) {
  return {
    name: 'updream_generate_text',
    description:
      '用 Updream 的文本模型生成一段文字，返回纯文本。注意：Updream 的文本接口是**一次独立的问答**——'
      + '它看不到本次对话的上下文，也不能调用任何工具。所以 prompt 必须自带全部必要信息'
      + '（要处理的原文、要求、输出格式都写进 prompt）。适合「用 Updream 的额度跑一段独立的写作、翻译或摘要」，'
      + '不适合接着本会话的思路往下改。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description: '完整的任务描述。它看不到本会话，所以要自包含：要处理的文本、要求、输出格式都写进来。',
        },
        model: { type: 'string', description: '模型 id，例如 deepseek-v4.1-flash、gemini-3.1-pro。不传则用设置页勾选的第一个可用模型。' },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图 URL 或本机路径。只有支持看图的模型会用到它。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['task_id', 'text', 'model'],
        properties: {
          task_id: { type: 'string' },
          text: { type: 'string' },
          model: { type: 'string' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: `${value.text}\n\n[Updream ${value.model} · task ${value.task_id}]` }];
      },
    },
    timeoutMs: 300_000,
    async execute(args, exec) {
      const { client } = settings;
      const listing = await client.models('text').catch(() => ({ models: [], tier: '' }));
      const catalog = listing.models.map((model) => String(model.value ?? ''));
      const usable = listing.models.filter((model) => usableByTier(model, listing.tier)).map((model) => String(model.value ?? ''));
      const model = pickModel(args.model, settings.models?.text, catalog, '文本', usable);
      const body = { prompt: args.prompt, model_name: model };
      if (Array.isArray(args.reference_images) && args.reference_images.length > 0) {
        body.reference_images = await resolveImages(settings, args.reference_images, exec.signal, exec.agent);
      }
      const { taskId, task } = await runGeneration(settings, {
        kind: 'text',
        body,
        timeoutMs: settings.taskTimeoutMs,
      });
      return { task_id: taskId, text: resultTextOf(task), model };
    },
  };
}

/* -------------------------------------------------------------------- */
/* Canvas and assets                                                     */
/* -------------------------------------------------------------------- */

/** Guess an asset kind from a path's extension. */
function kindOfPath(path) {
  const lower = String(path ?? '').toLowerCase();
  if (/\.(mp4|mov|webm|mkv|avi)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(lower)) return 'audio';
  return 'image';
}

/** The project-scoped argument every canvas tool accepts. */
const PROJECT_PARAM = { type: 'string', description: '项目 id。不传则用设置页的默认项目。' };

function canvasTools(settings) {
  return [
    {
      name: 'updream_canvas',
      description:
        '查看 Updream 项目的画布：每个节点的 id、类型、标题、结果地址与任务状态，以及节点之间的连线。'
        + '动节点之前先读这里，不要猜节点 id。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project_id: PROJECT_PARAM,
          full: { type: 'boolean', description: 'true 则带上每个节点的生成历史。默认 false。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['project_id', 'node_count', 'nodes', 'connections'],
          properties: {
            project_id: { type: 'string' },
            node_count: { type: 'integer' },
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'type', 'title', 'result_url', 'task_status'],
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  title: { type: 'string' },
                  result_url: { type: 'string', description: '节点当前结果的地址；空字符串表示还没有结果。' },
                  task_status: { type: 'string' },
                },
              },
            },
            connections: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'from', 'to'],
                properties: {
                  id: { type: 'string' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                },
              },
            },
          },
        },
        render(_args, value) {
          const lines = [`画布 ${value.project_id}：${String(value.node_count)} 个节点，${String(value.connections.length)} 条连线。`];
          for (const node of value.nodes) {
            const url = node.result_url === '' ? '' : ` → ${node.result_url}`;
            const status = node.task_status === '' ? '' : ` [${node.task_status}]`;
            lines.push(`- ${node.id} ${node.type} 「${node.title}」${status}${url}`);
          }
          if (value.connections.length > 0) {
            lines.push('连线：');
            for (const connection of value.connections) lines.push(`- ${connection.from} → ${connection.to} (${connection.id})`);
          }
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const projectId = projectOf(args, settings);
        const canvas = await settings.client.canvas(projectId, { signal: exec.signal, full: args.full === true });
        return {
          project_id: projectId,
          node_count: canvas.nodes.length,
          nodes: canvas.nodes.map((node) => ({
            id: String(node.id ?? ''),
            type: String(node.node_type ?? ''),
            title: String(node.name ?? node.title ?? ''),
            result_url: firstURLOf(node),
            task_status: String(node.task_status ?? ''),
          })),
          connections: canvas.connections.map((connection) => ({
            id: String(connection.id ?? ''),
            from: String(connection.from_node_id ?? ''),
            to: String(connection.to_node_id ?? ''),
          })),
        };
      },
    },
    {
      name: 'updream_node_create',
      description: '在 Updream 画布上新建一个节点。文本节点用来放剧本或提示词，图片与视频节点之后可以接生成。返回新节点的 id。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['text', 'image', 'video', 'audio'], description: '节点类型。' },
          title: { type: 'string', description: '节点标题，显示在画布上。' },
          prompt: { type: 'string', description: '节点上的提示词，即这个节点要生成什么。' },
          model: { type: 'string', description: '节点使用的模型 id，可留空以后再补。' },
          project_id: PROJECT_PARAM,
          x: { type: 'number', description: '画布横坐标。不传由服务端放置。' },
          y: { type: 'number', description: '画布纵坐标。不传由服务端放置。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['node_id', 'type', 'title'],
          properties: {
            node_id: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string' },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: `已在画布上新建 ${value.type} 节点 ${value.node_id}「${value.title}」。` }];
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const projectId = projectOf(args, settings);
        const node = await settings.client.createNode(projectId, {
          node_type: args.type,
          ...args.title === undefined ? {} : { title: args.title },
          ...args.prompt === undefined ? {} : { prompt: args.prompt },
          ...args.model === undefined ? {} : { model_name: args.model },
          ...args.x === undefined ? {} : { x: args.x },
          ...args.y === undefined ? {} : { y: args.y },
        }, { signal: exec.signal });
        return {
          node_id: String(node?.id ?? ''),
          type: String(node?.node_type ?? args.type),
          title: String(node?.name ?? node?.title ?? args.title ?? ''),
        };
      },
    },
    {
      name: 'updream_node_connect',
      description: '把画布上的一个节点连到另一个：上游节点的结果会作为下游生成的参考素材。返回连线 id。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['from_node_id', 'to_node_id'],
        properties: {
          from_node_id: { type: 'string', description: '上游节点 id。' },
          to_node_id: { type: 'string', description: '下游节点 id。' },
          project_id: PROJECT_PARAM,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['connection_id', 'from', 'to'],
          properties: {
            connection_id: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: `已连线 ${value.from} → ${value.to}（${value.connection_id}）。` }];
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const projectId = projectOf(args, settings);
        const connection = await settings.client.connect(projectId, Number(args.from_node_id), Number(args.to_node_id), { signal: exec.signal });
        return {
          connection_id: String(connection?.id ?? ''),
          from: String(connection?.from_node_id ?? args.from_node_id),
          to: String(connection?.to_node_id ?? args.to_node_id),
        };
      },
    },
    {
      name: 'updream_node_delete',
      description: '从画布上删除一个节点。这是软删除，节点进入回收站，可以在 Updream 网页上找回。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['node_id'],
        properties: {
          node_id: { type: 'string', description: '要删除的节点 id。' },
          project_id: PROJECT_PARAM,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['deleted', 'node_id'],
          properties: {
            deleted: { type: 'boolean' },
            node_id: { type: 'string' },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: value.deleted ? `已删除节点 ${value.node_id}。` : `节点 ${value.node_id} 未删除。` }];
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const projectId = projectOf(args, settings);
        await settings.client.deleteNode(projectId, args.node_id, { signal: exec.signal });
        return { deleted: true, node_id: args.node_id };
      },
    },
    {
      name: 'updream_task',
      description:
        '查询一个已经提交的 Updream 生成任务当前的状态与结果，并可选地等它结束。'
        + '生图/生视频/文本工具如果在自己的等待预算内没等到结果，会带着 task_id 报错——'
        + '任务仍在服务端继续跑，用这个工具接着查，不要重新提交（重新提交会再扣一次积分）。'
        + '传 wait: true 则持续轮询到任务结束或 wait_seconds 用完。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task_id'],
        properties: {
          task_id: { type: 'string', description: '提交生成任务时返回的 task_id。' },
          kind: {
            type: 'string',
            enum: ['image', 'video', 'text', 'audio', 'music'],
            description: '任务类型，决定如何解析结果地址。不传则按返回的所有字段尽力提取。',
          },
          wait: { type: 'boolean', description: 'true 则轮询到任务结束或 wait_seconds 用完。默认 false，只查一次。' },
          wait_seconds: {
            type: 'number',
            description: 'wait 为 true 时最多等多久（秒）。默认 60，上限 500。',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['task_id', 'status', 'urls', 'text'],
          properties: {
            task_id: { type: 'string' },
            status: { type: 'string', description: '任务状态，例如 completed、failed、waiting_asset_review。' },
            urls: { type: 'array', items: { type: 'string' } },
            text: { type: 'string', description: '文本任务产出的文字；非文本任务为空字符串。' },
            error: { type: 'string', description: '失败原因；没有失败则为空字符串。' },
          },
        },
        render(_args, value) {
          const lines = [`任务 ${value.task_id}：${value.status}`];
          for (const url of value.urls) lines.push(`- ${url}`);
          if (value.text !== '') lines.push(value.text);
          if (value.error !== '') lines.push(`失败原因：${value.error}`);
          if (value.status !== 'completed' && value.status !== 'failed' && value.error === '') {
            lines.push('任务尚未结束，可以再次调用本工具查询。');
          }
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      timeoutMs: HOST_TOOL_CAP_MS - TOOL_TIMEOUT_MARGIN_MS,
      async execute(args, exec) {
        const taskId = String(args.task_id ?? '').trim();
        if (taskId === '') throw new Error('task_id 不能为空');
        const kind = typeof args.kind === 'string' ? args.kind : 'unknown';

        let task;
        if (args.wait === true) {
          const seconds = Math.max(5, Math.min(500, Number(args.wait_seconds) || 60));
          try {
            task = await settings.client.waitForTask(taskId, {
              signal: exec.signal,
              intervalMs: POLL_INTERVAL_MS,
              timeoutMs: seconds * 1000,
            });
          } catch (cause) {
            // A wait that ran out is not a failed task: report the last known
            // state rather than a bare error, so the model can decide to poll
            // again instead of resubmitting.
            if (cause?.code !== 'TASK_TIMEOUT') throw cause;
            const last = await settings.client.task(taskId, { signal: exec.signal });
            task = last;
          }
        } else {
          task = await settings.client.task(taskId, { signal: exec.signal });
        }

        const status = String(task?.status ?? '');
        const error = status === 'failed' || status === 'cancelled' || status === 'canceled'
          ? String(task?.error?.message ?? task?.error ?? task?.message ?? '未知原因')
          : '';
        return {
          task_id: taskId,
          status,
          urls: status === 'completed' ? resultURLsOf(task, kind) : [],
          text: status === 'completed' && (kind === 'text' || kind === 'unknown') ? resultTextOf(task) : '',
          error,
        };
      },
    },
    {
      name: 'updream_projects',
      description:
        '列出当前账号在 Updream 上的项目（id 与名称）。'
        + '不确定该用哪个 project_id、或者换了账号之后找项目时用它；默认项目在「设置 → Updream」里配置。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search: { type: 'string', description: '按名称过滤，不传则列出最近的。' },
          size: { type: 'number', description: '最多返回多少个，默认 50。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['projects', 'count'],
          properties: {
            count: { type: 'integer' },
            projects: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'name'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  team_id: { type: 'string' },
                },
              },
            },
          },
        },
        render(_args, value) {
          const lines = [`共 ${String(value.count)} 个项目：`];
          for (const project of value.projects) {
            lines.push(`- ${project.id} 「${project.name}」${project.team_id === '' ? '' : ` (team ${project.team_id})`}`);
          }
          if (value.count === 0) lines.push('（这个账号下还没有项目，可以先用 updream_node_create 的 project_id 指定，或在网页上新建一个）');
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const size = Math.max(1, Math.min(100, Number(args.size) || 50));
        const projects = await settings.client.projects({
          size,
          search: typeof args.search === 'string' && args.search.trim() !== '' ? args.search.trim() : undefined,
          signal: exec.signal,
        });
        return {
          count: projects.length,
          projects: projects.map((project) => ({
            id: String(project.project_id ?? project.id ?? ''),
            name: String(project.name ?? ''),
            team_id: String(project.team_id ?? ''),
          })).filter((project) => project.id !== ''),
        };
      },
    },
    {
      name: 'updream_node_update',
      description:
        '修改画布上已有节点的字段：标题、提示词、模型、生成参数、坐标。'
        + '只改动你显式传的字段，其余保持不变。想让某个节点改生成内容而不必删了重建时用它。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['node_id'],
        properties: {
          node_id: { type: 'string', description: '要修改的节点 id。' },
          title: { type: 'string', description: '新的节点标题。' },
          prompt: { type: 'string', description: '新的提示词。' },
          model: { type: 'string', description: '新的模型 id。' },
          x: { type: 'number', description: '新的画布横坐标。' },
          y: { type: 'number', description: '新的画布纵坐标。' },
          project_id: PROJECT_PARAM,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['node_id', 'updated_fields'],
          properties: {
            node_id: { type: 'string' },
            updated_fields: { type: 'array', items: { type: 'string' }, description: '实际提交的字段名。' },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: `已更新节点 ${value.node_id}：${value.updated_fields.join('、')}。` }];
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        // Only the fields the caller named, mapped to their wire names. Sending
        // the whole node back would clobber `node_type` and the result history.
        const patch = {};
        if (typeof args.title === 'string') { patch.title = args.title; patch.name = args.title; }
        if (typeof args.prompt === 'string') patch.prompt = args.prompt;
        if (typeof args.model === 'string') patch.model_name = args.model;
        if (typeof args.x === 'number') patch.x = args.x;
        if (typeof args.y === 'number') patch.y = args.y;
        if (Object.keys(patch).length === 0) {
          throw new Error('没有要修改的字段：至少传 title、prompt、model、x 或 y 之一');
        }
        await settings.client.updateNode(args.node_id, patch, { signal: exec.signal });
        return { node_id: args.node_id, updated_fields: Object.keys(patch).filter((key) => key !== 'name') };
      },
    },
    {
      name: 'updream_node_disconnect',
      description:
        '删除画布上的一条连线。连线 id 从 updream_canvas 的 connections 里读，不要猜。'
        + '只删连线，两个节点都还在。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['connection_id'],
        properties: {
          connection_id: { type: 'string', description: '要删除的连线 id。' },
          project_id: PROJECT_PARAM,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['disconnected', 'connection_id'],
          properties: {
            disconnected: { type: 'boolean' },
            connection_id: { type: 'string' },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: value.disconnected ? `已删除连线 ${value.connection_id}。` : `连线 ${value.connection_id} 未删除。` }];
        },
      },
      timeoutMs: 60_000,
      async execute(args, exec) {
        const connectionId = String(args.connection_id ?? '').trim();
        if (connectionId === '') throw new Error('connection_id 不能为空');
        await settings.client.disconnect(connectionId, { signal: exec.signal });
        return { disconnected: true, connection_id: connectionId };
      },
    },
    {
      name: 'updream_asset_upload',
      description:
        '把一个本地文件上传到 Updream，返回可公网访问的地址。把这个地址传给生成工具就能当参考图、首帧或素材。'
        + '图片上限 20 MB，音视频上限 50 MB。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: '本机文件路径：绝对路径，或相对当前工作目录的路径。' },
          kind: { type: 'string', enum: ['image', 'video', 'audio'], description: '素材类型。不传则按扩展名判断。' },
          project_id: PROJECT_PARAM,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'name', 'kind'],
          properties: {
            url: { type: 'string' },
            name: { type: 'string' },
            kind: { type: 'string' },
          },
        },
        render(_args, value) {
          return [{ type: 'text', text: `已上传 ${value.name}（${value.kind}）：${value.url}` }];
        },
      },
      timeoutMs: 180_000,
      async execute(args, exec) {
        const kind = typeof args.kind === 'string' ? args.kind : kindOfPath(args.path);
        const file = await settings.readMediaFile(args.path, kind, exec.signal, exec.agent);
        const uploaded = await settings.client.upload(file, kind, { signal: exec.signal });
        return { url: uploaded.url, name: uploaded.name, kind };
      },
    },
  ];
}

/**
 * The project-deletion tool.
 *
 * Kept out of the canvas group on purpose: node deletion is a soft delete with
 * a trash, project deletion is not — Updream has no restore route for projects,
 * so this one needs its own switch and an explicit confirmation argument.
 * @param settings - live settings bundle.
 * @returns the tool definition.
 */
function projectDeleteTool(settings) {
  return {
    name: 'updream_project_delete',
    description:
      '删除一个 Updream 项目。**不可恢复**：Updream 没有项目回收站，删掉后画布上的节点、连线和素材一起消失。'
      + '传 confirm: true 才会真的执行；不传则只返回该项目当前的内容摘要（节点数、类型、是否有产出），'
      + '用来确认删的是不是你想删的那个。删除前务必让用户确认过。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['project_id'],
      properties: {
        project_id: { type: 'string', description: '要删除的项目 id。必须是项目 id，不是节点 id。' },
        confirm: {
          type: 'boolean',
          description: '必须显式为 true 才执行删除。省略或 false 时只做只读检查，不删任何东西。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['project_id', 'deleted', 'node_count', 'node_types', 'has_output'],
        properties: {
          project_id: { type: 'string' },
          deleted: { type: 'boolean', description: 'true 表示确实删除了；false 表示只是检查。' },
          node_count: { type: 'integer', description: '删除时该项目画布上的节点数。' },
          node_types: { type: 'array', items: { type: 'string' }, description: '节点类型汇总，例如 image、video。' },
          has_output: { type: 'boolean', description: '是否有节点带生成结果（图片、视频、音频地址）。' },
        },
      },
      render(_args, value) {
        const types = value.node_types.length === 0 ? '无节点' : value.node_types.join('、');
        if (!value.deleted) {
          return [{
            type: 'text',
            text: `【检查】项目 ${value.project_id} 有 ${String(value.node_count)} 个节点（${types}）`
              + `${value.has_output ? '，其中包含已生成的结果' : ''}。尚未删除——确认要删就带 confirm: true 再调用一次。`,
          }];
        }
        return [{
          type: 'text',
          text: `已删除项目 ${value.project_id}（删除时有 ${String(value.node_count)} 个节点：${types}）。此操作不可恢复。`,
        }];
      },
    },
    timeoutMs: 60_000,
    async execute(args, exec) {
      const projectId = String(args.project_id ?? '').trim();
      if (projectId === '') throw new Error('project_id 不能为空');

      // Read first, delete second: the summary is what makes the deletion
      // auditable afterwards, and it also turns a typo'd id into a NOT_FOUND
      // before anything is destroyed.
      const canvas = await settings.client.canvas(projectId, { signal: exec.signal });
      const nodeTypes = [...new Set(canvas.nodes.map((node) => String(node.node_type ?? '')).filter((type) => type !== ''))];
      const hasOutput = canvas.nodes.some((node) => firstURLOf(node) !== '');
      const summary = {
        project_id: projectId,
        node_count: canvas.nodes.length,
        node_types: nodeTypes,
        has_output: hasOutput,
      };

      if (args.confirm !== true) return { ...summary, deleted: false };

      await settings.client.deleteProject(projectId, { signal: exec.signal });
      return { ...summary, deleted: true };
    },
  };
}

/**
 * The first result URL a canvas node carries, across node kinds.
 * @param node - one canvas node document.
 * @returns the URL, or an empty string when the node has no result yet.
 */
function firstURLOf(node) {
  // `image_url` was missing here until it was noticed that an image node's
  // result never showed up in `updream_canvas`, and `has_output` read false for
  // a project that was full of finished pictures. Cover art is checked last:
  // a video node carries both a `cover_url` thumbnail and a `video_url`, and
  // reporting the thumbnail as "the result" is how the model ends up handing
  // the user a `.jpg` where it promised a video.
  for (const key of ['image_url', 'video_url', 'audio_url', 'result_url', 'cover_url']) {
    const value = node?.[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return '';
}
