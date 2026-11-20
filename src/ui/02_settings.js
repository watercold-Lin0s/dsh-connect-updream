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
