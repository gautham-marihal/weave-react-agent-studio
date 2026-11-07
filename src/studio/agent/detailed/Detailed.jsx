import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import Fold from '../../../ui/Fold.jsx';
import Select from '../../../ui/Select.tsx';
import { Input, TextArea } from '../../../ui/Input.tsx';
import { Switch, NumberInput, JsonInput } from '../../form/fields.jsx';
import { createEngine } from '../../form/engine.js';
import { useSchema } from '../../form/useSchema.js';
import Button from '../../../ui/Button.tsx';
import { askConfirm } from '../../../ui/dialogs.js';
import { useFadeOnChange } from '../../../ui/motion.ts';
import { describeUsage, findUsage, deleteItem, removePointers } from '../../form/references.js';
import { replaceRoute, routeHref, useRoute } from '../../route.js';
import { groupIssues } from '../../../api/client.ts';
import { Notice } from '../../ui.jsx';
import { getAtPath } from '../schemaPath.js';
import { factsAt, setPath } from './schemaFacts.js';
import { schemaAtPath } from '../schemaPath.js';
import { freshId } from '../../form/references.js';
import { describeAction } from '../../form/effects.js';
import { describeCondition } from '../../form/promptPreview.js';
import { PICTURE_STEPS } from '../../pictures/pictureSteps.js';
import { notRunAt } from '../../preflight.ts';
import { useRedactionKinds } from './useRedactionKinds.js';
import { STATE_WORDS, setShowAdvanced, useBuildSection, useShowAdvanced } from './buildContext.js';
import StepsView, { isStepList } from './StepsView.jsx';
import './detailed.css';

const FormEditor = lazy(() => import('../../form/FormEditor.jsx'));

// A Detailed part, drawn from a spec: a header (its number, title, the question it answers, and how many fields it has),
// then two columns of cards, each a list of rows (label on the left, the control on the right) with the technical
// settings folded under "Advanced" at the card's foot. Every row reads and writes the draft: through `get`/`put`
// (the part's own setters) or a `path` (the schema says what kind of control, its choices and whether it is required).
//
// A row spec:
//   { id, label, hint?, tags? ('r' required, 'p' a try-out that is not saved, 'm' moved here, 'n' a new idea),
//     kind? ('text' | 'long' | 'num' | 'sw' | 'ch' | 'multi' | 'list' | 'pick' | 'code' | 'form' | 'custom' | 'note'),
//     path?, get?(config), put?(config, value), options? ([{ value, label }] or (config) => …),
//     valueLabel?(value) (what a 'pick' shows for a value its list lacks), unit?, placeholder?,
//     rows?, disabled?, note?, render?(ctx) }
// A card spec: { id, title, from?, lead?, rows, adv? (row specs, usually with a `path`), body?(ctx),
//   keep?(ctx, entry) (why the chosen item can't be deleted, in place of its Delete button) }
// A part spec: { id, num, title, question, cols: [[card…], [card…]], top?(ctx) }

// "Required": marked so (tags 'r'), or the schema says so, but not on a switch (it always has a value) and not while
// the group it belongs to isn't there at all (a caller id, a search service not set up asks nothing yet)
const tagsOf = (row, facts, kind, config) => {
  const t = (typeof row.tags === 'function' ? row.tags(config) : row.tags) || '';
  const path = row.pathFor ? row.pathFor(config) : row.path;
  const groupMissing = !t && path?.length > 2 && getAtPath(config, path.slice(0, -1)) == null;
  return { req: kind !== 'sw' && (t.includes('r') || (!!facts?.required && !groupMissing)), tryout: t.includes('p'), idea: t.includes('n') };
};
// A row is left out while it doesn't apply: `hidden(config, ctx)`, or `disabled` worked out from the draft (a setting
// that hangs on a switch that is off, a field only another kind of item has). A row always read-only (`disabled: true`)
// stays, as read-only.
export const isShown = (row, ctx) => {
  if (typeof row.hidden === 'function' ? row.hidden(ctx.config, ctx) : row.hidden) return false;
  return !(typeof row.disabled === 'function' && row.disabled(ctx.config));
};

// The control a row gets: its own, or the one its schema calls for.
function kindOf(row, facts) {
  if (row.kind) return row.kind;
  if (row.render) return 'custom';
  if (!facts) return 'text';
  if (facts.kind === 'boolean') return 'sw';
  if (facts.kind === 'enum') return facts.choices.length <= 5 ? 'ch' : 'pick';
  if (facts.kind === 'number') return 'num';
  // the schema's own hints (agent config guide 5): a secret holds {"secret": NAME}, never a typed key, and an x-ref
  // names something declared elsewhere: both get the schema-drawn editor (a secret picker, a list of the ids)
  if (facts.kind === 'ref' || facts.kind === 'secret') return 'form';
  if (facts.kind === 'string' && facts.shape?.['x-ui']?.widget === 'textarea') return 'long';
  if (facts.kind === 'string') return 'text';
  if (facts.kind === 'array' && facts.itemKind === 'enum') return 'multi';
  if (facts.kind === 'array' && facts.itemKind === 'string') return 'list';
  return 'form';
}

export const readRow = (row, config) => (row.get ? row.get(config) : row.path ? getAtPath(config, row.path) : undefined);
export const writeRow = (row, config, value) => {
  if (row.put) return row.put(config, value);
  if (!row.path) return config;
  // an emptied optional box takes the key out, so the draft holds only what was set
  return setPath(config, row.path, value === '' ? undefined : value);
};

// The schema facts for a path, from the one shared copy of the schema (and the engine that reads it).
export function useFacts(config) {
  const { schema } = useSchema();
  const engine = useMemo(() => (schema ? createEngine(schema) : null), [schema]);
  const facts = useMemo(() => (path) => (Array.isArray(path) ? factsAt(engine, schema, path, config) : null), [engine, schema, config]);
  return { facts, engine, schema };
}

