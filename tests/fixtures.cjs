// Shared fixtures + theme token values for the preview harness.
//
// Token values mirror what the running DSH web shell puts on :root, so a
// screenshot from this harness is comparable to the real page in both themes.

const ACCOUNTS = [
  { id: 'account-11111111', label: '账号甲', username: 'demo-user', maskedKey: 'sk-DEMO…XXXX', active: true },
  { id: 'account-22222222', label: '账号乙', username: 'demo-alt', maskedKey: 'sk-DEMO…XXXX', active: false },
];

const CONFIG = {
  baseURL: 'https://www.updream.cn/api',
  teamId: '',
  defaultProjectId: '380023299579543552',
  pollIntervalMs: 300000,
  showCreditsBadge: true,
  allowImageTools: true,
  allowVideoTools: false,
  allowTextTool: false,
  allowCanvasTools: true,
  allowProjectDelete: false,
  imageModels: ['seedream-5.5', 'qwen-image-3.0-pro'],
  videoModels: [],
  textModels: [],
};

const STATUS = {
  connected: true,
  config: CONFIG,
  accounts: ACCOUNTS,
  activeAccountId: 'account-11111111',
  user: { id: '100001', username: 'demo-user' },
  credits: { available: '28750.0000' },
  lastError: '',
};

const CREDITS = {
  available: '28750.0000',
  tier: 'personal',
  account: { id: 'account-11111111', label: '账号甲', username: 'demo-user' },
};

const PER_ACCOUNT = {
  'account-11111111': { available: '28750.0000', username: 'demo-user', tier: 'personal' },
  'account-22222222': { available: '945.0000', username: 'demo-alt', tier: 'personal' },
};

const PROJECTS = [
  { id: '380023299579543552', name: '未命名项目' },
  { id: '380023299579540001', name: '睡眠科普片头' },
];

const MODELS = {
  image: [
    { id: 'seedream-5.5', label: 'Seedream 5.5', tier: 'origin' },
    { id: 'qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro', tier: 'origin' },
    { id: 'b-pro', label: '绘梦（专业版）', tier: 'pro' },
    { id: 'midjourney', label: 'midjourney', tier: 'pro' },
  ],
  video: [
    { id: 'seedance-1.0-lite', label: 'Seedance 1.0 Lite', tier: 'origin' },
    { id: 'kling-v2-pro', label: 'Kling v2 Pro', tier: 'pro' },
  ],
  text: [
    { id: 'ud-text-1', label: 'Updream Text 1', tier: 'origin' },
  ],
};

const fetch = async (url, init) => {
  const target = String(url);
  const ok = (data) => ({ json: async () => ({ ok: true, data }) });
  if (target.includes('/accounts/credits')) {
    // Per-account reads must return DIFFERENT figures: a stub that answers the
    // same number for every id makes a broken per-row lookup look correct.
    const body = JSON.parse(init?.body ?? '{}');
    return ok(PER_ACCOUNT[body.id] ?? { available: null });
  }
  if (target.includes('/credits')) return ok(CREDITS);
  if (target.includes('/models')) return ok(MODELS);
  if (target.includes('/projects')) return ok({ projects: PROJECTS });
  return ok(STATUS);
};

const DARK_TOKENS = {
  '--dsw-alias-bg-base': '#131417',
  '--dsw-alias-bg-layer-1': '#1a1b1f',
  '--dsw-alias-bg-layer-2': '#202228',
  '--dsw-alias-bg-overlay': '#26272d',
  '--dsw-alias-border-l1': 'rgba(255,255,255,.10)',
  '--dsw-alias-border-l2': 'rgba(255,255,255,.18)',
  '--dsw-alias-brand-primary': '#5686fe',
  '--dsw-alias-label-primary': '#e8eaee',
  '--dsw-alias-label-secondary': '#a9aeb8',
  '--dsw-alias-label-tertiary': '#7c828e',
  '--dsw-alias-label-caption': '#6a707c',
  '--dsw-alias-state-error-primary': '#e5534b',
  '--dsw-alias-state-idle-primary': '#6b7280',
  '--dsw-alias-state-success-primary': '#22a06b',
  '--dsw-alias-state-warn-primary': '#f59e0b',
  '--dsw-specific-sidebar-fill': '#0f1013',
};

const LIGHT_TOKENS = {
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-layer-1': '#f7f8fa',
  '--dsw-alias-bg-layer-2': '#f0f1f4',
  '--dsw-alias-bg-overlay': '#ffffff',
  '--dsw-alias-border-l1': 'rgba(16,24,40,.10)',
  '--dsw-alias-border-l2': 'rgba(16,24,40,.20)',
  '--dsw-alias-brand-primary': '#2f6bff',
  '--dsw-alias-label-primary': '#17191d',
  '--dsw-alias-label-secondary': '#4d5563',
  '--dsw-alias-label-tertiary': '#7a8290',
  '--dsw-alias-label-caption': '#8b929e',
  '--dsw-alias-state-error-primary': '#d92d20',
  '--dsw-alias-state-idle-primary': '#98a2b3',
  '--dsw-alias-state-success-primary': '#12b76a',
  '--dsw-alias-state-warn-primary': '#dc6803',
  '--dsw-specific-sidebar-fill': '#fafbfc',
};

module.exports = { ACCOUNTS, CONFIG, STATUS, CREDITS, PER_ACCOUNT, PROJECTS, MODELS, fetch, DARK_TOKENS, LIGHT_TOKENS };
