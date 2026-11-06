import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import Button from '../../../ui/Button.tsx';
import { Input } from '../../../ui/Input.tsx';
import { useDialogFocus } from '../../../ui/useDialogFocus.js';
import { DetailedPart, DetailedRow, isShown } from './Detailed.jsx';
import './agentProfile/agentProfile.css';

// The pieces a Build part's own workspace is made of (Agent's profile, Conversation's overview): a sentence whose parts
// open small editors in place, chapters of lines that open under themselves, the settings fewer people need folded under
// a line that names them, a switch to "All settings", and that view (the part's own cards, every fold open, searchable).
// Every one of them edits with the part's own rows, so a setting is the same control, saved in the same place, with the
// same checks, wherever it shows.
//
// The parts that open share `s`, the page's state ({ open, setOpen, openToken, close, rows, ctx, filled, anchors,
// tokens, partId }), and stay the same components from one draw to the next (a field keeps its focus while typing).

// every row of a part by "card.row"
export const rowsOf = (form) => {
  const out = {};
  form.cols.flat().forEach((card) => [...(card.rows || []), ...(card.adv || [])].forEach((row) => (out[`${card.id}.${row.id}`] = row)));
  return out;
};

// Brings an element into view inside the page's own scrolling area only (scrollIntoView would also move the app's
// frame): by just enough that all of it shows.
export function reveal(el) {
  if (!el) return;
  let box = el.parentElement;
  while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
  const view = box ? box.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  const r = el.getBoundingClientRect();
  const by = r.bottom > view.bottom - 16 ? Math.min(r.bottom - view.bottom + 16, r.top - view.top - 16) : r.top < view.top + 16 ? r.top - view.top - 16 : 0;
  if (!by) return;
  const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  (box || window).scrollBy({ top: by, behavior });
}

// the switch between the two views, remembered per person; first = [view, its name] ("profile", "Profile")
export function ViewSwitch({ view, onChoose, first, label }) {
  const [story, name] = first;
  return (
    <div className="apSeg segmented" role="group" aria-label={label}>
      <button type="button" aria-pressed={view === story} className={view === story ? 'on' : ''} onClick={() => onChoose(story)}>
        {name}
      </button>
      <button type="button" aria-pressed={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => onChoose('all')}>
        All settings
      </button>
    </div>
  );
}

// a list of the part's own rows, stacked: the same controls as everywhere
export function Rows({ ids, rows, ctx, partId }) {
  const shown = ids.map((id) => rows[id]).filter((row) => row && isShown(row, ctx));
  if (!shown.length) return <p className="apNone">Nothing to set here for this agent.</p>;
  return (
    <div className="apRows">
      {shown.map((row) => (
        <DetailedRow key={row.id} row={row} ctx={ctx} partId={partId} />
      ))}
    </div>
  );
}

// whether the checks found something in any of these rows
export function hasProblem(ids, rows, ctx) {
  const paths = ids
    .map((id) => rows[id])
    .filter(Boolean)
    .map((row) => row.errPath || (row.pathFor ? row.pathFor(ctx.config) : row.path))
    .filter(Array.isArray);
  return (ctx.issues || []).some((issue) => paths.some((at) => at.every((p, n) => String(issue.path[n]) === String(p))));
}

