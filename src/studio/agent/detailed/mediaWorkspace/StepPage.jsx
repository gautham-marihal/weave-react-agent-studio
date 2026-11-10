import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { DEMO_GRADE } from '../../../pictures/pictureSteps.js';
import { deleteWithUndo, isShown } from '../Detailed.jsx';
import { More, Rows, hasProblem, reveal } from '../workspaceKit.jsx';
import { PAGES } from './mediaLayout.js';
import { stepsIn, timeWords } from './mediaWords.js';
import { addSecondReading } from './pictureRecipes.js';
import { lineOf } from '../../../form/speechLine.js';

// A picture step on a page of its own (canvas boards M3, M4, M5): its sections in steps (what they see, the check in
// code, if nothing comes, where it goes; or what it reads, the details, who reads it; or the pairs, when it passes, try
// it), each with the step card's own rows (the same controls as All settings). A reading says plainly what a model
// reading a photo can't do, and offers a second reading to double-check it.

// a line's words, a fixed line's too
const speech = (v, config) => lineOf(config, v).text;
const clip = (t, n = 40) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export default function StepPage({ ctx, form, listId, itemKey, onBack, onOpen }) {
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
    return Object.fromEntries([...card.rowsFor(here), ...(card.advFor ? card.advFor(here) : [])].map((row) => [row.id, row]));
  }, [ctx, card, entry, listId]);
  const back = (
    <button type="button" className="tlBack" onClick={onBack}>
      <Icon name="arrowLeft" size={14} />
      Back to <b>its pictures</b>
    </button>
  );
  if (!entry)
    return (
      <div className="cxPage">
        {back}
        <p className="apNone">This step isn’t in the draft any more.</p>
      </div>
    );
  const config = ctx.config;
  const step = stepsIn(config).find((s) => s.key === itemKey);
  const item = entry.item || {};
  const applies = (id) => !!rows[id] && isShown(rows[id], ctx);
  const shown = page.sections.filter((s) => s.ids.some(applies));
  const words = {
    sees: speech(item.prompt, config) ? `“${clip(speech(item.prompt, config))}”` : item.kind === 'camera' ? 'their camera' : 'an upload button',
    check: step?.pickyWord
      ? `${step.pickyWord}${typeof item.quality?.min_sharpness === 'number' ? ` · sharpness ${item.quality.min_sharpness}` : ''}`
      : 'not checked',
    none: `after ${timeWords(typeof item.timeout_s === 'number' ? item.timeout_s : 120)}: ${Array.isArray(item.on_timeout) && item.on_timeout.length ? 'its own steps' : 'it goes on'}`,
    goes: item.into || 'nowhere yet',
    what: Array.isArray(item.images) && item.images.length ? item.images.join(', ') : 'no picture yet',
    details: step?.words || '',
    who: `${item.model?.model || 'as the agent'} · ${timeWords(typeof item.timeout_s === 'number' ? item.timeout_s : 45)}`,
    pairs: step?.words || '',
    passes: item.require === 'any' ? 'any one matches' : 'every pair matches',
    try: 'with the server’s rules',
    which: step?.words || '',
  };
  const s = { open, setOpen, rows, ctx, partId: 'media' };
  const go = (key) => {
    setLit(key);
    reveal(sections.current[key]);
  };
  const remove = () =>
    deleteWithUndo(ctx, 'step', step?.name || entry.name, async (c) => {
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
  const second = () => {
    const made = addSecondReading(config, entry.base);
    if (!made.path) return;
    ctx.set(made.config);
    onOpen('reads', made.path.join('.'));
  };

  return (
    <div className="cxPage">
      <div className="tlPageBar">
        {back}
        <Button type="button" variant="secondary" size="small" onClick={remove}>
          Delete this step
        </Button>
      </div>
      <header className="tlPageHead">
        <span className="tlPageIcon" aria-hidden="true">
          <Icon name={step?.icon || 'image'} size={20} />
        </span>
        <div className="tlPageName">
          <h2>{step?.name || entry.name}</h2>
          <p>
            Step {step?.at} of {step?.group.name}
            {item.type === 'request_image' && item.into ? ` · the picture goes into ${item.into}` : ''}
          </p>
        </div>
        <span className="tlPill good">Runs</span>
      </header>
      {step?.gap && (
        <p className="cxNote grBad" role="note">
          <Icon name="alert" size={14} />
          {step.gap}
        </p>
      )}
      {item.type === 'analyze_image' && (
        <p className="cxNote grWarn" role="note">
          <Icon name="info" size={14} />
          {DEMO_GRADE}
        </p>
      )}
      {shown.length > 1 && (
        <ol className={`tlSteps grPath n${shown.length}`} aria-label="The parts of the step">
          {shown.map((section, i) => (
            <li key={section.key}>
              <button type="button" className={`tlStep ${lit === section.key ? 'on' : ''}`} onClick={() => go(section.key)}>
                <span className="tlStepN" aria-hidden="true">
                  {i + 1}
                </span>
                <b>{section.title}</b>
                <small>{words[section.key]}</small>
              </button>
            </li>
          ))}
        </ol>
      )}
      {shown.map((section, i) => {
        const ids = section.ids.filter(applies);
        return (
          <section
            key={section.key}
            ref={(el) => {
              sections.current[section.key] = el;
            }}
            className={`tlSection ${lit === section.key ? 'lit' : ''} ${hasProblem(ids, rows, ctx) ? 'bad' : ''}`}
            aria-labelledby={`md-sec-${section.key}`}
          >
            <div className="tlSectionHead">
              {shown.length > 1 && (
                <span className="tlStepN" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              <h3 id={`md-sec-${section.key}`}>{section.title}</h3>
            </div>
            <Rows ids={ids} rows={rows} ctx={ctx} partId="media" />
            {section.key === 'who' && (
              <div className="mdSecond">
                <div>
                  <b>Double-check with a second reading</b>
                  <p className="apHint">
                    Adds a second reading of the same picture and a comparison of the two, so a confident misread is caught. Choose another model for the second
                    one on its page.
                  </p>
                </div>
                <Button type="button" variant="secondary" size="small" onClick={second}>
                  <Icon name="plus" size={14} />
                  Add a second reading
                </Button>
              </div>
            )}
          </section>
        );
      })}
      <More s={s} k="itemMore" ids={page.more.filter(applies)} />
    </div>
  );
}
