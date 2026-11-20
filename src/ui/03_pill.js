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
