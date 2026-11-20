/* build: 2026-11-20T14:24:18.507Z */
/*
 * Browser half of dsh-connect-updream.
 *
 * Registered into two slots:
 *   - `settings.section` (+ its nav icon): the management page — credentials,
 *     default project, generation model pinning, capability switches.
 *   - `conversation.input.right`: the credit readout next to the model picker.
 *
 * Everything here talks to the Host through this bundle's own HTTP routes
 * (`/plugins/dsh-connect-updream/*`); no Updream API key ever reaches the
 * browser. The Host half owns credentials, upstream calls, and caching.
 */
window.__ModuleLoader__.load({
  id: 'dsh-connect-updream',
  factory: (require) => {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef, useCallback, Fragment } = React;

    /* ------------------------------------------------------------------ */
    /* Host routes                                                         */
    /* ------------------------------------------------------------------ */

    const BASE = '/plugins/dsh-connect-updream';
    const ROUTE = {
      status: `${BASE}/status`,
      save: `${BASE}/config`,
      projects: `${BASE}/projects`,
      models: `${BASE}/models`,
      verify: `${BASE}/verify`,
      activate: `${BASE}/accounts/activate`,
      rename: `${BASE}/accounts/rename`,
      remove: `${BASE}/accounts/remove`,
      accountCredits: `${BASE}/accounts/credits`,
      image: `${BASE}/image`,
      video: `${BASE}/video`,
      text: `${BASE}/text`,
      canvas: `${BASE}/canvas`,
      upload: `${BASE}/upload`,
      credits: `${BASE}/credits`,
    };

    /** Perform one Host call; every route answers `{ ok, data | error }`. */
    async function call(url, init) {
      const response = await fetch(url, {
        headers: { accept: 'application/json', ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...init,
      });
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`Updream 插件路由无响应（HTTP ${response.status}）`);
      }
      if (!body || body.ok !== true) throw new Error(body?.error || `请求失败（HTTP ${response.status}）`);
      return body.data;
    }

    const post = (url, payload) => call(url, { method: 'POST', body: JSON.stringify(payload ?? {}) });

    /* ------------------------------------------------------------------ */
    /* Copy                                                                */
    /* ------------------------------------------------------------------ */

    const COPY = {
      zh: {
        title: 'Updream',
        subtitle: '把 Updream（updream.cn）的图片、视频与文本生成接入 DSH：画布节点、素材上传与积分读数。',
        accounts: '账号',
        noAccounts: '还没有添加任何账号。粘一个 Updream API Key，点「添加账号」。',
        addAccount: '添加账号',
        adding: '验证中…',
        addAccountHint: '每个 Key 就是一个独立账号：添加多个即可在下面切换。',
        active: '当前',
        switchTo: '切换',
        creditsPanelTitle: 'Updream 积分',
        refresh: '刷新',
        refreshHint: '重新读取当前账号的积分余额',
        refreshing: '正在刷新…',
        lastRefresh: '最近刷新',
        refreshFailed: '积分刷新失败',
        accountColumn: '账号',
        creditsColumn: '积分',
        currentAccount: '当前选用',
        noAccountsShort: '还没有添加任何账号',
        openSettings: '设置',
        openSettingsHint: '打开本插件的完整页面（账号、模型、各项开关）',
        renameAccount: '重命名',
        removeAccount: '移除',
        removeConfirm: '确要从本插件里移除这个账号？只删掉本机保存的 Key，不会影响 Updream 里的账号。',
        accountKeyPlaceholder: '粘贴这个账号的 sk-… Key',
        accountLabelPlaceholder: '给这个账号起个名字（可留空）',
        accountCredits: '刷新余额',
        neverUsed: '未使用',
        lastError: '最近一次错误',
        tabAccount: '账号',
        tabModels: '模型',
        tabAbility: '能力',
        tabDiagnostics: '诊断',
        keySaved: '已保存',
        keyMissing: '未配置',
        verify: '验证',
        verifying: '验证中…',
        verifiedAs: '已连接',
        defaultProject: '默认项目',
        defaultProjectHint: '生成与画布操作未显式指定项目时使用它。留空则在每次调用时要求指定。',
        pickProject: '刷新项目列表',
        noProjects: '没有找到项目，请先在 Updream 网页创建。',
        save: '保存',
        discard: '放弃',
        saved: '已保存',
        unsaved: '有未保存的改动',
        modelsHint: '勾选后会出现在可用的生成工具里。图片与视频工具的模型由这里决定。',
        loadProjectsHint: '点「刷新模型目录」读取可用模型。',
        abilityHint: '这些开关决定模型能调用哪些 Updream 工具，以及是否在输入框显示积分。',
        refreshModels: '刷新模型目录',
        selectOrigin: '全选 origin',
        selectOriginHint: '只勾选当前会员档位（origin）可用的模型；pro 档位的模型勾了也调用不了。',
        selectAll: '全选',
        selectNone: '全不选',
        clearAll: '取消 origin',
        allowImage: '允许模型自主生图',
        allowImageHint: '打开后注册 updream_generate_image；每次调用都真实扣积分。',
        allowVideo: '允许模型自主生视频',
        allowVideoHint: '打开后注册 updream_generate_video；视频按秒计费，一次调用消耗较大。',
        allowText: '允许模型自主调用 Updream 文本模型',
        allowTextHint: '打开后注册 updream_generate_text。Updream 文本接口不支持多轮与工具调用，只是一次独立的问答。',
        allowCanvas: '允许模型读写画布',
        allowCanvasHint: '打开后注册画布查看、建节点、连线与素材上传工具。',
        allowProjectDelete: '允许模型删除项目',
        allowProjectDeleteHint: '打开后注册 updream_project_delete。项目删除「不可恢复」（Updream 没有项目回收站），调用时还需要显式 confirm。',
        creditsBadge: '积分读数',
        creditsBadgeHint: '在输入框工具栏显示当前账号剩余积分。',
        region: '区域',
        baseURL: 'API 地址',
        baseURLHint: '默认 https://www.updream.cn/api，团队空间带 /api 前缀。',
        teamId: '团队 ID',
        teamIdHint: '使用团队空间时填写；个人空间留空。',
        pollInterval: '刷新间隔',
        pollIntervalHint: '积分读数多久重新读取一次。',
        diagnostics: '诊断',
        diagnosticsHint: '只读事实，可整段复制到问题反馈里。',
        accountsTab: '账号',
        modelsTab: '模型',
        abilityTab: '能力',
        diagnosticsTab: '诊断',
        addAccountAction: '添加',
        labelPlaceholder: '备注名（可选）',
        projectNone: '不设置',
        loadProjects: '读取项目',
        readCredits: '读余额',
        saving: '保存中…',
        connected: '连接',
        user: '用户',
        tier: '会员档位',
        balance: '剩余积分',
        lastError: '最近一次错误',
        none: '无',
        never: '从未',
        loading: '读取中…',
        fail: '失败',
        ok: '成功',
        copy: '复制',
        copied: '已复制',
        logoAlt: 'Updream 图标',
      },
      en: {
        title: 'Updream',
        subtitle: 'Bring Updream (updream.cn) image, video, and text generation into DSH: canvas nodes, asset upload, and a credit readout.',
        accounts: 'Accounts',
        noAccounts: 'No accounts yet. Paste an Updream API key and choose Add account.',
        addAccount: 'Add account',
        adding: 'Verifying…',
        addAccountHint: 'Each key is its own account. Add several to switch between them below.',
        active: 'Active',
        switchTo: 'Switch',
        creditsPanelTitle: 'Updream credits',
        refresh: 'Refresh',
        refreshHint: 'Re-read the current account’s credit balance',
        refreshing: 'Refreshing…',
        lastRefresh: 'Last refresh',
        refreshFailed: 'Credit refresh failed',
        accountColumn: 'Account',
        creditsColumn: 'Credits',
        currentAccount: 'Current',
        noAccountsShort: 'No accounts yet',
        openSettings: 'Settings',
        openSettingsHint: 'Open this plugin’s full page (accounts, models, switches)',
        renameAccount: 'Rename',
        removeAccount: 'Remove',
        removeConfirm: 'Remove this account from the plugin? Only the locally stored key is deleted; the Updream account itself is untouched.',
        accountKeyPlaceholder: 'Paste this account\u2019s sk-… key',
        accountLabelPlaceholder: 'Name this account (optional)',
        accountCredits: 'Refresh balance',
        neverUsed: 'unused',
        lastError: 'Last error',
        tabAccount: 'Account',
        tabModels: 'Models',
        tabAbility: 'Capabilities',
        tabDiagnostics: 'Diagnostics',
        keySaved: 'Saved',
        keyMissing: 'Not configured',
        verify: 'Verify',
        verifying: 'Verifying…',
        verifiedAs: 'Connected',
        defaultProject: 'Default project',
        defaultProjectHint: 'Used when a generation or canvas call names none. Leave empty to require an explicit project per call.',
        pickProject: 'Refresh projects',
        noProjects: 'No projects found. Create one on updream.cn first.',
        save: 'Save',
        discard: 'Discard',
        saved: 'Saved',
        unsaved: 'Unsaved changes',
        modelsHint: 'Checked models become available to the generation tools. Image and video tools take their model from here.',
        loadProjectsHint: 'Choose Refresh catalog to load the available models.',
        abilityHint: 'These switches decide which Updream tools the model may call, and whether the composer shows a credit readout.',
        refreshModels: 'Refresh catalog',
        selectOrigin: 'All origin',
        selectOriginHint: 'Selects only the models this tier (origin) can run; pro rows would fail even when ticked.',
        selectAll: 'All',
        selectNone: 'None',
        clearAll: 'Drop origin',
        allowImage: 'Let the model generate images',
        allowImageHint: 'Registers updream_generate_image. Every call spends real credits.',
        allowVideo: 'Let the model generate video',
        allowVideoHint: 'Registers updream_generate_video. Video is billed per second and costs more per call.',
        allowText: 'Let the model call Updream text models',
        allowTextHint: 'Registers updream_generate_text. The Updream text API has no multi-turn or tool calling — it is one standalone answer.',
        allowCanvas: 'Let the model read and write the canvas',
        allowCanvasHint: 'Registers canvas inspection, node creation, connections, and asset upload tools.',
        allowProjectDelete: 'Let the model delete projects',
        allowProjectDeleteHint: 'Registers updream_project_delete. Project deletion is NOT recoverable (Updream has no project trash), and calls still need an explicit confirm.',
        creditsBadge: 'Credit readout',
        creditsBadgeHint: 'Show the remaining credits in the composer toolbar.',
        region: 'Region',
        baseURL: 'API base URL',
        baseURLHint: 'Defaults to https://www.updream.cn/api. Team spaces keep the /api prefix.',
        teamId: 'Team id',
        teamIdHint: 'Fill in for a team space; leave empty for a personal one.',
        pollInterval: 'Refresh interval',
        pollIntervalHint: 'How often the credit readout re-reads the balance.',
        diagnostics: 'Diagnostics',
        diagnosticsHint: 'Read-only facts, safe to paste into a bug report.',
        accountsTab: 'Accounts',
        modelsTab: 'Models',
        abilityTab: 'Ability',
        diagnosticsTab: 'Diagnostics',
        addAccountAction: 'Add',
        labelPlaceholder: 'Label (optional)',
        projectNone: 'Not set',
        loadProjects: 'Load projects',
        readCredits: 'Read',
        saving: 'Saving…',
        connected: 'Connection',
        user: 'User',
        tier: 'Tier',
        balance: 'Credits',
        lastError: 'Last error',
        none: 'none',
        never: 'never',
        loading: 'Loading…',
        fail: 'Failed',
        ok: 'Succeeded',
        copy: 'Copy',
        copied: 'Copied',
        logoAlt: 'Updream icon',
      },
    };

    /** Locale namespace this bundle's strings are filed under. */
    const namespace = 'dsh-connect-updream';

    function pickCopy(language) {
      return String(language || '').toLowerCase().startsWith('zh') ? COPY.zh : COPY.en;
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    /*
     * The stylesheet is authored in src/ui.css and embedded here verbatim by
     * tests/build_client.mjs. It stays a real .css file so it can be read,
     * diffed and linted as CSS — as the inside of a template literal, a single
     * stray backtick silently truncates the file, which is what happened to
     * the previous build.
     *
     * Every colour is one of the 16 tokens the shell registers, with NO
     * hardcoded fallback: a renamed token then breaks loudly in both themes
     * instead of quietly pinning one theme’s colour onto the other.
     */
    const CSS = `
/* ==================================================================== */
/*  dsh-connect-updream — stylesheet (rewritten)                        */
/*                                                                      */
/*  Every colour here is one of the 16 theme tokens the DSH shell        */
/*  actually registers, with NO hardcoded fallback: if the shell ever    */
/*  renames a token the bug is loud in both themes instead of silently   */
/*  pinning a dark colour onto a light page.                            */
/*                                                                      */
/*  Class families, all of them referenced by client.js:                 */
/*    dcu-page / dcu-head        page frame and masthead                  */
/*    dcu-tabbar / dcu-tab       section switcher                        */
/*    dcu-card / dcu-card-*      grouped surface                         */
/*    dcu-row / dcu-row-*        one line of settings data               */
/*    dcu-acct-*                 account rows                            */
/*    dcu-model-*                model rows                              */
/*    dcu-switch / dcu-switchrow capability toggles                      */
/*    dcu-btn / dcu-badge        controls                                */
/*    dcu-savebar                sticky commit bar                       */
/*    dcu-pill / dcu-pop         composer credit readout                 */
/*  NOTE: no backticks anywhere in this file. It is embedded in a         */
/*  template literal, and one stray backtick cuts the file in half.      */
/* ==================================================================== */

/* -------------------------------------------------------------------- */
/* Page frame                                                            */
/* -------------------------------------------------------------------- */

.dcu-page{
  display:flex;flex-direction:column;
  margin:0;padding:0 0 8px;
  color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:20px;
}

/* Masthead: the plugin's identity, then a one-line promise of what the page
   does. The icon is a filled disc rather than a bare glyph so the page opens
   with a colour anchor at the top-left, matching how the shell's own settings
   sections start. */
.dcu-head{
  display:flex;align-items:center;gap:12px;
  padding:4px 0 16px;
}
.dcu-head-icon{
  flex:none;display:grid;place-items:center;
  width:36px;height:36px;border-radius:10px;
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);
  color:var(--dsw-alias-brand-primary);
}
.dcu-head-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.dcu-head-title{margin:0;font-size:15px;line-height:22px;font-weight:600;letter-spacing:-.01em}
.dcu-head-desc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
  overflow-wrap:anywhere}

/* -------------------------------------------------------------------- */
/* Tabs                                                                  */
/* -------------------------------------------------------------------- */

/* A rule under the whole row, with the active tab's own rule drawn on top of
   it. That is the one selected-state shape that stays legible at 13px without
   borrowing the brand colour for a filled chip (which would compete with the
   save button at the bottom of the same page). */
.dcu-tabbar{
  display:flex;align-items:stretch;gap:4px;
  margin:0 0 16px;padding:0;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.dcu-tab{
  appearance:none;flex:none;position:relative;
  margin:0 0 -1px;padding:7px 12px 9px;
  border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;
  background:transparent;
  color:var(--dsw-alias-label-tertiary);
  font:inherit;font-size:13px;line-height:20px;font-weight:500;
  white-space:nowrap;cursor:pointer;
  transition:color .14s ease,border-color .14s ease,background-color .14s ease;
}
.dcu-tab:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
/* The active tab states itself three ways — colour, weight, and the underline —
   because any ONE of them alone is easy to miss next to four peers. */
.dcu-tab-on{
  color:var(--dsw-alias-label-primary);
  font-weight:600;
  border-bottom-color:var(--dsw-alias-brand-primary);
  background:transparent;
}
.dcu-tab-on:hover{color:var(--dsw-alias-label-primary);background:transparent}
.dcu-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dcu-tab:disabled{opacity:.45;cursor:default}

/* -------------------------------------------------------------------- */
/* Cards                                                                 */
/* -------------------------------------------------------------------- */

.dcu-card{
  margin:0 0 12px;padding:0;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;
  background:var(--dsw-alias-bg-layer-1);
  overflow:hidden;
}
.dcu-card:last-child{margin-bottom:0}
.dcu-card-head{
  display:flex;align-items:center;gap:10px;
  padding:11px 14px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.dcu-card-title{margin:0;font-size:13px;line-height:20px;font-weight:600;
  color:var(--dsw-alias-label-primary)}
.dcu-card-desc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
  overflow-wrap:anywhere}
.dcu-card-actions{margin-left:auto;display:flex;align-items:center;gap:6px}
.dcu-card-body{padding:14px}
.dcu-card-body-flush{padding:0}

/* A footnote inside a card: quieter than the data, never a second title. */
.dcu-note{
  margin:8px 0 0;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;
}
.dcu-note-flush{margin:0;padding:10px 14px}

/* -------------------------------------------------------------------- */
/* Buttons                                                               */
/* -------------------------------------------------------------------- */

.dcu-btn{
  appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  flex:none;margin:0;padding:0 12px;height:30px;
  border:1px solid transparent;border-radius:8px;
  font:inherit;font-size:12px;line-height:18px;font-weight:500;
  white-space:nowrap;cursor:pointer;
  transition:background-color .13s ease,border-color .13s ease,color .13s ease,opacity .13s ease;
}
.dcu-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dcu-btn:disabled{opacity:.45;cursor:default}

/* Secondary: an outline that fills in on hover. Used for every reversible
   action, so the destructive one is the only filled control on the row. */
.dcu-btn-quiet{
  border-color:var(--dsw-alias-border-l2);
  background:transparent;
  color:var(--dsw-alias-label-secondary);
}
.dcu-btn-quiet:hover:not(:disabled){
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-label-tertiary);
  color:var(--dsw-alias-label-primary);
}

/* Primary: the brand colour, and the ONLY place white-on-brand is used. The
   old build filled this with the text colour and painted the label in a token
   that does not exist, which is how it rendered invisible in the light theme. */
.dcu-btn-brand{
  background:var(--dsw-alias-brand-primary);
  border-color:var(--dsw-alias-brand-primary);
  color:#fff;
}
.dcu-btn-brand:hover:not(:disabled){filter:brightness(1.08)}
.dcu-btn-brand:active:not(:disabled){filter:brightness(.94)}

/* Danger: only on the one irreversible control (remove an account). Outline at
   rest and filled on hover, so it is found when looked for and never mistaken
   for the primary action. */
.dcu-btn-danger{
  border-color:var(--dsw-alias-border-l2);
  background:transparent;
  color:var(--dsw-alias-label-secondary);
}
.dcu-btn-danger:hover:not(:disabled){
  border-color:var(--dsw-alias-state-error-primary);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);
  color:var(--dsw-alias-state-error-primary);
}

/* A button that only carries an icon: square, so a row of them aligns. */

/* Sizes: small is for controls that sit INSIDE a data row, where a 30px button
   would set the row height and make the table read as a toolbar. */
.dcu-btn-sm{height:26px;padding:0 10px;font-size:12px;border-radius:7px}

/* -------------------------------------------------------------------- */
/* Inputs                                                                */
/* -------------------------------------------------------------------- */

.dcu-input{
  appearance:none;flex:1 1 auto;min-width:0;
  margin:0;padding:0 10px;height:30px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
  font:inherit;font-size:13px;line-height:18px;
  transition:border-color .13s ease,box-shadow .13s ease;
}
.dcu-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dcu-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.dcu-input:disabled{opacity:.55;cursor:default}
.dcu-input-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}

/* A native select, restyled. The caret is drawn in CSS rather than taken from
   an icon font, because the host's icon names differ between DSH lines. */
.dcu-select{
  appearance:none;flex:1 1 auto;min-width:0;position:relative;
  margin:0;padding:0 30px 0 10px;height:30px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
  font:inherit;font-size:13px;line-height:18px;
  cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),
                   linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 15px) 13px,calc(100% - 10px) 13px;
  background-size:5px 5px,5px 5px;
  background-repeat:no-repeat;
}
.dcu-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.dcu-select:disabled{opacity:.55;cursor:default}

/* -------------------------------------------------------------------- */
/* Rows — the shared line shape behind every list on the page            */
/* -------------------------------------------------------------------- */

.dcu-row{
  display:flex;align-items:center;gap:10px;
  margin:0;padding:10px 14px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  min-height:44px;
}
.dcu-row:last-child{border-bottom:0}

/* A row that IS a control (the clickable account rows in the popover, the model
   checkboxes) lifts its background on hover and nothing else — no border
   change, so a hovered row in a list of twelve does not make the list jump. */
.dcu-row-button{
  appearance:none;width:100%;box-sizing:border-box;
  border:0;border-bottom:1px solid var(--dsw-alias-border-l1);
  border-radius:0;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer;
}
.dcu-row-button:last-child{border-bottom:0}
.dcu-row-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dcu-row-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dcu-row-button:disabled{cursor:default}

/* The flexible middle of a row: a title over an optional second line. min-width
   is what lets the ellipsis actually work inside a flex line. */
.dcu-row-main{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.dcu-row-title{font-size:13px;line-height:20px;font-weight:500;
  color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcu-row-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* -------------------------------------------------------------------- */
/* Account rows                                                          */
/* -------------------------------------------------------------------- */

/* The avatar dot: a ring that becomes a filled brand disc for the active
   account. It reads at a glance in a column of eight rows, which a text badge
   does not. */
.dcu-acct-dot{
  flex:none;width:8px;height:8px;border-radius:50%;
  background:var(--dsw-alias-border-l2);
}
.dcu-acct-dot-on{background:var(--dsw-alias-brand-primary)}

/* The balance column. Tabular numerals and a right edge shared by every row:
   figures that shift a character left per row are unreadable as a column. */
.dcu-acct-credits{
  flex:none;min-width:72px;text-align:right;
  font-size:13px;line-height:20px;font-weight:600;
  font-variant-numeric:tabular-nums;white-space:nowrap;
  color:var(--dsw-alias-label-primary);
}

.dcu-acct-actions{flex:none;display:flex;align-items:center;gap:6px}

/* -------------------------------------------------------------------- */
/* Badges                                                                */
/* -------------------------------------------------------------------- */

.dcu-badge{
  display:inline-flex;align-items:center;flex:none;gap:4px;
  padding:0 7px;height:20px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l2);
  background:transparent;
  color:var(--dsw-alias-label-tertiary);
  font-size:11px;line-height:18px;font-weight:500;white-space:nowrap;
}
.dcu-badge-brand{
  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);
  color:var(--dsw-alias-brand-primary);
}
.dcu-badge-ok{
  border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);
  color:var(--dsw-alias-state-success-primary);
}
.dcu-badge-warn{
  border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);
  color:var(--dsw-alias-state-warn-primary);
}
.dcu-badge-error{
  border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);
  color:var(--dsw-alias-state-error-primary);
}

/* -------------------------------------------------------------------- */
/* Models                                                                */
/* -------------------------------------------------------------------- */

/* Each model is a label wrapping a native checkbox. The checkbox keeps the
   platform's own rendering with accent-color — a hand-drawn one drifts in
   size between engines and looks blurry at the 13px the list uses. */
.dcu-model{
  display:flex;align-items:center;gap:10px;
  margin:0;padding:8px 14px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  cursor:pointer;
  transition:background-color .12s ease;
}
.dcu-model:last-child{border-bottom:0}
.dcu-model:hover{background:var(--dsw-alias-bg-layer-2)}
.dcu-model input{
  flex:none;margin:0;width:14px;height:14px;
  accent-color:var(--dsw-alias-brand-primary);cursor:pointer;
}
/* A model this tier cannot run stays listed (the catalogue is the catalogue)
   but reads as unavailable instead of pretending to be selectable. */
.dcu-model-off{opacity:.6}
.dcu-model-name{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;
  color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcu-model-id{
  flex:none;max-width:180px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* The per-kind toolbar (select origin / all / none) sits under the card head
   and above the rows, separated by the same hairline every list uses. */

/* -------------------------------------------------------------------- */
/* Capability switches                                                   */
/* -------------------------------------------------------------------- */

.dcu-switchrow{
  display:flex;align-items:flex-start;gap:16px;
  margin:0;padding:12px 14px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.dcu-switchrow:last-child{border-bottom:0}
.dcu-switchtext{display:flex;flex-direction:column;gap:3px;flex:1 1 auto;min-width:0}
.dcu-switchtitle{font-size:13px;line-height:20px;font-weight:500;
  color:var(--dsw-alias-label-primary)}
.dcu-switchhint{margin:0;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}

/* A pill track with a sliding knob. 36x20 is the size the shell's own toggles
   use; anything smaller stops being hittable on a touch display. */
.dcu-switch{
  appearance:none;position:relative;flex:none;
  width:36px;height:20px;margin:4px 0 0;padding:0;
  border:0;border-radius:999px;cursor:pointer;
  background:var(--dsw-alias-border-l2);
  transition:background-color .16s ease;
}
.dcu-switch::after{
  content:"";position:absolute;top:2px;left:2px;
  width:16px;height:16px;border-radius:50%;
  background:#fff;
  box-shadow:0 1px 2px rgba(0,0,0,.28);
  transition:transform .16s ease;
}
.dcu-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dcu-switch[aria-checked="true"]::after{transform:translateX(16px)}
.dcu-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dcu-switch:disabled{cursor:default;opacity:.5}

/* -------------------------------------------------------------------- */
/* Save bar                                                              */
/* -------------------------------------------------------------------- */

/* Sticky, because the page is longer than the fold once the model lists load
   and an unsaved edit must not require scrolling to commit. The top hairline
   plus the page background is what separates it from the card behind it. */
.dcu-savebar{
  position:sticky;bottom:0;z-index:3;
  display:flex;align-items:center;gap:10px;
  margin:12px 0 0;padding:12px 2px;
  border-top:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
}
.dcu-savebar-status{flex:1 1 auto;min-width:0;font-size:12px;line-height:18px;
  color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* "Saved" is the resting state and must not look like an alert. "Unsaved" earns
   the warn tone, which is the only signal that the two buttons are live. */
.dcu-savebar-dirty{color:var(--dsw-alias-state-warn-primary);font-weight:500}
.dcu-savebar-ok{color:var(--dsw-alias-state-success-primary)}
.dcu-savebar-actions{flex:none;display:flex;align-items:center;gap:8px}

/* -------------------------------------------------------------------- */
/* Diagnostics                                                           */
/* -------------------------------------------------------------------- */


.dcu-diag-row{
  display:flex;align-items:baseline;gap:16px;
  padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);
}
.dcu-diag-row:last-child{border-bottom:0}
/* A fixed label column: ragged labels make six facts read as six paragraphs. */
.dcu-diag-label{
  flex:none;width:104px;
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
}
.dcu-diag-value{
  flex:1 1 auto;min-width:0;
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);
  overflow-wrap:anywhere;
}
.dcu-diag-mono{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);
  overflow-wrap:anywhere;
}

/* -------------------------------------------------------------------- */
/* Messages                                                              */
/* -------------------------------------------------------------------- */

/* One error surface for the whole page: brand-neutral border, error tone for
   the text, and a left rule so it is not mistaken for a card. role="alert"
   carries the urgency; the colour only locates it. */
.dcu-alert{
  display:flex;align-items:flex-start;gap:8px;
  margin:0 0 12px;padding:10px 12px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);
  border-left-width:3px;
  border-radius:8px;
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);
  color:var(--dsw-alias-state-error-primary);
  font-size:12px;line-height:18px;
  white-space:pre-line;overflow-wrap:anywhere;
}

/* The first-load skeleton. Kept to one quiet line: a spinner that appears for
   less than a frame reads as a flash, and a large one would jump the layout. */
.dcu-loading{
  display:flex;align-items:center;gap:8px;
  padding:24px 14px;
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
}
.dcu-spinner{
  flex:none;width:14px;height:14px;border-radius:50%;
  border:2px solid var(--dsw-alias-border-l2);
  border-top-color:var(--dsw-alias-brand-primary);
  animation:dcu-spin .8s linear infinite;
}
@keyframes dcu-spin{to{transform:rotate(360deg)}}

/* -------------------------------------------------------------------- */
/* Composer credit pill                                                  */
/* -------------------------------------------------------------------- */

/* The trigger's wrapper. align-items:center is not decoration: without it the
   two spans (12px name, 12px value at different weights) align on the baseline
   and the pill's height drifts by a pixel between states. min-width:0 lets the
   name ellipsise instead of pushing the row wider than its slot. */
.dcu-pill-wrap{display:inline-flex;align-items:center;flex:none;min-width:0}

/* Sits in the composer's right-hand row beside the shell's own controls, so it
   takes their metrics: 12px/18px, tertiary label, tabular figures. It is
   secondary information and must not shout.
 *
 * align-self:stretch and the ABSENCE of a fixed height are load-bearing: the
 * surrounding row is taller than this text, and a hard 24px left a band above
 * and below the pill that looked like it belonged to the control but was not
 * part of it, so a press just outside the text did nothing. Stretching makes the
 * whole cell the hit target. */
.dcu-pill{
  display:inline-flex;align-items:center;align-self:stretch;gap:6px;
  margin:0;padding:2px 8px;
  border:1px solid transparent;border-radius:999px;
  background:transparent;
  color:var(--dsw-alias-label-tertiary);
  font:inherit;font-size:12px;line-height:18px;
  font-variant-numeric:tabular-nums;
  white-space:nowrap;cursor:pointer;
  transition:background-color .12s ease,color .12s ease;
}
.dcu-pill:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dcu-pill[aria-expanded="true"]{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
.dcu-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
/* The balance is the reason the pill exists, so it carries the primary tone
   and a weight step above the account name beside it. */
.dcu-pill-value{color:var(--dsw-alias-label-primary);font-weight:600}
.dcu-pill-name{color:var(--dsw-alias-label-tertiary)}
/* An unreadable balance is a dash, never a zero and never a spinner forever. */
.dcu-pill-error .dcu-pill-value{color:var(--dsw-alias-state-error-primary)}

/* -------------------------------------------------------------------- */
/* Composer popover                                                      */
/* -------------------------------------------------------------------- */

/* Portaled to body and positioned from the trigger's own rect, so it MUST be
   fixed: a static box would fall into document flow and ignore the measured
   left/bottom entirely. */
.dcu-pop{
  position:fixed;z-index:1100;box-sizing:border-box;
  width:min(268px,calc(100vw - 24px));
  padding:0;
  border:1px solid var(--dsw-alias-border-l2);
  border-radius:12px;
  background:var(--dsw-alias-bg-overlay);
  box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.16);
  color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:20px;
  overflow:hidden;
}
.dcu-pop-head{
  display:flex;align-items:center;gap:8px;
  padding:10px 12px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.dcu-pop-title{
  flex:none;margin:0;
  font-size:13px;line-height:20px;font-weight:600;
  white-space:nowrap;color:var(--dsw-alias-label-primary);
}
.dcu-pop-actions{margin-left:auto;display:flex;align-items:center;gap:4px}

/* Header controls are icon-plus-label pills at 11px: a plain text link in a
   13px header is not recognisable as a control at rest. */
.dcu-pop-btn{
  appearance:none;display:inline-flex;align-items:center;gap:4px;
  flex:none;margin:0;padding:0 7px;height:22px;
  border:1px solid transparent;border-radius:999px;
  background:transparent;
  color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:11px;line-height:16px;font-weight:500;
  white-space:nowrap;cursor:pointer;
  transition:background-color .12s ease,color .12s ease;
}
.dcu-pop-btn:hover:not(:disabled){
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
}
.dcu-pop-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dcu-pop-btn:disabled{opacity:.5;cursor:default}
/* Navigation leaves the popover, so it is the one control here allowed the
   brand tint. Two equally loud pills would turn the header into a toolbar. */
.dcu-pop-btn-brand{color:var(--dsw-alias-brand-primary)}
.dcu-pop-btn-brand:hover:not(:disabled){
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);
  color:var(--dsw-alias-brand-primary);
}
.dcu-pop-btn-icon{flex:none;display:block}
.dcu-pop-btn-icon-spin{animation:dcu-spin .9s linear infinite}

/* The account list. Rows are buttons so the whole line is the target; the
   figure is right-aligned in a tabular column shared by every row. */
.dcu-pop-list{display:flex;flex-direction:column;margin:0;max-height:260px;overflow-y:auto}
.dcu-pop-name{font-size:13px;line-height:20px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcu-pop-name-on{font-weight:600}
.dcu-pop-mark{
  flex:none;font-size:11px;line-height:16px;
  color:var(--dsw-alias-state-success-primary);
}
.dcu-pop-value{
  flex:none;min-width:64px;text-align:right;
  font-size:12px;line-height:18px;font-weight:600;
  font-variant-numeric:tabular-nums;white-space:nowrap;
  color:var(--dsw-alias-label-primary);
}
.dcu-pop-value-idle{color:var(--dsw-alias-label-tertiary);font-weight:500}
.dcu-pop-foot{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:8px 12px;
  border-top:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);
}
.dcu-pop-error{
  margin:0;padding:8px 12px;
  border-top:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-state-error-primary);
  font-size:11px;line-height:16px;
}
.dcu-pop-empty{
  margin:0;padding:16px 12px;
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
}

/* -------------------------------------------------------------------- */
/* Reduced motion                                                        */
/* -------------------------------------------------------------------- */

/* Transitions here are decoration; every state is fully legible without them.
   The spinners are the exception — they carry "still working" — so they keep a
   distinct look rather than vanishing. */
@media (prefers-reduced-motion:reduce){
  .dcu-tab,.dcu-btn,.dcu-model,.dcu-pill,.dcu-switch,.dcu-switch::after,
  .dcu-input,.dcu-select,.dcu-pop-btn{transition:none}
  .dcu-spinner{animation:none;border-top-color:var(--dsw-alias-label-tertiary);opacity:.7}
  .dcu-pop-btn-icon-spin{animation:none;opacity:.55}
}
`;

    /** Theme-token stylesheet, rendered inside the component tree so unmount removes it. */
    function StyleSheet() {
      return h('style', { 'data-dsh-connect-updream': '' }, CSS);
    }

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/**
 * The Updream mark for the settings nav row.
 *
 * This symbol used to be referenced but never defined: every load threw a
 * ReferenceError inside the registration callback, the catch swallowed it, and
 * the nav icon silently never appeared. The glyph is drawn here as plain
 * geometry so it needs no asset pipeline and inherits currentColor.
 */
function UpdreamLogo({ size }) {
  const side = typeof size === 'number' ? size : 16;
  return h('svg', {
    viewBox: '0 0 16 16',
    width: side,
    height: side,
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    h('circle', { key: 'ring', cx: 8, cy: 8, r: 6.4, stroke: 'currentColor', strokeWidth: 1.4 }),
    h('path', {
      key: 'mark',
      d: 'M8 4.4v3.8a1.9 1.9 0 1 0 1.9 1.9V4.4H8Z',
      fill: 'currentColor',
    }),
  ]);
}

/** The refresh arrow. 12px because it always sits beside 11px text. */
function RefreshIcon({ spinning }) {
  return h('svg', {
    className: spinning ? 'dcu-pop-btn-icon dcu-pop-btn-icon-spin' : 'dcu-pop-btn-icon',
    viewBox: '0 0 16 16',
    width: 12,
    height: 12,
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    h('path', { key: 'a', d: 'M13.3 8a5.3 5.3 0 1 1-1.55-3.75', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
    h('path', { key: 'b', d: 'M13.4 2.2v2.9h-2.9', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
  ]);
}

/** The gear, for the popover's link into the plugin's settings page. */
function GearIcon() {
  return h('svg', {
    className: 'dcu-pop-btn-icon',
    viewBox: '0 0 16 16',
    width: 12,
    height: 12,
    fill: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    h('path', { key: 'a', d: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z', stroke: 'currentColor', strokeWidth: '1.5' }),
    h('path', {
      key: 'b',
      d: 'M12.9 9.6a1.2 1.2 0 0 0 .24 1.32l.04.04a1.4 1.4 0 1 1-1.98 1.98l-.04-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.72 1.1v.12a1.4 1.4 0 1 1-2.8 0v-.07a1.2 1.2 0 0 0-.78-1.1 1.2 1.2 0 0 0-1.32.24l-.04.04a1.4 1.4 0 1 1-1.98-1.98l.04-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.72h-.12a1.4 1.4 0 1 1 0-2.8h.07a1.2 1.2 0 0 0 1.1-.78 1.2 1.2 0 0 0-.24-1.32l-.04-.04a1.4 1.4 0 1 1 1.98-1.98l.04.04a1.2 1.2 0 0 0 1.32.24h.05a1.2 1.2 0 0 0 .72-1.1v-.12a1.4 1.4 0 1 1 2.8 0v.07a1.2 1.2 0 0 0 .72 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.04a1.4 1.4 0 1 1 1.98 1.98l-.04.04a1.2 1.2 0 0 0-.24 1.32v.05a1.2 1.2 0 0 0 1.1.72h.12a1.4 1.4 0 1 1 0 2.8h-.07a1.2 1.2 0 0 0-1.1.72Z',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  ]);
}

/** Whole credits, grouped, floored. */
function formatCredits(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return Math.floor(number).toLocaleString('en-US');
}

/** `HH:MM`, local time. */
function clockOf(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* Small controls                                                      */
/* ------------------------------------------------------------------ */

function Switch({ checked, disabled, onChange, label }) {
  return h('button', {
    type: 'button',
    role: 'switch',
    className: 'dcu-switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    disabled: disabled === true,
    onClick: () => { if (disabled !== true) onChange(!checked); },
  });
}

function Badge({ tone, children }) {
  return h('span', { className: `dcu-badge${tone ? ` dcu-badge-${tone}` : ''}` }, children);
}

/** A titled card. Every block on the page is one of these, so the page reads as
 *  a stack of labelled groups rather than as a column of undifferentiated rows.
 *
 *  NOTE: this takes props ONLY — no rest parameters. React invokes a function
 *  component as `fn(props, secondArgument)`, where the second argument is a
 *  legacy context object. A `(...rest)` parameter therefore captures that object
 *  and, if it is treated as children, React throws "Objects are not valid as a
 *  React child" and blanks the WHOLE page. Children arrive exclusively through
 *  props.children. */
function Card({ title, desc, actions, flush, children }) {
  const body = children === undefined || children === null ? [] : children;
  return h('section', { className: 'dcu-card' }, [
    (title === undefined && actions === undefined)
      ? null
      : h('header', { key: 'head', className: 'dcu-card-head' }, [
        h('div', { key: 'copy', className: 'dcu-row-main' }, [
          title === undefined ? null : h('h3', { key: 't', className: 'dcu-card-title' }, title),
          desc === undefined ? null : h('p', { key: 'd', className: 'dcu-card-desc' }, desc),
        ]),
        actions === undefined ? null : h('div', { key: 'act', className: 'dcu-card-actions' }, actions),
      ]),
    h('div', { key: 'body', className: flush === true ? 'dcu-card-body dcu-card-body-flush' : 'dcu-card-body' }, body),
  ]);
}

/* ------------------------------------------------------------------ */
/* Settings page                                                       */
/* ------------------------------------------------------------------ */

/**
 * The plugin's page in 设置 → Updream.
 *
 * The state machine is the one the old build used — same routes, same
 * optimistic draft, same "dirty" comparison against the saved config — so this
 * rewrite changes only what the page LOOKS like. What did change structurally:
 * every block is a titled card, the account rows are one line each with the
 * balance in its own aligned column, and the tab bar is a real tab strip with a
 * selected underline instead of four bare words.
 */
function UpdreamSettings(props) {
  const copy = useMemo(() => pickCopy(props?.locale ?? (typeof navigator === 'undefined' ? 'zh' : navigator.language)), [props?.locale]);
  const [tab, setTab] = useState('accounts');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState(null);
  const [keyText, setKeyText] = useState('');
  const [labelText, setLabelText] = useState('');
  const [creditsOf, setCreditsOf] = useState({});
  const [projects, setProjects] = useState([]);
  const [models, setModels] = useState({ image: [], video: [], text: [] });
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await call(ROUTE.status);
      if (!alive.current) return;
      setStatus(next);
      setDraft(next.config ?? null);
      setError('');
    } catch (cause) {
      if (alive.current) setError(String(cause?.message || cause));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const patchDraft = useCallback((patch) => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const dirty = useMemo(() => {
    if (status === null || draft === null) return false;
    return JSON.stringify(draft) !== JSON.stringify(status.config);
  }, [status, draft]);

  const saveConfig = useCallback(async (patch) => {
    setBusy('save');
    try {
      const body = { ...(draft ?? status?.config ?? {}), ...(patch ?? {}) };
      const next = await post(ROUTE.save, body);
      if (!alive.current) return;
      setStatus(next);
      setDraft(next.config);
      setError('');
    } catch (cause) {
      if (alive.current) setError(String(cause?.message || cause));
    } finally {
      if (alive.current) setBusy('');
    }
  }, [draft, status]);

  const addAccount = useCallback(async () => {
    const key = keyText.trim();
    if (key === '') return;
    setBusy('account');
    try {
      const next = await post(ROUTE.verify, { apiKey: key, label: labelText.trim() });
      if (!alive.current) return;
      setStatus(next);
      setDraft(next.config ?? null);
      setKeyText('');
      setLabelText('');
      setError('');
      // A freshly added account has no measured balance yet; read it straight
      // away so the row is never the only one showing a dash.
      const added = Array.isArray(next.accounts) ? next.accounts : [];
      const newest = added.find((account) => account.id === next.activeAccountId);
      if (newest !== undefined) void readCredits(newest.id);
    } catch (cause) {
      if (alive.current) setError(String(cause?.message || cause));
    } finally {
      if (alive.current) setBusy('');
    }
  }, [keyText, labelText]);

  const switchAccount = useCallback(async (id) => {
    setBusy(`switch:${id}`);
    try {
      const next = await post(ROUTE.activate, { id });
      if (!alive.current) return;
      setStatus(next);
      setError('');
    } catch (cause) {
      if (alive.current) setError(String(cause?.message || cause));
    } finally {
      if (alive.current) setBusy('');
    }
  }, []);

  const removeAccount = useCallback(async (id) => {
    setBusy(`remove:${id}`);
    try {
      const next = await post(ROUTE.remove, { id });
      if (!alive.current) return;
      setStatus(next);
      setDraft(next.config ?? null);
      setError('');
    } catch (cause) {
      if (alive.current) setError(String(cause?.message || cause));
    } finally {
      if (alive.current) setBusy('');
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setBusy('projects');
    try {
      const data = await post(ROUTE.projects, {});
      if (!alive.current) return;
      setProjects(Array.isArray(data?.projects) ? data.projects : []);
    } catch (cause) {
      if (alive.current) setError(String(cause?.message || cause));
    } finally {
      if (alive.current) setBusy('');
    }
  }, []);

  const loadModels = useCallback(async () => {
    setBusy('models');
    try {
      const data = await post(ROUTE.models, {});
      if (!alive.current) return;
      setModels({ image: data?.image ?? [], video: data?.video ?? [], text: data?.text ?? [] });
    } catch (cause) {
      if (alive.current) setError(String(cause?.message || cause));
    } finally {
      if (alive.current) setBusy('');
    }
  }, []);

  const readCredits = useCallback(async (id) => {
    try {
      const data = await post(ROUTE.accountCredits, { id });
      if (!alive.current) return;
      setCreditsOf((current) => ({ ...current, [id]: data }));
    } catch { /* the row keeps its previous figure */ }
  }, []);

  /* First load. A single quiet line rather than a skeleton: the page is behind
   * a settings click, so the wait is short and a full skeleton would flash. */
  if (status === null) {
    return h('div', { className: 'dcu-page' }, [
      h('div', { key: 'load', className: 'dcu-loading' }, [
        error === ''
          ? h('span', { key: 's', className: 'dcu-spinner', 'aria-hidden': 'true' })
          : null,
        h('span', { key: 't' }, error === '' ? copy.loading : error),
      ]),
    ]);
  }

  const connected = status.connected === true;
  const accounts = Array.isArray(status.accounts) ? status.accounts : [];
  const config = status.config ?? {};
  const activeId = status.activeAccountId ?? '';

  /* --- masthead ---------------------------------------------------- */
  const masthead = h('header', { key: 'head', className: 'dcu-head' }, [
    h('span', { key: 'icon', className: 'dcu-head-icon' },
      h(UpdreamLogo, { size: 20 })),
    h('div', { key: 'copy', className: 'dcu-head-copy' }, [
      h('h2', { key: 't', className: 'dcu-head-title' }, copy.title),
      h('p', { key: 'd', className: 'dcu-head-desc' }, copy.subtitle),
    ]),
  ]);

  /* --- tabs -------------------------------------------------------- */
  const tabs = [
    ['accounts', copy.accountsTab],
    ['models', copy.modelsTab],
    ['ability', copy.abilityTab],
    ['diagnostics', copy.diagnosticsTab],
  ];
  const tabBar = h('div', { role: 'tablist', 'aria-label': copy.title, className: 'dcu-tabbar' },
    tabs.map(([id, label]) => h('button', {
      key: id,
      type: 'button',
      role: 'tab',
      'aria-selected': tab === id ? 'true' : 'false',
      className: `dcu-tab${tab === id ? ' dcu-tab-on' : ''}`,
      onClick: () => setTab(id),
    }, label)));

  /* --- accounts ---------------------------------------------------- */

  /* Add-account form: three controls on one line, stacking is handled by the
   * card's own flex wrap so a narrow panel does not crush the key field. */
  const addCard = h(Card, {
    key: 'add',
    title: copy.addAccount,
    desc: copy.addAccountHint,
    children: [
    h('div', { key: 'form', style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, [
      h('input', {
        key: 'key',
        className: 'dcu-input dcu-input-mono',
        type: 'password',
        autoComplete: 'off',
        placeholder: copy.accountKeyPlaceholder,
        value: keyText,
        onChange: (event) => setKeyText(event.target.value),
        disabled: busy !== '',
        style: { flex: '2 1 220px' },
      }),
      h('input', {
        key: 'label',
        className: 'dcu-input',
        placeholder: copy.accountLabelPlaceholder,
        value: labelText,
        onChange: (event) => setLabelText(event.target.value),
        onKeyDown: (event) => { if (event.key === 'Enter') void addAccount(); },
        disabled: busy !== '',
        style: { flex: '1 1 140px' },
      }),
      h('button', {
        key: 'go',
        type: 'button',
        className: 'dcu-btn dcu-btn-brand',
        disabled: keyText.trim() === '' || busy !== '',
        onClick: () => { void addAccount(); },
      }, busy === 'account' ? copy.adding : copy.addAccountAction),
    ]),
  ],
  });

  /* The account list. One row per account: dot, name over key hint, the
   * balance in its own right-aligned column, then the two actions. The balance
   * is read when the page opens, so no row demands a second click to show it. */
  const accountRows = accounts.length === 0
    ? h('p', { className: 'dcu-note dcu-note-flush' }, copy.noAccounts)
    : accounts.map((account) => {
      const active = account.id === activeId;
      const figure = creditsOf[account.id];
      const measured = figure !== undefined && figure !== null && figure.available !== undefined;
      return h('div', { key: account.id, className: 'dcu-row' }, [
        h('span', {
          key: 'dot',
          className: active ? 'dcu-acct-dot dcu-acct-dot-on' : 'dcu-acct-dot',
          'aria-hidden': 'true',
        }),
        h('div', { key: 'who', className: 'dcu-row-main' }, [
          h('span', { key: 'n', className: 'dcu-row-title' }, [
            account.label || account.username || account.id,
            active ? h('span', { key: 'b', className: 'dcu-badge dcu-badge-brand', style: { marginLeft: '6px' } }, copy.active) : null,
          ]),
          h('span', { key: 'k', className: 'dcu-row-sub' },
            [account.username, account.maskedKey].filter(Boolean).join(' · ')),
        ]),
        measured
          ? h('span', {
            key: 'c',
            className: 'dcu-acct-credits',
            title: copy.balance,
          }, formatCredits(figure.available))
          : h('button', {
            key: 'read',
            type: 'button',
            className: 'dcu-btn dcu-btn-quiet dcu-btn-sm',
            disabled: busy !== '',
            onClick: () => { void readCredits(account.id); },
          }, copy.readCredits),
        h('span', { key: 'x', className: 'dcu-acct-actions' }, [
          h('button', {
            key: 'sw',
            type: 'button',
            className: 'dcu-btn dcu-btn-quiet dcu-btn-sm',
            disabled: active || busy !== '',
            onClick: () => { void switchAccount(account.id); },
          }, copy.switchTo),
          h('button', {
            key: 'rm',
            type: 'button',
            className: 'dcu-btn dcu-btn-danger dcu-btn-sm',
            disabled: busy !== '',
            title: copy.removeConfirm,
            onClick: () => { void removeAccount(account.id); },
          }, copy.removeAccount),
        ]),
      ]);
    });

  const accountsCard = h(Card, {
    key: 'pool',
    title: copy.accountsTab,
    desc: accounts.length === 0 ? copy.noAccountsShort : undefined,
    actions: accounts.length === 0
      ? undefined
      : h('button', {
        key: 'all',
        type: 'button',
        className: 'dcu-btn dcu-btn-quiet dcu-btn-sm',
        disabled: busy !== '',
        onClick: () => { for (const account of accounts) void readCredits(account.id); },
      }, copy.accountCredits),
    flush: true,
    children: accountRows,
  });

  /* Default project. The select is fed by an explicit "read projects" action,
   * so an empty list means "not loaded yet" rather than "no projects exist" —
   * which is why the hint says so instead of showing an empty dropdown. */
  const projectCard = h(Card, {
    key: 'proj',
    title: copy.defaultProject,
    desc: copy.defaultProjectHint,
    children: [
    h('div', { key: 'row', style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } }, [
      h('select', {
        key: 'sel',
        className: 'dcu-select',
        value: draft?.defaultProjectId ?? '',
        disabled: busy !== '',
        onChange: (event) => patchDraft({ defaultProjectId: event.target.value }),
      }, [
        h('option', { key: '', value: '' }, copy.projectNone),
        ...projects.map((project) => h('option', {
          key: project.id,
          value: project.id,
        }, `${project.name} — ${project.id}`)),
      ]),
      h('button', {
        key: 'load',
        type: 'button',
        className: 'dcu-btn dcu-btn-quiet',
        disabled: busy !== '',
        onClick: () => { void loadProjects(); },
      }, busy === 'projects' ? copy.loading : copy.loadProjects),
    ]),
    projects.length === 0
      ? h('p', { key: 'hint', className: 'dcu-note' }, copy.noProjects)
      : null,
  ],
  });

  const accountsPanel = h('div', { role: 'tabpanel', hidden: tab !== 'accounts' }, [
    connected ? null : h('p', { key: 'nokey', className: 'dcu-alert' }, copy.keyMissing),
    addCard,
    accountsCard,
    projectCard,
  ]);

  /* --- models ------------------------------------------------------ */

  const modelSections = ['image', 'video', 'text'].map((kind) => {
    const list = models[kind] ?? [];
    if (list.length === 0) return null;
    const enabled = new Set(draft?.[`${kind}Models`] ?? []);
    const affordable = list.filter((model) => model.tier === '' || model.tier === 'origin');
    const allOriginPicked = affordable.length > 0 && affordable.every((model) => enabled.has(model.id));
    const label = kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'text';
    return h(Card, {
      key: kind,
      title: label,
      desc: `${enabled.size} / ${list.length}`,
      actions: h('div', { key: 'acts', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
        h('button', {
          key: 'origin',
          type: 'button',
          className: 'dcu-btn dcu-btn-quiet dcu-btn-sm',
          disabled: affordable.length === 0,
          title: copy.selectOriginHint,
          onClick: () => {
            const next = new Set(enabled);
            for (const model of affordable) next.add(model.id);
            patchDraft({ [`${kind}Models`]: [...next] });
          },
        }, `${copy.selectOrigin}（${affordable.length}）`),
        h('button', {
          key: 'toggle',
          type: 'button',
          className: 'dcu-btn dcu-btn-quiet dcu-btn-sm',
          onClick: () => {
            const next = new Set(enabled);
            if (allOriginPicked) for (const model of affordable) next.delete(model.id);
            else for (const model of affordable) next.add(model.id);
            patchDraft({ [`${kind}Models`]: [...next] });
          },
        }, allOriginPicked ? copy.clearAll : copy.selectAll),
        h('button', {
          key: 'none',
          type: 'button',
          className: 'dcu-btn dcu-btn-quiet dcu-btn-sm',
          onClick: () => patchDraft({ [`${kind}Models`]: [] }),
        }, copy.selectNone),
      ]),
      flush: true,
    children: list.map((model) => {
      const checked = enabled.has(model.id);
      const affordableOne = model.tier === '' || model.tier === 'origin';
      return h('label', {
        key: model.id,
        className: affordableOne ? 'dcu-model' : 'dcu-model dcu-model-off',
      }, [
        h('input', {
          key: 'c',
          type: 'checkbox',
          checked,
          onChange: () => {
            const next = new Set(enabled);
            if (checked) next.delete(model.id);
            else next.add(model.id);
            patchDraft({ [`${kind}Models`]: [...next] });
          },
        }),
        h('span', { key: 'n', className: 'dcu-model-name' }, model.label || model.id),
        h('span', { key: 'i', className: 'dcu-model-id' }, model.id),
        model.tier ? h(Badge, { key: 't', tone: affordableOne ? 'brand' : undefined }, model.tier) : null,
      ]);
    }),
  });
  }).filter(Boolean);

  const modelsPanel = h('div', { role: 'tabpanel', hidden: tab !== 'models' }, [
    h(Card, {
      key: 'catalog',
      title: copy.modelsTab,
      desc: copy.modelsHint,
      actions: h('button', {
        key: 'reload',
        type: 'button',
        className: 'dcu-btn dcu-btn-quiet dcu-btn-sm',
        disabled: busy === 'models',
        onClick: () => { void loadModels(); },
      }, busy === 'models' ? copy.loading : copy.refreshModels),
    children: [
      modelSections.length === 0
        ? h('p', { key: 'empty', className: 'dcu-note', style: { margin: 0 } }, copy.loadProjectsHint)
        : null,
    ],
  }),
    ...modelSections,
  ]);

  /* --- ability ----------------------------------------------------- */

  const switches = [
    ['allowImageTools', copy.allowImage, copy.allowImageHint],
    ['allowVideoTools', copy.allowVideo, copy.allowVideoHint],
    ['allowTextTool', copy.allowText, copy.allowTextHint],
    ['allowCanvasTools', copy.allowCanvas, copy.allowCanvasHint],
    ['allowProjectDelete', copy.allowProjectDelete, copy.allowProjectDeleteHint],
    ['showCreditsBadge', copy.creditsBadge, copy.creditsBadgeHint],
  ];

  const abilityPanel = h('div', { role: 'tabpanel', hidden: tab !== 'ability' }, [
    h(Card, { key: 'switches', title: copy.abilityTab, desc: copy.abilityHint, flush: true,
    children: switches.map(([field, title, hint]) => h('div', { key: field, className: 'dcu-switchrow' }, [
        h('div', { key: 't', className: 'dcu-switchtext' }, [
          h('span', { key: 'n', className: 'dcu-switchtitle' }, title),
          h('span', { key: 'h', className: 'dcu-switchhint' }, hint),
        ]),
        h(Switch, {
          key: 's',
          checked: draft?.[field] === true,
          onChange: (value) => patchDraft({ [field]: value }),
          label: title,
        }),
      ])),
  }),
  ]);

  /* --- diagnostics ------------------------------------------------- */

  const facts = [
    [copy.connected, connected ? 'ok' : copy.none, false],
    [copy.user, status.user ? `${status.user.username ?? ''} (${status.user.id ?? '?'})` : copy.none, false],
    [copy.tier, status.credits?.tier ?? copy.none, false],
    [copy.balance, status.credits ? String(status.credits.available ?? copy.none) : copy.none, true],
    [copy.baseURL, config.baseURL || 'https://www.updream.cn/api', true],
    ['CLI 账号', status.cli?.configured
      ? `${status.cli.username ?? ''} (${status.cli.upstreamId ?? '?'})`
      : (status.cli?.error ?? copy.none), false],
    ['CLI 配置', status.cli?.configPath || copy.none, true],
    [copy.pollInterval, `${Math.round((Number(config.pollIntervalMs) || 300000) / 1000)}s`, true],
    [copy.lastError, status.lastError || copy.none, false],
  ];

  const diagnosticsPanel = h('div', { role: 'tabpanel', hidden: tab !== 'diagnostics' }, [
    h(Card, { key: 'facts', title: copy.diagnostics, desc: copy.diagnosticsHint, flush: true,
    children: facts.map(([label, value, mono], index) => h('div', { key: `${index}`, className: 'dcu-diag-row' }, [
        h('span', { key: 'l', className: 'dcu-diag-label' }, label),
        h('span', { key: 'v', className: mono ? 'dcu-diag-mono' : 'dcu-diag-value' }, value),
      ])),
  }),
  ]);

  /* --- save bar ---------------------------------------------------- */

  const saveBar = h('div', { key: 'bar', className: 'dcu-savebar' }, [
    h('span', {
      key: 'st',
      className: dirty ? 'dcu-savebar-status dcu-savebar-dirty' : 'dcu-savebar-status dcu-savebar-ok',
      role: 'status',
    }, dirty ? copy.unsaved : copy.saved),
    h('div', { key: 'actions', className: 'dcu-savebar-actions' }, [
      h('button', {
        key: 'discard',
        type: 'button',
        className: 'dcu-btn dcu-btn-quiet',
        disabled: !dirty || busy === 'save',
        onClick: () => { setDraft(status.config); },
      }, copy.discard),
      h('button', {
        key: 'save',
        type: 'button',
        className: 'dcu-btn dcu-btn-brand',
        disabled: !dirty || busy === 'save',
        onClick: () => { void saveConfig(); },
      }, busy === 'save' ? copy.saving : copy.save),
    ]),
  ]);

  return h('div', { className: 'dcu-page' }, [
    h(StyleSheet, { key: 'css' }),
    error !== '' ? h('p', { key: 'err', className: 'dcu-alert', role: 'alert' }, error) : null,
    masthead,
    tabBar,
    accountsPanel,
    modelsPanel,
    abilityPanel,
    diagnosticsPanel,
    saveBar,
  ]);
}

/* ------------------------------------------------------------------ */
/* Composer credit readout                                             */
/* ------------------------------------------------------------------ */

/**
 * The credit readout that sits in the composer's right-hand row.
 *
 * Rendering rule, unchanged: the trigger is plain text at the shell's own
 * secondary-control metrics, and the figure is the only part allowed the
 * primary tone. The popover is the account list; clicking a row switches
 * account, which is the whole reason the popover exists.
 */
function CreditPill(props) {
  const copy = useMemo(() => pickCopy(props?.locale ?? (typeof navigator === 'undefined' ? 'zh' : navigator.language)), [props?.locale]);
  const [state, setState] = useState({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const [switchingId, setSwitchingId] = useState(undefined);
  const [testing, setTesting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(undefined);
  const [perAccount, setPerAccount] = useState({});
  const enabled = props?.showCreditsBadge === true;

  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const readGeneration = useRef(0);

  const load = useCallback(async () => {
    try {
      const doc = await call(ROUTE.credits);
      setState({ kind: 'ok', value: doc.available, tier: doc.tier, account: doc.account ?? null });
      setFailed(false);
    } catch (cause) {
      setState({ kind: 'error', message: String(cause?.message || cause) });
      setFailed(true);
    }
  }, []);

  /** Read every account's balance, so no row shows a dash while the panel is open. */
  const fetchAccountCredits = useCallback(async () => {
    const accounts = Array.isArray(props?.accounts) ? props.accounts : [];
    if (accounts.length === 0) return;
    const generation = ++readGeneration.current;
    const results = await Promise.all(accounts.map(async (account) => {
      try {
        const data = await post(ROUTE.accountCredits, { id: account.id });
        return [account.id, data];
      } catch {
        return [account.id, null];
      }
    }));
    if (generation !== readGeneration.current) return;
    const next = {};
    for (const [id, value] of results) next[id] = value;
    setPerAccount(next);
    setLastRefresh(new Date());
  }, [props?.accounts]);

  useEffect(() => {
    if (!enabled) return undefined;
    void load();
    const interval = window.setInterval(() => { void load(); }, Math.max(60000, Number(props?.pollIntervalMs) || 300000));
    return () => window.clearInterval(interval);
  }, [enabled, load, props?.pollIntervalMs]);

  /* Per-account figures are read on OPEN, then kept fresh while the panel stays
   * open: a figure that silently ages while the user reads it is worse than one
   * that is obviously stale. */
  useEffect(() => {
    if (!enabled || !open) return undefined;
    void fetchAccountCredits();
    const interval = window.setInterval(() => { void fetchAccountCredits(); }, 60000);
    return () => window.clearInterval(interval);
  }, [enabled, open, fetchAccountCredits]);

  /** Anchor the panel above the trigger, clamped into the viewport. */
  useEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const PANEL_WIDTH = 268;
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - PANEL_WIDTH - 12));
      setPosition({ left, bottom: Math.max(8, window.innerHeight - rect.top + 8) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  /** Close on an outside press or Escape, the way a popover should. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const switchTo = useCallback(async (id) => {
    setSwitchingId(id);
    try {
      await post(ROUTE.activate, { id });
      // Re-read through the Host rather than trusting local state: activation
      // changes which account the Host will answer with, and the trigger's name
      // and figure both come from that answer. Without this the popover switched
      // on the Host while the pill kept naming (and showing the balance of) the
      // account it had before the click.
      await load();
      if (typeof props?.onHostChanged === 'function') await props.onHostChanged();
      await fetchAccountCredits();
      setOpen(false);
    } catch (cause) {
      setState({ kind: 'error', message: String(cause?.message || cause) });
    } finally {
      setSwitchingId(undefined);
    }
  }, [load, fetchAccountCredits, props?.onHostChanged]);

  /** The header's refresh: re-read the active balance AND every account. */
  const refreshAll = useCallback(async () => {
    setTesting(true);
    try {
      await Promise.all([load(), fetchAccountCredits()]);
    } finally {
      setTesting(false);
    }
  }, [load, fetchAccountCredits]);

  if (!enabled) return null;

  const accounts = Array.isArray(props?.accounts) ? props.accounts : [];
  const activeId = props?.activeAccountId ?? '';
  const name = state.kind === 'ok' ? (state.account?.label || state.account?.username || '') : '';
  const valueText = state.kind === 'loading' ? '…'
    : state.kind === 'error' ? '—'
      : formatCredits(state.value);

  const panel = open && position !== null && (typeof ReactDOM !== 'undefined' && ReactDOM !== null)
    ? ReactDOM.createPortal(h('div', {
      ref: panelRef,
      className: 'dcu-pop',
      style: { left: position.left, bottom: position.bottom },
      role: 'dialog',
      'aria-label': copy.creditsPanelTitle,
    }, [
      /* --- header: title + refresh + settings --------------------- */
      h('div', { key: 'head', className: 'dcu-pop-head' }, [
        h('span', { key: 'title', className: 'dcu-pop-title' }, copy.creditsPanelTitle),
        h('span', { key: 'actions', className: 'dcu-pop-actions' }, [
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dcu-pop-btn',
            disabled: testing || switchingId !== undefined,
            title: copy.refreshHint,
            'aria-label': copy.refreshHint,
            onClick: () => { void refreshAll(); },
          }, [
            h(RefreshIcon, { key: 'icon', spinning: testing }),
            h('span', { key: 'label' }, testing ? copy.refreshing : copy.refresh),
          ]),
          props?.onOpenSettings === undefined ? null : h('button', {
            key: 'settings',
            type: 'button',
            className: 'dcu-pop-btn dcu-pop-btn-brand',
            title: copy.openSettingsHint,
            onClick: () => { setOpen(false); props.onOpenSettings(); },
          }, [
            h(GearIcon, { key: 'icon' }),
            h('span', { key: 'label' }, copy.openSettings),
          ]),
        ]),
      ]),

      /* --- body: the account list --------------------------------- */
      accounts.length === 0
        ? h('p', { key: 'empty', className: 'dcu-pop-empty' }, copy.noAccountsShort)
        : h('div', { key: 'list', className: 'dcu-pop-list' }, accounts.map((account) => {
          const current = account.id === activeId;
          const measured = perAccount[account.id];
          /*
           * EVERY row shows its OWN measured figure.
           *
           * This used to special-case the active row to `state.value` — the
           * trigger's figure. That is the same number for one row, but the
           * special case also meant a row whose read had not arrived yet fell
           * back to `measured?.available ?? null`, and the ACTIVE row silently
           * borrowed the global figure even when the per-account read disagreed.
           * The visible symptom: two accounts showing the same balance, with the
           * non-active one wrong.
           *
           * A row with no reading shows an em dash, which says "not measured"
           * instead of presenting someone else's number as fact.
           */
          const balance = measured !== undefined && measured !== null
            ? measured.available
            : (current && state.kind === 'ok' ? state.value : null);
          const busyRow = switchingId !== undefined;
          return h('button', {
            key: account.id,
            type: 'button',
            className: 'dcu-row dcu-row-button',
            disabled: busyRow,
            'aria-current': current ? 'true' : undefined,
            title: current ? copy.currentAccount : `${copy.switchTo}: ${account.label}`,
            onClick: () => { if (!current) void switchTo(account.id); },
          }, [
            h('span', {
              key: 'dot',
              className: current ? 'dcu-acct-dot dcu-acct-dot-on' : 'dcu-acct-dot',
              'aria-hidden': 'true',
            }),
            h('span', { key: 'who', className: 'dcu-row-main' }, [
              h('span', { key: 'n', className: current ? 'dcu-pop-name dcu-pop-name-on' : 'dcu-pop-name' },
                account.label || account.username || account.id),
              current
                ? h('span', { key: 'm', className: 'dcu-pop-mark' }, copy.currentAccount)
                : null,
            ]),
            h('span', {
              key: 'v',
              className: balance === null || balance === undefined
                ? 'dcu-pop-value dcu-pop-value-idle'
                : 'dcu-pop-value',
            }, balance === null || balance === undefined ? '—' : formatCredits(balance)),
          ]);
        })),

      /* --- foot: last refresh ------------------------------------- */
      h('div', { key: 'foot', className: 'dcu-pop-foot' },
        h('span', null, `${copy.lastRefresh} ${clockOf(lastRefresh)}`)),

      failed
        ? h('p', { key: 'failed', className: 'dcu-pop-error', role: 'status' }, copy.refreshFailed)
        : null,
    ]), document.body)
    : null;

  return h(Fragment, null,
    /* The stylesheet has to be mounted HERE too.
     *
     * Only UpdreamSettings rendered StyleSheet, so the composer pill reached the
     * page with no rules at all: the trigger fell back to the browser's default
     * button chrome (grey fill, white text, no gap between the name and the
     * figure) and the popover mounted with no width, no position styles, and no
     * visible surface. StyleSheet is idempotent — it renders the same CSS text
     * into a <style> element, and duplicate copies are harmless — so both halves
     * can own their own instance instead of depending on the settings page
     * having been opened first. */
    h(StyleSheet, { key: 'css' }),
    h('span', { key: 'root', ref: rootRef, className: 'dcu-pill-wrap' },
      h('button', {
        key: 'trigger',
        type: 'button',
        className: `dcu-pill${state.kind === 'error' ? ' dcu-pill-error' : ''}`,
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        title: state.kind === 'error' ? state.message : `${copy.title} · ${name === '' ? copy.none : name}\n${copy.balance}: ${valueText}`,
        onClick: () => { setOpen(!open); if (state.kind === 'error') void load(); },
      }, [
        /* Two spans, and the gap between them comes from the pill's own flex
           gap. They are kept separate (rather than one concatenated string) so
           the figure can carry the primary tone and a heavier weight while the
           account name stays tertiary. */
        h('span', { key: 'n', className: 'dcu-pill-name' }, name === '' ? 'Updream' : `Updream · ${name}`),
        h('span', { key: 'v', className: 'dcu-pill-value' }, valueText),
      ])),
    panel);
}

    /* ------------------------------------------------------------------ */
    /* Plugin entry                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Mount the browser half: the settings page (plus its nav glyph) and the
     * composer credit readout.
     * @param ctx - the client context carrying `slots` and `locale`.
     */
    function apply(ctx) {
      /** Route to this plugin's own settings page, best effort. */
      const openSettings = () => {
        try {
          const entries = ctx.slots.entries?.('settings.section');
          const entry = Array.isArray(entries) ? entries.find((row) => row.id === 'dsh-connect-updream') : undefined;
          if (entry?.store !== undefined) {
            entry.store.create().actions.openSection('dsh-connect-updream');
            return;
          }
        } catch { /* fall through to opening the settings shell */ }
        try {
          const shell = ctx.slots.entries?.('settings.shell')?.[0];
          if (shell?.store !== undefined) shell.store.create().actions.open();
        } catch { /* the settings nav row is the fallback */ }
      };

      const activeLocale = () => {
        try {
          const value = ctx.locale.current?.();
          if (typeof value === 'string') return value;
        } catch { /* fall through to the browser language */ }
        return typeof navigator === 'undefined' ? 'zh' : navigator.language;
      };

      /* Settings page + its nav glyph, registered from one callback so the glyph
       * is only addressable while the page's id exists. */
      try {
        ctx.slots.inject('settings.section', () => {
          const disposers = [];
          disposers.push(ctx.slots.register({
            name: 'settings.section',
            id: 'dsh-connect-updream',
            order: 36,
            label: () => 'Updream',
            locale: namespace,
            inject: () => ({ locale: activeLocale() }),
          }, UpdreamSettings));
          try {
            disposers.push(ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
              name: 'settings.section.icon',
              id: 'dsh-connect-updream',
              locale: namespace,
            }, (iconProps) => h(UpdreamLogo, { size: typeof iconProps?.size === 'number' ? iconProps.size : 16 }))));
          } catch (error) {
            console.error('[dsh-connect-updream] settings nav icon failed to register (page unaffected):', error);
          }
          return () => { for (const dispose of disposers) try { dispose(); } catch { /* already gone */ } };
        });
      } catch (error) {
        console.error('[dsh-connect-updream] settings section failed to register:', error);
      }

      /* Credit readout in the composer row. Registered unconditionally; the
       * component renders nothing until the switch is on, which keeps a second
       * connector plugin from fighting over one shared row. */
      try {
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-connect-updream-credits',
          order: 4,
          locale: namespace,
          inject: (slotProps) => slotProps ?? {},
        }, (slotProps) => h(CreditHostGate, { slotProps, onOpenSettings: openSettings })));
      } catch (error) {
        console.error('[dsh-connect-updream] composer credits slot failed to register:', error);
      }
    }

    /**
     * Read the Host's own switches before drawing the pill, so the readout
     * follows the saved configuration without a page reload.
     */
    function CreditHostGate({ slotProps, onOpenSettings }) {
      const [status, setStatus] = useState(null);
      /**
       * The pill can CHANGE the active account, so this snapshot cannot be a
       * one-shot read. It used to be, and the effect of that was a popover that
       * switched accounts on the Host while the trigger kept naming the old one,
       * and a per-row list built from a stale `activeAccountId`.
       *
       * `refresh` is passed down so the pill re-reads the truth after an
       * activation instead of assuming its own optimistic state is the answer.
       */
      const read = useCallback(async () => {
        try {
          const next = await call(ROUTE.status);
          setStatus(next);
        } catch {
          setStatus(null);
        }
      }, []);

      useEffect(() => {
        let live = true;
        (async () => {
          try {
            const next = await call(ROUTE.status);
            if (live) setStatus(next);
          } catch {
            if (live) setStatus(null);
          }
        })();
        return () => { live = false; };
      }, []);

      const config = status?.config ?? null;
      if (config === null || config.showCreditsBadge !== true) return null;
      return h(CreditPill, {
        locale: slotProps?.locale,
        pollIntervalMs: config.pollIntervalMs,
        showCreditsBadge: config.showCreditsBadge,
        accounts: Array.isArray(status.accounts) ? status.accounts : [],
        activeAccountId: status.activeAccountId ?? '',
        onHostChanged: read,
        onOpenSettings,
      });
    }

    return {
      name: 'dsh-connect-updream',
      inject: ['slots', 'locale'],
      apply,
      /* Internal components, exposed for the offline render check only.
       *
       * tests/test_realrender.cjs renders each of these with real React: a slot
       * render alone only reaches the loading skeleton, so a defect inside the
       * cards (a bare object reaching a child, say) would ship unseen — which is
       * exactly how the rest-parameter bug got through. Nothing in the Host or
       * the page reads this field. */
      __internals: { Card, Badge, Switch, UpdreamLogo, RefreshIcon, GearIcon, StyleSheet, UpdreamSettings, CreditPill },
    };
  },
});