// A small editor under a part of the sentence: its settings, a Done, and it closes on Escape or a click outside.
// width: the widest it gets (it never leaves its box); under: () => an element it hangs from instead of the part of the
// sentence (Conversation's lit moment of the drawn call), pointing at it
export function Popover({ anchor, box, title, onClose, children, width: widest = 460, under }) {
  const ref = useRef(null);
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    const a = (under?.() || anchor)?.getBoundingClientRect();
    const b = box.current?.getBoundingClientRect();
    if (!a || !b) return;
    const width = Math.min(widest, b.width - 32);
    const centre = a.left - b.left + a.width / 2;
    const left = Math.max(16, Math.min(centre - width / 2, b.width - width - 16));
    setPlace({ left, top: a.bottom - b.top + 12, width, tip: Math.max(20, Math.min(centre - left, width - 20)) });
  }, [anchor, box, widest, under]);
  useDialogFocus(ref);
  // once placed, the whole editor is brought into view (a part near the bottom of the window opens below it)
  useEffect(() => {
    if (place) reveal(ref.current);
  }, [place]);
  useEffect(() => {
    const down = (event) => {
      const target = event.target;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      // a list, menu or dialog opened from inside the editor is part of it
      if (target.closest?.('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], .createOverlay')) return;
      onClose();
    };
    const key = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      className="apPop"
      style={place ? { left: place.left, top: place.top, width: place.width, '--tip': `${place.tip}px` } : { visibility: 'hidden' }}
    >
      <div className="apPopHead">
        <h3>{title}</h3>
        <button type="button" className="apIconBtn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="apPopBody">{children}</div>
      <div className="apPopFoot">
        <Button type="button" variant="primary" size="small" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

// a part of the sentence: its words or the blank to fill, opening its editor (s.tokens[k]: { title, ids, blank, optional })
export function Tok({ s, k }) {
  const t = s.tokens[k];
  const shown = s.filled[k];
  const on = s.open?.token === k;
  const bad = hasProblem(t.ids, s.rows, s.ctx);
  return (
    <button
      type="button"
      ref={(el) => {
        s.anchors.current[k] = el;
      }}
      className={['apTok', !shown && 'blank', !shown && t.optional && 'optional', on && 'on', bad && 'bad'].filter(Boolean).join(' ')}
      aria-expanded={on}
      aria-haspopup="dialog"
      onClick={() => (on ? s.close() : s.setOpen({ token: k }))}
    >
      {shown || t.blank}
      <span className="srOnly"> ({t.title}: change)</span>
    </button>
  );
}

// a line of a chapter: its words; Change opens its settings under it, or the part of the sentence that holds them
// abbr: the technical short name, in brackets after the label ("Thinks with (LLM)"); action: the button's word
export function Line({ s, k, label, abbr = '', children, ids, token, muted = false, action = 'Change' }) {
  const isOpen = s.open?.line === k;
  const bad = ids ? hasProblem(ids, s.rows, s.ctx) : token ? hasProblem(s.tokens[token].ids, s.rows, s.ctx) : false;
  return (
    <div className={`apLine ${isOpen ? 'open' : ''}`}>
      <div className="apLineHead">
        <span className="apLineLabel">
          {label}
          {abbr && <span className="apAbbr"> ({abbr})</span>}
        </span>
        <span className={`apLineValue ${muted ? 'muted' : ''}`}>
          {children}
          {bad && <span className="apBad">Needs a look</span>}
        </span>
        <button
          type="button"
          className="apChange"
          aria-expanded={token ? s.open?.token === token : isOpen}
          onClick={() => (token ? s.openToken(token) : s.setOpen(isOpen ? null : { line: k }))}
        >
          {isOpen ? 'Done' : action}
          <span className="srOnly"> {label}</span>
        </button>
      </div>
      {isOpen && ids && <Rows ids={ids} rows={s.rows} ctx={s.ctx} partId={s.partId} />}
    </div>
  );
}

// the settings fewer people need, folded under a line that names each one, so what is inside is never a surprise
export function More({ s, k, ids }) {
  const isOpen = s.open?.line === k;
  const shown = ids.map((id) => s.rows[id]).filter((row) => row && isShown(row, s.ctx));
  if (!shown.length) return null;
  return (
    <div className="apMore">
      <button type="button" className="apMoreBtn" aria-expanded={isOpen} onClick={() => s.setOpen(isOpen ? null : { line: k })}>
        <Icon name={isOpen ? 'minus' : 'plus'} size={14} />
        {isOpen ? 'Fewer settings' : `${shown.length} more settings`}
      </button>
      {!isOpen && (
        <ul className="apMoreNames" aria-label="What is in there">
          {shown.map((row) => (
            <li key={row.id}>{row.label}</li>
          ))}
        </ul>
      )}
      {isOpen && <Rows ids={ids} rows={s.rows} ctx={s.ctx} partId={s.partId} />}
    </div>
  );
}

// All settings: the part's own cards, every fold open, searchable. switcher: the ViewSwitch to show in its header.
export function AllSettings({ ctx, form, switcher, searchLabel }) {
  const [query, setQuery] = useState('');
  const part = useMemo(
    () => ({
      ...form,
      top: () => (
        <div className="apFind">
          <Icon name="search" size={15} />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchLabel} aria-label={searchLabel} />
          {query && (
            <button type="button" className="apChange" onClick={() => setQuery('')}>
              Clear
            </button>
          )}
        </div>
      ),
    }),
    [form, query, searchLabel],
  );
  return <DetailedPart part={part} ctx={{ ...ctx, actions: switcher, forceAdvanced: true, rowFilter: query }} />;
}

// Which view shows: the person's choice, except that a request to show one setting (a problem's "show me", a search)
// opens All settings, where every setting is in view, until the person picks a view again.
export function useShownView(ctx, store) {
  const view = store.use();
  const [forced, setForced] = useState(false);
  const nonce = ctx.request?.nonce;
  useEffect(() => {
    if (nonce && (ctx.request?.focus || ctx.request?.path)) setForced(true);
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (next) => {
    setForced(false);
    store.set(next);
  };
  return { view: forced ? 'all' : view, choose };
}