// Deletes a list's item, after asking when other parts of the draft point at it (and then taking those pointers out).
export async function removeEntry(ctx, collection, entry) {
  // an item of a list with no id yet (written in the JSON) is known only by its place: it is taken out from there (by
  // its key, which is its index, nothing would be found, and "deleted" would be said with nothing gone)
  const at = entry.base?.[entry.base.length - 1];
  if (typeof at === 'number' && !(entry.item && typeof entry.item.id === 'string' && entry.item.id)) {
    const holderPath = entry.base.slice(0, -1);
    const holder = getAtPath(ctx.config, holderPath);
    if (Array.isArray(holder))
      ctx.set(
        setPath(
          ctx.config,
          holderPath,
          holder.filter((_, i) => i !== at),
        ),
      );
    return;
  }
  const id = entry.key;
  const hits = ctx.engine ? findUsage(ctx.engine, ctx.config, collection, id) : [];
  if (hits.length) {
    const ok = await askConfirm({
      title: `Delete “${entry.name}”?`,
      body: `It is used by ${describeUsage(ctx.config, hits).join(', ')}. Those places will stop pointing at it.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
  }
  const next = deleteItem(ctx.config, collection, id);
  ctx.set(ctx.engine && hits.length ? removePointers(ctx.engine, next, collection, id).config : next);
}

// Runs a deletion and, when it changed the draft, offers the item back with Undo (the page's notice, until the draft
// changes again). `run` gets the ctx to delete with; a deletion the person called off changes nothing and offers nothing.
export async function deleteWithUndo(ctx, word, name, run) {
  const before = ctx.config;
  let changed = false;
  await run({
    ...ctx,
    set: (next) => {
      changed = true;
      ctx.set(next);
    },
  });
  if (changed) ctx.deleted?.(`${word ? `${word[0].toUpperCase()}${word.slice(1)} ` : ''}“${name}” deleted.`, before);
}

// A card's rows and Advanced rows: fixed, or worked out from the draft (an item card follows the chosen item).
const rowsOf = (card, ctx) => (card.rowsFor ? card.rowsFor(ctx) : card.rows) || [];
const advOf = (card, ctx) => (card.advFor ? card.advFor(ctx) : card.adv) || [];

// a row's value counts as given unless it is missing, empty words or an empty list
const isEmpty = (value) => value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);

// How many fields a part has, how many are required, how many required ones are still empty (`missing`) and how many
// are folded under Advanced: counted from its cards.
export function countPart(part, given) {
  let fields = 0;
  let required = 0;
  let missing = 0;
  let advanced = 0;
  // an empty list still has its item's fields: counted on a stand-in first item
  const lists = Object.fromEntries(part.cols.flat().flatMap((card) => (card.list ? [[card.list.id, card.list]] : [])));
  const standIn = (l) => [...l.path, given.facts(l.path)?.kind === 'map' ? '_' : 0];
  // (a list gathered from several places, with no single path, has no stand-in: its card counts no rows while empty)
  const ctx = {
    ...given,
    chosen: (id) => given.chosen(id) || (lists[id]?.path ? { key: '', name: '', base: standIn(lists[id]), item: undefined } : null),
  };
  for (const card of part.cols.flat()) {
    // a list card's chips count as a field, unless the card also shows the chosen item's fields (they are the fields)
    if (card.list && card.of !== card.list.id) {
      fields += 1;
      if (tagsOf(card.list, null, 'custom', ctx.config).req) required += 1;
    }
    for (const row of rowsOf(card, ctx)) {
      fields += 1;
      // what is required now: a row hidden while it doesn't apply asks nothing yet
      if (!isShown(row, ctx)) continue;
      const path = row.pathFor ? row.pathFor(ctx.config) : row.path;
      const facts = path ? ctx.facts(path) : null;
      if (tagsOf(row, facts, kindOf(row, facts), ctx.config).req) {
        required += 1;
        // only a row that reads a value can be empty (a stand-in item's rows are not: the list is what is empty)
        const real = !card.of || !!given.chosen(card.of);
        if (real && (path || row.get) && isEmpty(readRow(path ? { ...row, path } : row, ctx.config))) missing += 1;
      }
    }
    advanced += advOf(card, ctx).length;
  }
  return { fields: fields + advanced, required, missing, advanced };
}

// ---- lists of items (tools, channels, transfers…) -----------------------------------------------------------------
// A list card names a list in the draft ({ id, path, label, nameOf, add?, word }); its items show as chips and the
// chosen one opens in its item card ({ of: listId, titleFor(name), rowsFor(ctx), advFor(ctx) }), whose rows are
// worked out from ctx.chosen(listId).base. Lists may be arrays (items with an `id`) or maps (keyed by name).

export function entriesOf(list, config, extra = {}) {
  // a list gathered from several places (every subagent's hand-overs) says its own entries
  if (list.entries) return list.entries(config, extra);
  const value = getAtPath(config, list.path);
  if (Array.isArray(value))
    return value.map((item, i) => ({
      key: item && typeof item === 'object' && typeof item.id === 'string' ? item.id : String(i),
      name: list.nameOf ? list.nameOf(item, i, config) : String(item?.id ?? i + 1),
      base: [...list.path, i],
      item,
    }));
  if (value && typeof value === 'object')
    return Object.entries(value).map(([key, item]) => ({
      key,
      name: list.nameOf ? list.nameOf(item, key, config) : key,
      base: [...list.path, key],
      item,
    }));
  return [];
}

// The part's choices of item, one per list, kept in the address (?item=list:key) so "show me", search and a reload
// open the same item; the first item when none is chosen.
function useChoices(part, config, extra = {}) {
  const route = useRoute();
  const lists = useMemo(() => part.cols.flat().flatMap((card) => (card.list ? [card.list] : [])), [part]);
  const [picked, setPicked] = useState(() => {
    const [list, key] = String(route.params?.item || '').split(':');
    return list && key ? { [list]: key } : {};
  });
  // a link or search that names an item (?item=) chooses it
  const asked = route.params?.item;
  const [seen, setSeen] = useState(asked);
  if (asked !== seen) {
    setSeen(asked);
    const [list, key] = String(asked || '').split(':');
    if (list && key) setPicked((old) => ({ ...old, [list]: key }));
  }
  const listById = useMemo(() => Object.fromEntries(lists.map((l) => [l.id, l])), [lists]);
  const items = (id) => (listById[id] ? entriesOf(listById[id], config, extra) : []);
  // where each list's chosen item was: an item renamed under its card (its key is its name, as a check's "Its name") is
  // the same item in the same place, so the card stays on it rather than jumping to the first
  const lastBase = useRef({});
  const chosen = (id) => {
    const all = items(id);
    const same = (e) => JSON.stringify(e.base) === lastBase.current[id];
    const found = all.find((e) => e.key === picked[id]) || (lastBase.current[id] ? all.find(same) : null) || all[0] || null;
    if (found) lastBase.current[id] = JSON.stringify(found.base);
    return found;
  };
  const choose = (id, key) => {
    delete lastBase.current[id];
    setPicked((old) => ({ ...old, [id]: key }));
    if (route.view === 'bot') replaceRoute(routeHref(route.botId, route.tab, { ...route.params, item: `${id}:${key}` }));
  };
  return { items, chosen, choose };
}

// Brings a row into view and focuses its control: the row named by `focus` ("agent.greeting"), or the one whose path
// holds `path` (a problem's "show me", a search result). The row glows for a moment.
function useRowFocus(root, { focus, path, nonce } = {}) {
  useEffect(() => {
    if (!nonce || (!focus && !Array.isArray(path))) return undefined;
    let tries = 0;
    let timer = null;
    const find = () => {
      const rows = [...(root.current?.querySelectorAll('.dtRow') || [])];
      if (focus) return rows.find((row) => row.dataset.field === focus || row.dataset.field?.endsWith(`.${focus}`));
      const want = path.map(String);
      // the row whose path is the longest start of the asked path (or that the asked path starts)
      let best = null;
      let bestLength = -1;
      rows.forEach((row) => {
        const own = (row.dataset.path || '').split('.').filter(Boolean);
        if (!own.length) return;
        const n = Math.min(own.length, want.length);
        if (own.slice(0, n).every((part, i) => part === want[i]) && n > bestLength) {
          best = row;
          bestLength = n;
        }
      });
      return best;
    };
    const go = () => {
      const row = find();
      if (!row) {
        tries += 1;
        if (tries < 6) timer = window.setTimeout(go, 100);
        return;
      }
      row.scrollIntoView({ block: 'center' });
      row.classList.remove('dtFlash');
      row.getBoundingClientRect(); // the glow starts again when asked twice
      row.classList.add('dtFlash');
      row.querySelector('input, textarea, button, [tabindex]')?.focus({ preventScroll: true });
    };
    timer = window.setTimeout(go, 60);
    return () => window.clearTimeout(timer);
  }, [root, focus, path, nonce]);
}

// The page around a part: the draft, the schema facts and the item choices every card reads.
//   request: { focus?, path?, nonce } a row to bring into view; notices: shown above the part
export function DetailedPage({ part, editor, extra = {}, request = null, notices = null, onShowJson }) {
  const config = editor.parsed.value;
  const { facts, engine, schema } = useFacts(config);
  const choices = useChoices(part, config, extra);
  const root = useRef(null);
  // a request for a place inside a list (a problem in tools[2], ?tool=) chooses that item first, so its card is open
  const lists = useMemo(() => part.cols.flat().flatMap((card) => (card.list ? [card.list] : [])), [part]);
  useEffect(() => {
    const path = request?.path;
    if (!Array.isArray(path)) return;
    for (const l of lists) {
      if (!Array.isArray(l.path)) continue;
      if (path.length > l.path.length && l.path.every((p, i) => String(p) === String(path[i]))) {
        const key = path[l.path.length];
        const item = getAtPath(config, [...l.path, key]);
        choices.choose(l.id, String(item && typeof item === 'object' && typeof item.id === 'string' ? item.id : key));
        return;
      }
    }
    // the request is answered once, on its nonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);
  useRowFocus(root, request || {});
  // what the checks found, by path, so each row says what is wrong with it under itself
  const issues = useMemo(() => groupIssues(editor.report).filter((i) => i.severity === 'error' && Array.isArray(i.path)), [editor.report]);
  // an item just deleted, offered back with Undo until the draft changes again
  // { label, previous, after }: `after` is the draft as the deletion left it
  const [removed, setRemoved] = useState(null);
  useEffect(() => {
    if (!removed) return;
    // the first draft other than `previous` is the one the deletion left
    if (!removed.after) {
      if (config !== removed.previous) setRemoved({ ...removed, after: config });
    } else if (config !== removed.after) setRemoved(null);
  }, [config, removed]);
  const deleted = (label, previous) => setRemoved({ label, previous });
  // the kinds of personal detail the server can find, for the redaction and personal-detail checkboxes (10.1)
  const redactionKinds = useRedactionKinds();
  const ctx = { config, set: editor.setValue, editor, facts, engine, schema, issues, deleted, redactionKinds, request, ...choices, ...extra };
  if (editor.parsed.error || !config || typeof config !== 'object') {
    return (
      <div className="dtBroken" role="status">
        <strong>The JSON needs fixing first</strong>
        <p>This part reads the draft, which isn’t valid JSON right now.</p>
        {onShowJson && (
          <Button type="button" onClick={onShowJson}>
            Open the JSON
          </Button>
        )}
      </div>
    );
  }
  return (
    <div ref={root} className="dtPage">
      {removed && (
        <Notice
          kind="info"
          title={removed.label}
          actions={
            <>
              <Button
                type="button"
                onClick={() => {
                  editor.setValue(removed.previous);
                  setRemoved(null);
                }}
              >
                Undo
              </Button>
              <button type="button" className="linkButton" onClick={() => setRemoved(null)}>
                Dismiss
              </button>
            </>
          }
        />
      )}
      {notices}
      {/* a part may draw itself its own way (Agent: a profile), from the same rows */}
      {part.render ? part.render(ctx) : <DetailedPart part={part} ctx={ctx} />}
    </div>
  );
}

// "a tool", "an event"
export const withA = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

// The one way to add to a list, named for what it adds ("Add a tool"): the list's own picker (renderAdd), or its
// `add(config)` with the new item chosen.
function AddToList({ list, ctx, word }) {
  if (list.renderAdd) return list.renderAdd(ctx);
  if (!list.add) return null;
  const add = () => {
    const made = list.add(ctx.config);
    if (!made) return;
    ctx.set(made.config);
    if (made.key !== undefined) ctx.choose(list.id, String(made.key));
  };
  return (
    <Button type="button" variant="secondary" size="small" className="dtAddBtn" onClick={add}>
      <Icon name="plus" size={14} />
      {list.addLabel || `Add ${withA(word || 'item')}`}
    </Button>
  );
}

// The chips of a list's items, the chosen one marked. An empty list says so, with the way to add right there; a list
// with items has its Add at the top of its card.
function ItemChips({ list, ctx, id, word }) {
  const entries = ctx.items(list.id);
  const current = ctx.chosen(list.id);
  if (entries.length === 0)
    return (
      <div className="dtEmptyList" id={id}>
        <span>{list.empty || `None yet.`}</span>
        <AddToList list={list} ctx={ctx} word={word} />
      </div>
    );
  return (
    <div className="dtItems" id={id} role="group" aria-label={list.label}>
      {entries.map((entry) => (
        <button key={entry.key} type="button" aria-current={current?.key === entry.key} onClick={() => ctx.choose(list.id, entry.key)}>
          {entry.name}
        </button>
      ))}
    </div>
  );
}

// A list's items as rows, each saying what it is (list.describe(entry, ctx) → { icon?, meta?, detail?, state? }) with an
// Edit that opens its settings under the list; the chosen one is marked. Empty, it says what the list is for, with Add.
//   state: { tone: 'good' | 'warn' | 'bad' | 'off', words }
export function ItemRows({ list, ctx, id, word, add }) {
  const entries = ctx.items(list.id);
  const current = ctx.chosen(list.id);
  if (!entries.length)
    return (
      <div className="dtIEmpty" id={id}>
        <span className="dtIEmptyIcon" aria-hidden="true">
          <Icon name={list.icon || 'plus'} size={20} />
        </span>
        <div>
          <strong>{list.emptyTitle || `No ${word ? `${word}s` : 'items'} yet`}</strong>
          {list.empty && <p>{list.empty}</p>}
        </div>
        {add}
      </div>
    );
  return (
    <ul className="dtIList" id={id} aria-label={list.label}>
      {entries.map((entry) => {
        const about = list.describe(entry, ctx) || {};
        const on = current?.key === entry.key;
        return (
          <li key={entry.key} className={on ? 'on' : ''} data-item={entry.key}>
            <span className="dtIIcon" aria-hidden="true">
              <Icon name={about.icon || list.icon || 'list'} size={16} />
            </span>
            <div className="dtIText">
              <span className={list.mono ? 'dtIName mono' : 'dtIName'}>{entry.name}</span>
              {about.meta && <span className="dtIMeta">{about.meta}</span>}
              {about.detail && <span className="dtIDetail">{about.detail}</span>}
            </div>
            {about.state ? <span className={`dtIState ${about.state.tone}`}>{about.state.words}</span> : <span />}
            <Button type="button" variant={on ? 'quiet' : 'secondary'} size="small" aria-pressed={on} onClick={() => ctx.choose(list.id, entry.key)}>
              {/* the visible words first, then whose: "Edit mx_bridge", "Editing below mx_bridge" */}
              {on ? 'Editing below' : 'Edit'}
              <span className="srOnly"> {entry.name}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// The part's cards by name, to jump to one on a long part; a dot marks a card holding something the checks found.
function CardJumps({ part, ctx }) {
  const cards = part.cols.flat().map((card) => {
    const rows = card.of && !ctx.chosen(card.of) ? [] : rowsOf(card, ctx);
    const paths = [card.list?.path, ...rows.map((row) => row.errPath || (row.pathFor ? row.pathFor(ctx.config) : row.path))].filter(Boolean);
    const problem = (ctx.issues || []).some((issue) => paths.some((at) => at.every((p, n) => String(issue.path[n]) === String(p))));
    return { id: card.id, name: card.title || (card.word ? `The ${card.word}` : 'Details'), problem };
  });
  if (cards.length < 3) return null;
  const jump = (id) => {
    const el = document.querySelector(`[data-card="${part.id}.${id}"]`);
    el?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el?.querySelector('h2')?.focus?.();
  };
  return (
    <nav className="dtJumps" aria-label={`The cards of ${part.title}`}>
      {cards.map((card) => (
        <button key={card.id} type="button" onClick={() => jump(card.id)}>
          {card.name}
          {card.problem && <i className="dtJumpDot" aria-label="Something to fix here" role="img" />}
        </button>
      ))}
    </nav>
  );
}

// The switch in a part's header that opens every "Advanced" fold, on every part, for this person (remembered)
function AdvancedToggle({ partId, count }) {
  const on = useShowAdvanced();
  return (
    <span className="dtAdvToggle" data-count={count}>
      <Switch id={`dt-${partId}-showadv`} checked={on} label="Show advanced settings" onChange={setShowAdvanced} />
      <label htmlFor={`dt-${partId}-showadv`}>
        Show advanced settings <span className="dtAdvCount">· {count}</span>
      </label>
    </span>
  );
}

export function DetailedPart({ part, ctx }) {
  const counts = countPart(part, ctx);
  const section = useBuildSection(part.id);
  return (
    <section className="dtPart" data-part={part.id} aria-labelledby={`dt-${part.id}-title`} style={{ '--dt-hue': `var(--hue-${part.id}, var(--accent))` }}>
      <header className="dtHead">
        <span className="dtNum" aria-hidden="true">
          {part.num}
        </span>
        <div className="dtHeadText">
          <h1 id={`dt-${part.id}-title`}>{part.title}</h1>
          <p className="dtQuestion">{part.question}</p>
          {(section || counts.missing > 0) && (
            <p className="dtState">
              {section && (
                <span className={`dtStateChip ${section.state}`} data-state={section.state}>
                  {STATE_WORDS[section.state] || section.state}
                </span>
              )}
              {counts.missing > 0 && (
                <span className="dtStateChip todo" data-missing={counts.missing}>
                  {counts.missing} required {counts.missing === 1 ? 'field' : 'fields'} to fill in
                </span>
              )}
              {section?.status && <span className="dtStateText">{section.status}</span>}
            </p>
          )}
        </div>
        {(counts.advanced > 0 || ctx.actions) && (
          <div className="dtHeadSide">
            {counts.advanced > 0 && !ctx.forceAdvanced && <AdvancedToggle partId={part.id} count={counts.advanced} />}
            {ctx.actions && <div className="nlPageActions dtActions">{ctx.actions}</div>}
          </div>
        )}
      </header>
      <CardJumps part={part} ctx={ctx} />
      {part.top && part.top(ctx)}
      <div className="dtCols">
        {part.cols.map((cards, i) => (
          // the columns are one reading order: the first, then the second
          <div className="dtCol" key={i}>
            {cards.map((card) => (
              <DetailedCard key={card.id} card={card} ctx={ctx} partId={part.id} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function DetailedCard({ card, ctx, partId }) {
  // an item card follows the item chosen in its list
  const entry = card.of ? ctx.chosen(card.of) : null;
  // an item's card fades in when another item is chosen (not the card that holds the list of items)
  const box = useRef(null);
  useFadeOnChange(box, card.of && !card.list ? (entry ? JSON.stringify(entry.base) : '') : 'list');
  // a search over the part (Agent's All settings) keeps the rows whose name or help says it
  const q = String(ctx.rowFilter || '')
    .trim()
    .toLowerCase();
  const says = (row) => !q || `${row.label || ''} ${typeof row.hint === 'string' ? row.hint : ''}`.toLowerCase().includes(q);
  const rows = (card.of && !entry ? [] : rowsOf(card, ctx)).filter(says);
  const adv = (card.of && !entry ? [] : advOf(card, ctx)).filter(says);
  const title = card.titleFor ? card.titleFor(entry, ctx) : card.title;
  const lead = typeof card.lead === 'function' ? card.lead(ctx, entry) : card.lead;
  const listed = card.list && !card.list.hidden ? ctx.items(card.list.id) : [];
  const waiting = card.waiting ? card.waiting(ctx) : '';
  if (waiting)
    return (
      <section ref={box} className="dtCard waiting" data-card={`${partId}.${card.id}`} aria-labelledby={`dt-${partId}-card-${card.id}`}>
        <header className="dtCardHead">
          <h2 id={`dt-${partId}-card-${card.id}`}>{card.title}</h2>
        </header>
        <p className="dtLead">{waiting}</p>
      </section>
    );
  const word = card.word || card.list?.word;
  if (q && !rows.some((row) => isShown(row, ctx)) && !adv.some((row) => isShown(row, ctx))) return null;
  return (
    <section
      ref={box}
      className={`dtCard ${card.list && !card.list.hidden && listed.length === 0 && !rows.length ? 'empty' : ''}`}
      data-card={`${partId}.${card.id}`}
      aria-labelledby={`dt-${partId}-card-${card.id}`}
    >
      <header className="dtCardHead">
        <h2 id={`dt-${partId}-card-${card.id}`} tabIndex={-1}>
          {title}
        </h2>
        {listed.length > 0 && (
          <div className="dtCardAdd">
            <AddToList list={card.list} ctx={ctx} word={word} />
          </div>
        )}
      </header>
      {lead && <p className="dtLead">{lead}</p>}
      {card.body && card.body(ctx, entry)}
      {card.list && !card.list.hidden && (
        <DetailedRow
          row={{
            ...card.list,
            path: undefined,
            kind: 'custom',
            // a list that says what each item is shows a row per item, the whole width of the card
            wide: card.list.wide ?? !!card.list.describe,
            render: (c) =>
              card.list.describe ? (
                <ItemRows list={card.list} ctx={ctx} id={c.id} word={word} add={<AddToList list={card.list} ctx={ctx} word={word} />} />
              ) : (
                <ItemChips list={card.list} ctx={ctx} id={c.id} word={word} />
              ),
          }}
          ctx={ctx}
          partId={partId}
        />
      )}
      {card.of && !entry && !card.list && <p className="dtNote dtEmpty">{card.empty || 'Nothing to show yet.'}</p>}
      {rows
        .filter((row) => isShown(row, ctx))
        .map((row) => (
          <DetailedRow key={row.id} row={row} ctx={ctx} partId={partId} />
        ))}
      {entry && card.remove && (
        <div className="dtItemFoot">
          {card.keep?.(ctx, entry) ? (
            <p className="dtNote">{card.keep(ctx, entry)}</p>
          ) : (
            <Button type="button" variant="secondary" size="small" onClick={() => deleteWithUndo(ctx, card.word, entry.name, (c) => card.remove(c, entry))}>
              Delete {card.word ? `this ${card.word}` : `“${entry.name}”`}
            </Button>
          )}
        </div>
      )}
      {adv.filter((row) => isShown(row, ctx)).length > 0 && (
        <AdvancedFoot
          key={entry ? JSON.stringify(entry.base) : 'card'}
          rows={adv.filter((row) => isShown(row, ctx))}
          ctx={ctx}
          partId={partId}
          cardId={card.id}
          openAll={!!ctx.forceAdvanced}
        />
      )}
    </section>
  );
}

export function DetailedRow({ row: spec, ctx, partId }) {
  // a row whose place depends on the draft (which knowledge base, which item) names it with pathFor(config)
  const row = spec.pathFor ? { ...spec, path: spec.pathFor(ctx.config) || undefined } : spec;
  const facts = row.path ? ctx.facts(row.path) : null;
  const kind = kindOf(row, facts);
  const tags = tagsOf(row, facts, kind, ctx.config);
  // what the setting does, in the schema's plain words, when the row says nothing itself
  const hint = row.hint || (row.hint !== false && facts?.purpose && !/^(custom|form)$/.test(kind) ? facts.purpose : '');
  const id = `dt-${partId}-${row.id}`;
  const value = readRow(row, ctx.config);
  const change = (next) => ctx.set(writeRow(row, ctx.config, next));
  const at = row.errPath || row.path;
  const problem = at && (ctx.issues || []).find((i) => at.every((part, n) => String(i.path[n]) === String(part)));
  // the server's own word that it doesn't run this yet (agent config guide 8), read from its report every time
  const notRun = row.serverNote === false ? '' : notRunAt(ctx.editor?.report?.unsupported, row.notRunPath || row.path);
  // a list of steps reads best the whole width of the card, under its name
  const stacked = kind === 'form' && isStepList(value) && value.length > 3;
  return (
    <div
      className={['dtRow', tags.tryout && 'tryout', row.wide && 'wide', stacked && 'stacked'].filter(Boolean).join(' ')}
      data-field={`${partId}.${row.id}`}
      data-path={row.path ? row.path.join('.') : undefined}
    >
      <div className={row.wide ? 'dtLabel srOnly' : 'dtLabel'}>
        <label htmlFor={id} id={`${id}-label`}>
          {row.label}
        </label>
        {tags.req && <span className="dtTag req">Required</span>}
        {tags.tryout && <span className="dtTag tryout">Try-out, not saved</span>}
        {tags.idea && <span className="dtTag idea">New idea</span>}
        {hint && <small>{hint}</small>}
      </div>
      <div className="dtControl">
        <Control kind={kind} row={row} id={id} value={value} onChange={change} facts={facts} ctx={ctx} />
        {problem && <small className="stFieldError">{row.errorText ? row.errorText(problem) : problem.message}</small>}
        {row.note && <small className="dtNote">{typeof row.note === 'function' ? row.note(ctx.config, ctx) : row.note}</small>}
        {notRun && <small className="dtNote">Not run yet: the server keeps this but does not act on it ({notRun}).</small>}
      </div>
    </div>
  );
}

const optionsOf = (row, facts, config, item = false, ctx = null) => {
  const own = typeof row.options === 'function' ? row.options(config, ctx) : row.options;
  return own || (item ? facts?.itemChoices : facts?.choices) || [];
};

function Control({ kind, row, id, value, onChange, facts, ctx }) {
  const labelled = `${id}-label`;
  const disabled = typeof row.disabled === 'function' ? !!row.disabled(ctx.config) : !!row.disabled;
  switch (kind) {
    case 'custom':
      return row.render({ ...ctx, id, value, onChange });
    case 'note':
      return (
        <p className="dtNoteValue" id={id}>
          {typeof row.text === 'function' ? row.text(ctx.config) : row.text || String(value ?? '')}
        </p>
      );
    case 'long':
      return (
        <TextArea
          id={id}
          rows={row.rows || 3}
          value={value ?? ''}
          placeholder={row.placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'num':
      return (
        <span className="dtNum2">
          <NumberInput
            id={id}
            value={typeof value === 'number' ? value : value === '' || value == null ? null : Number(value)}
            onChange={(n) => onChange(n === null ? undefined : n)}
            min={row.min ?? facts?.min}
            max={row.max ?? facts?.max}
            integer={row.integer ?? facts?.integer}
            // a number that can't be empty (nullable: false) keeps its last value while the box is cleared to type a new one
            nullable={row.nullable !== false}
            disabled={disabled}
            placeholder={row.placeholder ?? (facts?.def !== undefined ? String(facts.def) : 'Not set')}
          />
          {row.unit && <span className="dtUnit">{row.unit}</span>}
        </span>
      );
    case 'sw': {
      const on = value === undefined && facts?.def !== undefined ? !!facts.def : !!value;
      return (
        <span className="dtSw">
          <Switch id={id} checked={on} disabled={disabled} label={row.label} onChange={(next) => onChange(next)} />
        </span>
      );
    }
    case 'ch': {
      const options = optionsOf(row, facts, ctx.config, false, ctx);
      const current = value === undefined ? facts?.def : value;
      return (
        <div className="dtPills" role="radiogroup" aria-labelledby={labelled} id={id}>
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={current === option.value}
              className={current === option.value ? 'on' : ''}
              disabled={disabled || option.disabled}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      );
    }
    case 'multi': {
      const offered = optionsOf(row, facts, ctx.config, true, ctx);
      const chosen = Array.isArray(value) ? value : [];
      // a value the config holds that isn't offered (written by hand, or no longer listed) still shows, ticked, so what
      // the agent really uses is never hidden and can be unticked
      const options = [
        ...offered,
        ...chosen.filter((v) => !offered.some((o) => o.value === v)).map((v) => ({ value: v, label: String(v).replace(/_/g, ' ') })),
      ];
      return (
        <div className="dtPills" role="group" aria-labelledby={labelled} id={id}>
          {options.map((option) => {
            const on = chosen.includes(option.value);
            return (
              <button
                key={String(option.value)}
                type="button"
                aria-pressed={on}
                className={on ? 'on' : ''}
                disabled={disabled || option.disabled}
                onClick={() => onChange(on ? chosen.filter((v) => v !== option.value) : [...chosen, option.value])}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'pickchips': {
      // chosen values as chips, and a list of the rest to add one from
      const options = optionsOf(row, facts, ctx.config, true, ctx);
      const chosen = Array.isArray(value) ? value : [];
      const nameOf = (v) => options.find((o) => o.value === v)?.label || String(v);
      return (
        <div className="dtChips">
          {chosen.length > 0 && (
            <ul aria-label={row.label}>
              {chosen.map((v) => (
                <li key={String(v)}>
                  <span>{nameOf(v)}</span>
                  {!disabled && (
                    <button type="button" aria-label={`Remove “${nameOf(v)}”`} onClick={() => onChange(chosen.filter((c) => c !== v))}>
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!disabled && (
            <span className="dtChipAdd">
              <Select
                id={id}
                className="stFInput"
                aria-labelledby={labelled}
                value=""
                onChange={(event) => event.target.value && onChange([...chosen, event.target.value])}
              >
                <option value="">{row.placeholder || '+ Add'}</option>
                {options
                  .filter((o) => !chosen.includes(o.value))
                  .map((o) => (
                    <option key={String(o.value)} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </Select>
            </span>
          )}
        </div>
      );
    }
    case 'list':
      return (
        <ChipList id={id} label={row.label} items={Array.isArray(value) ? value : []} onChange={onChange} placeholder={row.placeholder} disabled={disabled} />
      );
    case 'pick': {
      const listed = optionsOf(row, facts, ctx.config, false, ctx);
      // a value the list doesn't have (set elsewhere, or from an older list) still shows as itself, never as "Choose…"
      const unlisted = value !== undefined && value !== null && value !== '' && !listed.some((option) => String(option.value) === String(value));
      const options = unlisted ? [{ value, label: row.valueLabel ? row.valueLabel(value) : String(value) }, ...listed] : listed;
      return (
        <Select
          id={id}
          className="stFInput"
          aria-labelledby={labelled}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">{row.placeholder || 'Choose…'}</option>
          {options.map((option) => (
            <option key={String(option.value)} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }
    case 'code':
      return <JsonInput id={id} value={value} onChange={onChange} disabled={disabled} />;
    case 'form':
      return <FormRow row={row} id={id} value={value} ctx={ctx} />;
    default:
      return (
        <Input id={id} type="text" value={value ?? ''} placeholder={row.placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      );
  }
}

// Words in a row, each with its own ×, and a box to add one (Enter adds it).
export function ChipList({ id, label, items, onChange, placeholder, disabled }) {
  const [typed, setTyped] = useState('');
  // words typed or pasted with commas are one each; one already there is not added twice
  const add = () => {
    const seen = new Set(items.map((i) => String(i).toLowerCase()));
    const fresh = typed
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word && !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()));
    if (fresh.length) onChange([...items, ...fresh]);
    setTyped('');
  };
  if (disabled && !items.length) return <span className="dtNote">None</span>;
  return (
    <div className="dtChips">
      {items.length > 0 && (
        <ul aria-label={label}>
          {/* by place: the same words twice (the schema allows it) are two chips, and × takes away only the one pressed */}
          {items.map((item, at) => (
            <li key={`${at}:${String(item)}`}>
              <span>{String(item)}</span>
              {!disabled && (
                <button type="button" aria-label={`Remove “${item}”`} onClick={() => onChange(items.filter((_, i) => i !== at))}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <span className="dtChipAdd">
          <Input
            id={id}
            size="small"
            value={typed}
            placeholder={placeholder || '+ Add'}
            aria-label={`Add to “${label}”`}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
          />
        </span>
      )}
    </div>
  );
}

// The card's foot: "Advanced · N" and the folded settings by name; opened, the same rows as above. It starts open while
// the person has "Show advanced settings" on, and can still be folded by hand.
function AdvancedFoot({ openAll = false, ...props }) {
  const showAll = useShowAdvanced() || openAll;
  // drawn afresh when the switch changes, so every fold follows it
  return <AdvancedFold key={showAll ? 'all' : 'one'} {...props} showAll={showAll} />;
}
function AdvancedFold({ rows, ctx, partId, cardId, showAll }) {
  const [open, setOpen] = useState(showAll);
  return (
    <Fold className="dtAdv" open={showAll} onToggle={(event) => setOpen(event.currentTarget.open)}>
      {/* the names stay in view while it is folded, so what is in there is never a surprise */}
      <summary>
        <span className="dtAdvTitle">
          <Icon name="chevronRight" size={12} />
          Advanced · {rows.length}
        </span>
        {!open && (
          <span className="dtAdvNames">
            {rows.map((row) => (
              <span key={row.id}>{row.label}</span>
            ))}
          </span>
        )}
      </summary>
      {open && (
        <div className="dtAdvRows" data-card-adv={`${partId}.${cardId}`}>
          {rows.map((row) => (
            <DetailedRow key={row.id} row={row} ctx={ctx} partId={partId} />
          ))}
        </div>
      )}
    </Fold>
  );
}

// ---- items edited in place, inside one row ---------------------------------------------------------------------------
// A short list in a row (fixed lines, variables, events, pronunciation rules): each item a chip, "+ Add", and the chosen
// one opened under them in the settings form, with its own Delete. A new item starts from the schema's own default.
//   path: the list or map; word: names an item ("line"); nameOf(item, key): its chip; collection: references.js name
//   make(ctx): { config, key } for a new item, when the default isn't right
export function newItem(ctx, path, word) {
  const holder = getAtPath(ctx.config, path);
  const isMap = !Array.isArray(holder) && holder && typeof holder === 'object';
  const asMap = isMap || (!Array.isArray(holder) && ctx.facts(path)?.kind === 'map');
  const taken = asMap ? Object.keys(holder || {}) : (Array.isArray(holder) ? holder : []).map((i) => i?.id).filter(Boolean);
  const key = freshId(taken, word);
  const itemSchema = ctx.engine && ctx.schema ? schemaAtPath(ctx.engine, ctx.schema, [...path, asMap ? key : 0], ctx.config) : null;
  let item = itemSchema ? ctx.engine.defaultFor(itemSchema) : {};
  if (asMap) return { config: setPath(ctx.config, [...path, key], item ?? {}), key };
  const list = Array.isArray(holder) ? holder : [];
  const hasId = !!(itemSchema && ctx.engine.flatten(itemSchema).properties?.id);
  if (hasId && item && typeof item === 'object') item = { ...item, id: key };
  return { config: setPath(ctx.config, path, [...list, item]), key: hasId ? key : String(list.length) };
}

// past this many items a list can be searched, and shows the first few until asked for all
const MANY = 16;
const FEW = 24;

export function InlineItems({ ctx, id, path, word, label, nameOf, make, collection }) {
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const entries = entriesOf({ path, nameOf }, ctx.config);
  const current = entries.find((e) => e.key === open) || null;
  const many = entries.length > MANY;
  const q = query.trim().toLowerCase();
  const matching = q ? entries.filter((e) => `${e.key} ${e.name}`.toLowerCase().includes(q)) : entries;
  // the open one stays in view whatever is typed
  const shown = (all || q ? matching : matching.slice(0, FEW)).concat(current && !matching.includes(current) ? [current] : []);
  const add = () => {
    const made = make ? make(ctx) : newItem(ctx, path, word);
    if (!made) return;
    ctx.set(made.config);
    setOpen(String(made.key));
  };
  const remove = (entry) =>
    deleteWithUndo(ctx, word, entry.name, async (c) => {
      if (collection) await removeEntry(c, collection, entry);
      else {
        const holder = getAtPath(c.config, path);
        if (Array.isArray(holder))
          c.set(
            setPath(
              c.config,
              path,
              holder.filter((_, i) => i !== entry.base.at(-1)),
            ),
          );
        else c.set(setPath(c.config, [...path, entry.key], undefined));
      }
      setOpen(null);
    });
  return (
    <>
      {many && (
        <div className="dtFind">
          <Icon name="search" size={14} />
          <Input
            size="small"
            value={query}
            aria-label={`Search ${label}`}
            placeholder={`Search ${entries.length} ${word}s`}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="dtFindCount" aria-live="polite">
            {q ? `${matching.length} of ${entries.length}` : all || entries.length <= FEW ? `${entries.length} in all` : `${FEW} of ${entries.length}`}
          </span>
        </div>
      )}
      <div className="dtItems" id={id} role="group" aria-label={label}>
        {shown.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-current={open === entry.key}
            aria-expanded={open === entry.key}
            onClick={() => setOpen(open === entry.key ? null : entry.key)}
          >
            {entry.name}
          </button>
        ))}
        {many && !q && !all && entries.length > FEW && (
          <Button type="button" variant="quiet" size="small" onClick={() => setAll(true)}>
            Show all {entries.length}
          </Button>
        )}
        <Button type="button" variant="secondary" size="small" className="dtAddBtn" onClick={add}>
          <Icon name="plus" size={14} />
          Add {withA(word)}
        </Button>
      </div>
      {current && (
        <div className="dtInlineItem">
          <Suspense fallback={null}>
            <div className="dtForm">
              <FormEditor editor={ctx.editor} itemPath={current.base} subtree embedded />
            </div>
          </Suspense>
          <div className="dtItemFoot">
            <Button type="button" variant="secondary" size="small" onClick={() => remove(current)}>
              Delete this {word}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// A short name for one item of a list, for the chips of a folded group: its own words, else its name or kind.
// A step with a condition says so, so two lines that never both run don't read as if they did:
// "“Photo received.” (only when the state photo is set)".
export function briefOf(item, i = 0, config = null) {
  const core = briefCore(item, i, config);
  return item && typeof item === 'object' && item.when && typeof item.when === 'object' ? `${core} (only when ${describeCondition(item.when)})` : core;
}
function briefCore(item, i = 0, config = null) {
  if (item == null) return '';
  if (typeof item === 'string' && Array.isArray(config?.messages)) {
    // a fixed line named by its id: its words
    const line = config.messages.find((m) => m && m.id === item);
    if (line) return briefOf(line, i);
  }
  if (typeof item !== 'object') return String(item);
  const text = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? text(v.text ?? v.say ?? Object.values(v)[0]) : '');
  // a picture step as its sentence ("Ask for the camera, keep it in selfie"), not its machine name
  if (PICTURE_STEPS.has(item.type)) {
    const words = describeAction(item);
    return words.length > 48 ? `${words.slice(0, 47)}…` : words;
  }
  if (item.id && item.text !== undefined && text(item.text)) {
    const words = text(item.text);
    return `“${words.length > 40 ? `${words.slice(0, 39)}…` : words}”`;
  }
  for (const key of ['say', 'text', 'message', 'label', 'title', 'name', 'id', 'do', 'type', 'on']) {
    const found = key === 'message' && typeof item.message === 'string' ? item.message : text(item[key]);
    if (!found) continue;
    // a fixed line named by its id: its words
    const line = Array.isArray(config?.messages) ? config.messages.find((m) => m && m.id === found) : null;
    if (line) return briefOf(line, i);
    if (key === 'message') return `“${found.replace(/_/g, ' ')}”`;
    return found.length > 48 ? `${found.slice(0, 47)}…` : found;
  }
  return `Item ${i + 1}`;
}

// What a folded group of settings holds, in a line: its words, its first few values ("number: +6561234567"), else its
// default from the schema, else that it is not set.
const scalar = (v) => ['string', 'number', 'boolean'].includes(typeof v);
const shown = (v) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
function summaryOf(value, def) {
  if (scalar(value) && value !== '') return shown(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const parts = Object.entries(value)
      .filter(([, v]) => scalar(v))
      .slice(0, 3)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${shown(v)}`);
    if (parts.length) return parts.join(' · ');
    return 'Set';
  }
  if (def !== undefined && def !== null && def !== '') return `Default: ${scalar(def) ? shown(def) : summaryOf(def)}`;
  return 'Not set';
}

// A group of settings the schema draws (a list of steps, a sound): shown folded as chips of what it holds, and opened
// in place with Edit, so a card stays short.
export function FormRow({ row, id, value, ctx }) {
  const [open, setOpen] = useState(false);
  if (!row.path) return <span className="dtNote">{row.missing || 'Not available until it is set up above.'}</span>;
  const items = Array.isArray(value) ? value : Array.isArray(value?.do) ? value.do : null;
  const set = value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
  // a list of steps reads as numbered cards, each with its own Edit (a few steps stay a short line of chips)
  const isSteps = isStepList(value) && value.length > 3;
  if (isSteps && !open)
    return (
      <div className="dtFormRow">
        <StepsView steps={value} path={row.path} ctx={ctx} label={row.label} />
        <div className="dtFormSummary">
          <Button type="button" variant="quiet" size="small" id={id} aria-labelledby={`${id} ${id}-label`} aria-expanded={false} onClick={() => setOpen(true)}>
            Edit all the steps
          </Button>
        </div>
      </div>
    );
  return (
    <div className="dtFormRow">
      <div className="dtFormSummary">
        {items && items.length > 0 ? (
          <ul className="dtBriefs" aria-label={row.label}>
            {items.map((item, i) => (
              <li key={i}>{briefOf(item, i, ctx.config)}</li>
            ))}
          </ul>
        ) : (
          <span className="dtNote">{summaryOf(value, ctx.facts(row.path)?.def)}</span>
        )}
        {/* named by its own words, then the row's: "Edit What it hears and says" */}
        <Button type="button" variant="quiet" size="small" id={id} aria-labelledby={`${id} ${id}-label`} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Done' : set ? 'Edit' : 'Set it'}
        </Button>
      </div>
      {open && (
        <Suspense fallback={null}>
          <div className="dtForm">
            <FormEditor editor={ctx.editor} itemPath={row.path} subtree embedded />
          </div>
        </Suspense>
      )}
    </div>
  );
}
