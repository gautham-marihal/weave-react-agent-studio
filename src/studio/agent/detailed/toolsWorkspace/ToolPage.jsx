import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { deleteWithUndo } from '../Detailed.jsx';
import { More, Rows, hasProblem, reveal } from '../workspaceKit.jsx';
import { STEPS, TOOL_MORE } from './toolsLayout.js';
import { stepsOf, toolsOf } from './toolsWords.js';

// One tool on a page of its own (canvas board T3): the steps of one run across the top, each said in a few words, then
// each step with its settings (the part's own rows for this tool, from its tool card), and the rarer ones under "more".
// Only a tool that calls your system has an address, an answer to read and a wait: for the others those steps say what
// happens instead of showing settings that don't apply.

const HTTP_ONLY = ['connection', 'method', 'request', 'wait', 'sees', 'keeps', 'oob', 'fails', 'sample'];
const ELSE = {
  calls: 'It does this itself: there is no address to call.',
  back: 'What it returns goes to the model.',
  fails: 'If it can’t, the model is told why, and answers the caller.',
};
const SUB = { calls: (http) => (http ? '' : 'what the server does when it runs'), back: () => '', then: () => '' };

export default function ToolPage({ ctx, form, toolKey, onBack, onTry }) {
  const [open, setOpen] = useState(null);
  const [lit, setLit] = useState(null);
  const sections = useRef({});
  const entry = ctx.items('tools').find((e) => e.key === toolKey) || null;
  const card = useMemo(() => form.cols.flat().find((c) => c.id === 'tool'), [form]);
  // the tool card's rows for this tool (the same controls and places as in All settings)
  const rows = useMemo(() => {
    if (!entry) return {};
    const here = { ...ctx, chosen: (id) => (id === 'tools' ? entry : ctx.chosen(id)) };
    return Object.fromEntries([...card.rowsFor(here), ...card.advFor(here)].map((row) => [row.id, row]));
  }, [ctx, card, entry]);
  if (!entry)
    return (
      <div className="tlPage">
        <button type="button" className="tlBack" onClick={onBack}>
          <Icon name="arrowLeft" size={14} />
          Back to what it can do
        </button>
        <p className="apNone">This tool isn’t in the draft any more.</p>
      </div>
    );
  const tool = (Array.isArray(ctx.config.tools) ? ctx.config.tools : []).find((t) => t && t.id === entry.key) || entry.item || {};
  const info = toolsOf(ctx.config).find((t) => t.id === entry.key);
  const steps = stepsOf(ctx.config, entry.key);
  const http = tool.type === 'http';
  const s = { open, setOpen, rows, ctx, partId: 'tools' };
  const idsOf = (step) => step.ids.filter((id) => rows[id] && (http || !HTTP_ONLY.includes(id)));
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
    <div className="tlPage">
      <div className="tlPageBar">
        <button type="button" className="tlBack" onClick={onBack}>
          <Icon name="arrowLeft" size={14} />
          Back to <b>what it can do</b>
        </button>
        <Button type="button" variant="secondary" size="small" onClick={onTry}>
          <Icon name="play" size={13} />
          Try it
        </Button>
      </div>
      <header className="tlPageHead">
        <span className="tlPageIcon" aria-hidden="true">
          <Icon name={info?.icon || 'tools'} size={20} />
        </span>
        <div className="tlPageName">
          <h2>{info?.name || entry.name}</h2>
          <p>
            {info?.does}
            {info?.agents.length ? ` · used by ${info.agents.join(' and ')}` : ''}
            {info?.madeBy ? ` · made by “${info.madeBy}”` : ''}
          </p>
        </div>
        {info && <span className={`tlPill ${info.state.tone}`}>{info.state.words}</span>}
      </header>

      <ol className="tlSteps" aria-label="The steps of one run">
        {steps.map((step) => (
          <li key={step.key}>
            <button type="button" className={`tlStep ${lit === step.key ? 'on' : ''} ${step.fail ? 'fail' : ''}`} onClick={() => go(step.key)}>
              <span className="tlStepN" aria-hidden="true">
                {step.fail ? <Icon name="close" size={12} /> : step.n}
              </span>
              <b>{step.title}</b>
              <small>{step.words}</small>
            </button>
          </li>
        ))}
      </ol>

      {STEPS.map((layout, i) => {
        const step = steps[i];
        const ids = idsOf(layout);
        const sub = layout.sub ? (layout.key === 'fails' && !http ? '' : layout.sub) : SUB[layout.key]?.(http) || '';
        return (
          <section
            key={layout.key}
            ref={(el) => {
              sections.current[layout.key] = el;
            }}
            className={`tlSection ${lit === layout.key ? 'lit' : ''} ${hasProblem(ids, rows, ctx) ? 'bad' : ''}`}
            aria-labelledby={`tl-step-${layout.key}`}
          >
            <div className="tlSectionHead">
              <span className={`tlStepN ${step.fail ? 'fail' : ''}`} aria-hidden="true">
                {step.fail ? <Icon name="close" size={12} /> : step.n}
              </span>
              <h3 id={`tl-step-${layout.key}`}>{step.title}</h3>
              {sub && <span className="apChSub">{sub}</span>}
            </div>
            {ids.length ? (
              <Rows ids={ids} rows={rows} ctx={ctx} partId="tools" />
            ) : (
              <p className="apNone">{ELSE[layout.key] || 'Nothing to set here for this tool.'}</p>
            )}
          </section>
        );
      })}

      <More s={s} k="toolMore" ids={TOOL_MORE.filter((id) => rows[id])} />
      <div className="tlPageFoot">
        <Button type="button" variant="secondary" size="small" onClick={remove}>
          Delete this tool
        </Button>
      </div>
    </div>
  );
}
