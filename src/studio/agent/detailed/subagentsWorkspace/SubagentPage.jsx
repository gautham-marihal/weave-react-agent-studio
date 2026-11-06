import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { deleteWithUndo, isShown } from '../Detailed.jsx';
import { More, Rows, hasProblem, reveal } from '../workspaceKit.jsx';
import { PAGES } from './subagentsLayout.js';
import { agentsIn, firstOf, handoversIn, transfersOut } from './subagentsWords.js';

// An agent, a hand-over, or a hand-over to another agent, on a page of its own (canvas boards S3, S4, S5). Its
// sections hold the item card's own rows for it (the same controls as All settings), a row that doesn't apply is not
// there, and the rarer ones are under "more". An agent also has its way back (the back card's own row) and the list of
// who it passes callers to; a hand-over is the path of one: when, while it hands over, who takes over.

const clip = (t, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export default function SubagentPage({ ctx, form, listId, itemKey, onBack, onOpen }) {
  const [open, setOpen] = useState(null);
  const [lit, setLit] = useState(null);
  const sections = useRef({});
  const page = PAGES[listId];
  const cards = useMemo(() => Object.fromEntries(form.cols.flat().map((c) => [c.id, c])), [form]);
  const card = cards[page.card];
  const entry = ctx.items(listId).find((e) => e.key === itemKey) || null;
  const rows = useMemo(() => {
    if (!entry || !card) return {};
    const here = { ...ctx, chosen: (id) => (id === listId ? entry : ctx.chosen(id)) };
    const own = [...card.rowsFor(here), ...(card.advFor ? card.advFor(here) : [])];
    // an agent's way back is the back card's row for this agent
    const back = listId === 'agents' ? cards.back.rowsFor(here).filter((r) => r.id === 'back') : [];
    return Object.fromEntries([...own, ...back].map((row) => [row.id, row]));
  }, [ctx, card, cards, entry, listId]);
  const back = (
    <button type="button" className="tlBack" onClick={onBack}>
      <Icon name="arrowLeft" size={14} />
      Back to <b>who answers</b>
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
  const workspace = ctx.workspace;
  const agent = listId === 'agents' ? agentsIn(config).find((a) => a.key === entry.key) : null;
  const hand = listId === 'handoffs' ? handoversIn(config).find((h) => h.key === entry.key) : null;
  const out = listId === 'agentTransfers' ? transfersOut(config, workspace).find((t) => t.key === entry.key) : null;
  const passes = agent
    ? [
        ...handoversIn(config)
          .filter((h) => h.from === agent.key)
          .map((h) => ({ list: 'handoffs', key: h.key, name: h.toName, words: h.when ? `“${clip(h.when)}”` : 'no “when” yet', icon: 'subagent' })),
        ...transfersOut(config, workspace)
          .filter((t) => t.from === agent.key)
          .map((t) => ({
            list: t.to === 'agent' ? 'agentTransfers' : 'tools',
            key: t.key,
            name: t.toName,
            words: t.to === 'agent' ? 'another agent · its number' : 'set on Tools',
            icon: t.to === 'agent' ? 'phoneTransfer' : 'user',
          })),
      ]
    : [];
  const first = firstOf(config);
  const info = agent
    ? {
        icon: agent.first ? 'agent' : 'subagent',
        name: agent.name,
        sub: agent.first
          ? 'Answers first: it takes every new call'
          : `A subagent${
              handoversIn(config).some((h) => h.to === agent.key)
                ? ` · ${handoversIn(config)
                    .filter((h) => h.to === agent.key)
                    .map((h) => h.fromName)
                    .join(' and ')} passes callers to it`
                : ' · nothing passes callers to it yet'
            }`,
        state: agent.state,
      }
    : hand
      ? {
          icon: 'subagent',
          name: `${hand.fromName} → ${hand.toName}`,
          sub: `Inside this agent: the caller stays on the same call, and ${hand.toName} simply takes over`,
          state: hand.state,
        }
      : {
          icon: 'phoneTransfer',
          name: `${out?.fromName || ''} → ${out?.toName || entry.name}`,
          sub: 'Another agent of your workspace: the call is transferred to its number',
          state: null,
        };
  const steps = hand
    ? [
        { key: 'when', n: 1, title: 'When', words: hand.when ? `“${clip(hand.when, 50)}”` : 'not said yet' },
        { key: 'while', n: 2, title: 'While it hands over', words: hand.says ? `says “${clip(hand.says, 40)}”` : 'says nothing' },
        { key: 'who', n: 3, title: 'Who takes over', words: `${hand.toName}${hand.context ? ', knowing what was said' : ', starting afresh'}` },
      ]
    : [];
  const s = { open, setOpen, rows, ctx, partId: 'subagents' };
  const go = (key) => {
    setLit(key);
    reveal(sections.current[key]);
  };
  // once it is gone, back to the list (a deletion called off stays here)
  const remove = () =>
    deleteWithUndo(ctx, card.word, entry.name, async (c) => {
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
        {!(agent && entry.key === first) && (
          <Button type="button" variant="secondary" size="small" onClick={remove}>
            Delete this {page.word}
          </Button>
        )}
      </div>
      <header className="tlPageHead">
        <span className="tlPageIcon" aria-hidden="true">
          <Icon name={info.icon} size={20} />
        </span>
        <div className="tlPageName">
          <h2>{info.name}</h2>
          <p>{info.sub}</p>
        </div>
        {info.state && <span className={`tlPill ${info.state.tone}`}>{info.state.words}</span>}
      </header>
      {steps.length > 0 && (
        <ol className="tlSteps saPath" aria-label="The path of the hand-over">
          {steps.map((step) => (
            <li key={step.key}>
              <button type="button" className={`tlStep ${lit === step.key ? 'on' : ''}`} onClick={() => go(step.key)}>
                <span className="tlStepN" aria-hidden="true">
                  {step.n}
                </span>
                <b>{step.title}</b>
                <small>{step.words}</small>
              </button>
            </li>
          ))}
        </ol>
      )}
      {page.sections.map((section, i) => {
        const ids = section.ids.filter(applies);
        if (!ids.length && !section.passes) return null;
        if (section.passes && !passes.length && agent?.first === false) return null;
        return (
          <section
            key={section.key}
            ref={(el) => {
              sections.current[section.key] = el;
            }}
            className={`tlSection ${lit === section.key ? 'lit' : ''} ${hasProblem(ids, rows, ctx) ? 'bad' : ''}`}
            aria-labelledby={`sa-sec-${section.key}`}
          >
            <div className="tlSectionHead">
              {page.path && (
                <span className="tlStepN" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              <h3 id={`sa-sec-${section.key}`}>{section.title}</h3>
              {section.sub && <span className="apChSub">{section.sub}</span>}
            </div>
            {section.passes ? (
              passes.length ? (
                <ul className="cxUses">
                  {passes.map((p) => (
                    <li key={`${p.list}:${p.key}`}>
                      <span className="cxIcon" aria-hidden="true">
                        <Icon name={p.icon} size={14} />
                      </span>
                      <span className="cxText">
                        <b>{p.name}</b>
                        <small>{p.words}</small>
                      </span>
                      <Button type="button" variant="quiet" size="small" onClick={() => onOpen(p)}>
                        Open
                        <span className="srOnly"> {p.name}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="apNone">Nobody yet. Add a hand-over from it under Hand-overs.</p>
              )
            ) : (
              <Rows ids={ids} rows={rows} ctx={ctx} partId="subagents" />
            )}
          </section>
        );
      })}
      <More s={s} k="itemMore" ids={page.more.filter(applies)} />
    </div>
  );
}
