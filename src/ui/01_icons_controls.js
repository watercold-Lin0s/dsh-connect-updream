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
