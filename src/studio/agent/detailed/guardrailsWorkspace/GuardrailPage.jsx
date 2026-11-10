import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { deleteWithUndo, isShown } from '../Detailed.jsx';
import { More, Rows, hasProblem, reveal } from '../workspaceKit.jsx';
import { PAGES } from './guardrailsLayout.js';
import { KINDS, checksIn, doesWhat, looksFor, ownRules } from './guardrailsWords.js';

// A check (on what callers say, or on what it says) or a rule of its own, on a page of its own (canvas boards G3, G4):
// its path in steps (what it looks for, when it finds it, how it is enforced; or when, then, what it says), each a
// section with the item card's own rows (the same controls as All settings). A row that doesn't apply to its kind is
// not there; its name is under "more". What really happens to it is said at the top, from the server's own report.

const clip = (t, n = 48) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const ENFORCED = { code: 'in code, every time', both: 'in code, and the agent is told', prompt: 'told to the agent' };
const textOf = (say) => (typeof say === 'string' ? say : say?.message ? `the line “${say.message}”` : '');

export default function GuardrailPage({ ctx, form, listId, itemKey, name, notRun, unsupported, onBack, onRekey }) {
  const [open, setOpen] = useState(null);
  const [lit, setLit] = useState(null);
  const sections = useRef({});
  const lastBase = useRef(null);
  const page = PAGES[listId];
  const cards = useMemo(() => Object.fromEntries(form.cols.flat().map((c) => [c.id, c])), [form]);
  const card = cards[page.card];
  const entries = ctx.items(listId);
  let entry = entries.find((e) => e.key === itemKey) || null;
  // renamed on this page (a check's name is its id): the same place in the list, under its new name
  if (!entry && lastBase.current) {
    entry = entries.find((e) => JSON.stringify(e.base) === JSON.stringify(lastBase.current)) || null;
  }
  if (entry) lastBase.current = entry.base;
  const renamed = entry && entry.key !== itemKey ? entry.key : '';
  useEffect(() => {
    if (renamed) onRekey(renamed);
  }, [renamed]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    if (!entry || !card) return {};
    const here = { ...ctx, chosen: (id) => (id === listId ? entry : ctx.chosen(id)) };
    return Object.fromEntries([...card.rowsFor(here), ...(card.advFor ? card.advFor(here) : [])].map((row) => [row.id, row]));
  }, [ctx, card, entry, listId]);
  const back = (
    <button type="button" className="tlBack" onClick={onBack}>
      <Icon name="arrowLeft" size={14} />
      Back to <b>what it guards</b>
    </button>
  );
  if (!entry)
    return (
      <div className="cxPage">
        {back}
        <p className="apNone">This {page.word} isn’t in the draft any more.</p>
      </div>
    );
  const config = ctx.config;
  const applies = (id) => {
    const row = rows[id];
    if (!row || !isShown(row, ctx)) return false;
    return !(typeof row.disabled === 'function' ? row.disabled(config) : row.disabled === true);
  };
  const item = entry.item || {};
  const isRule = listId === 'rules';
  const check = isRule ? null : checksIn(config, unsupported).find((c) => c.list === listId && c.index === entry.base.at(-1));
  const rule = isRule ? ownRules(config).find((r) => r.index === entry.base.at(-1)) : null;
  const shownSections = page.sections.filter((s) => s.ids.some(applies));

  // the top: its name, where it acts, and what really happens to it
  const info = isRule
    ? {
        icon: 'shield',
        title: rule?.name || entry.name,
        sub: 'A rule of its own · it acts whatever the model decides',
        pill: notRun.escalation ? { tone: 'warn', words: 'Not run yet' } : null,
        note: notRun.escalation
          ? 'The server keeps this rule but doesn’t act on it yet: no caller is passed on or cut off by it. Meanwhile, say it in the instructions.'
          : '',
      }
    : {
        icon: KINDS[item.type]?.icon || 'shield',
        title: check?.name || entry.name,
        sub: `${KINDS[item.type] && KINDS[item.type].name !== check?.name ? `${KINDS[item.type].name} · ` : ''}${
          listId === 'input' ? `on what callers say, checked before ${name} hears it` : `on what ${name} says, checked before it is said`
        }`.replace(/^o/, 'O'),
        pill:
          check?.how === 'kept'
            ? { tone: 'warn', words: 'Not run yet' }
            : check?.how === 'told'
              ? { tone: '', words: `Told to ${name}` }
              : { tone: 'good', words: 'Runs' },
        note:
          check?.how === 'kept'
            ? 'The server keeps this check but doesn’t act on it yet: only a rule in words is acted on in what the agent says. Say it in a rule in words meanwhile.'
            : '',
      };
  // a fact that matters about its kind, under the step it is about
  const facts =
    {
      pii_detect: { finds: 'A personal-details check always hides what it finds in the log, whatever it does.' },
      prompt_injection: {
        looks: 'It knows the common English phrasings, not a determined attacker or other languages: add your own with a blocked-words check.',
      },
      regex_block: {
        looks: 'Patterns ignore case; when several checks match, the strongest action wins (ending the call, then blocking, declining, rewriting, hiding).',
      },
    }[item.type] || {};
  const stepWords = isRule
    ? { when: rule?.when || 'not said yet', then: rule?.then || 'does nothing yet', says: textOf(item.say) ? `“${clip(textOf(item.say), 40)}”` : 'nothing' }
    : { looks: looksFor(item), finds: doesWhat(item).toLowerCase(), how: ENFORCED[item.enforcement] || 'not set yet' };
  const s = { open, setOpen, rows, ctx, partId: 'guardrails' };
  const go = (key) => {
    setLit(key);
    reveal(sections.current[key]);
  };
  // once it is gone, back to the list (a deletion called off stays here)
  const remove = () =>
    deleteWithUndo(ctx, page.word, entry.name, async (c) => {
      let gone = false;
      await card.remove(
        {
          ...c,
          set: (next) => {
            gone = true;
            c.set(next);
          },
        },
        entry,
      );
      if (gone) onBack();
    });

  return (
    <div className="cxPage">
      <div className="tlPageBar">
        {back}
        <Button type="button" variant="secondary" size="small" onClick={remove}>
          Delete this {page.word}
        </Button>
      </div>
      <header className="tlPageHead">
        <span className="tlPageIcon" aria-hidden="true">
          <Icon name={info.icon} size={20} />
        </span>
        <div className="tlPageName">
          <h2>{info.title}</h2>
          <p>{info.sub}</p>
        </div>
        {info.pill && <span className={`tlPill ${info.pill.tone}`}>{info.pill.words}</span>}
      </header>
      {(check?.gap || rule?.gap) && (
        <p className="cxNote grBad" role="note">
          <Icon name="alert" size={14} />
          {check?.gap || rule?.gap}
        </p>
      )}
      {info.note && (
        <p className="cxNote grWarn">
          <Icon name="info" size={14} />
          {info.note}
        </p>
      )}
      {shownSections.length > 1 && (
        <ol className={`tlSteps grPath n${shownSections.length}`} aria-label={`The path of the ${page.word}`}>
          {shownSections.map((section, i) => (
            <li key={section.key}>
              <button type="button" className={`tlStep ${lit === section.key ? 'on' : ''}`} onClick={() => go(section.key)}>
                <span className="tlStepN" aria-hidden="true">
                  {i + 1}
                </span>
                <b>{section.title}</b>
                <small>{stepWords[section.key]}</small>
              </button>
            </li>
          ))}
        </ol>
      )}
      {shownSections.map((section, i) => {
        const ids = section.ids.filter(applies);
        return (
          <section
            key={section.key}
            ref={(el) => {
              sections.current[section.key] = el;
            }}
            className={`tlSection ${lit === section.key ? 'lit' : ''} ${hasProblem(ids, rows, ctx) ? 'bad' : ''}`}
            aria-labelledby={`gr-sec-${section.key}`}
          >
            <div className="tlSectionHead">
              {shownSections.length > 1 && (
                <span className="tlStepN" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              <h3 id={`gr-sec-${section.key}`}>{section.title}</h3>
              {section.sub && <span className="apChSub">{section.sub}</span>}
            </div>
            <Rows ids={ids} rows={rows} ctx={ctx} partId="guardrails" />
            {facts[section.key] && <p className="apHint grFact">{facts[section.key]}</p>}
          </section>
        );
      })}
      <More s={s} k="itemMore" ids={page.more.filter(applies)} />
    </div>
  );
}
