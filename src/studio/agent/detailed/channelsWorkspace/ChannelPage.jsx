import React, { useMemo, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Switch } from '../../../form/fields.jsx';
import { deleteWithUndo, isShown } from '../Detailed.jsx';
import { More, Rows, hasProblem } from '../workspaceKit.jsx';
import { WeekStrip } from './ChannelPictures.jsx';
import { PAGES } from './channelsLayout.js';
import { schedulesOf, waysOf } from './channelsWords.js';

// A way in, or a set of hours, on a page of its own (canvas boards H3 and H5). Its sections hold the item card's own
// rows for it (the same controls as All settings); a row its kind doesn't have is simply not there, and the rarer ones
// are under "more". A way in has its On switch at the top, and what doesn't fit it first, with the fix.

export default function ChannelPage({ ctx, form, listId, itemKey, onBack }) {
  const [open, setOpen] = useState(null);
  const page = PAGES[listId];
  const card = useMemo(() => form.cols.flat().find((c) => c.of === listId), [form, listId]);
  const entry = ctx.items(listId).find((e) => e.key === itemKey) || null;
  const rows = useMemo(() => {
    if (!entry || !card) return {};
    const here = { ...ctx, chosen: (id) => (id === listId ? entry : ctx.chosen(id)) };
    return Object.fromEntries([...card.rowsFor(here), ...card.advFor(here)].map((row) => [row.id, row]));
  }, [ctx, card, entry, listId]);
  const back = (
    <button type="button" className="tlBack" onClick={onBack}>
      <Icon name="arrowLeft" size={14} />
      Back to <b>how people reach it</b>
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
    return !(typeof row.disabled === 'function' && row.disabled(config));
  };
  const way = listId === 'channels' ? waysOf(config, ctx.channelTypes).find((w) => w.key === entry.key) : null;
  const hours = listId === 'schedules' ? schedulesOf(config).find((x) => x.key === entry.key) : null;
  const info = way
    ? { icon: way.icon, name: way.name, sub: ctx.channelTypes?.find?.((t) => t.type === way.type)?.note || '', state: way.state }
    : {
        icon: 'clock',
        name: hours?.name || entry.name,
        sub: hours?.users.length ? `Used by ${hours.users.join(' and ')}` : 'Nothing reads these hours yet: a transfer or a step that checks them would',
        state: null,
      };
  const onRow = page.switch && rows[page.switch];
  const more = [...page.more, ...(page.morePrefix ? Object.keys(rows).filter((id) => id.startsWith(page.morePrefix)) : [])].filter(applies);
  const s = { open, setOpen, rows, ctx, partId: 'channels' };
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
        <span className="chPageActs">
          {onRow && (
            <label className="apSwitch">
              On
              <Switch checked={onRow.get(config) !== false} label="This way in is on" onChange={(on) => ctx.set(onRow.put(config, on))} />
            </label>
          )}
          <Button type="button" variant="secondary" size="small" onClick={remove}>
            Delete {listId === 'channels' ? 'this way in' : 'these hours'}
          </Button>
        </span>
      </div>
      <header className="tlPageHead">
        <span className="tlPageIcon" aria-hidden="true">
          <Icon name={info.icon} size={20} />
        </span>
        <div className="tlPageName">
          <h2>{info.name}</h2>
          {info.sub && <p>{info.sub}</p>}
        </div>
        {info.state && <span className={`tlPill ${info.state.tone}`}>{info.state.words}</span>}
        {hours && hours.open !== null && <span className={`chNow ${hours.open ? '' : 'closed'}`}>{hours.open ? 'Open now' : 'Closed now'}</span>}
      </header>
      {hours && <WeekStrip schedule={hours} />}
      {page.sections.map((section) => {
        const ids = section.ids.filter(applies);
        if (!ids.length) return null;
        return (
          <section
            key={section.key}
            className={`tlSection ${section.key === 'fit' ? 'chFit' : ''} ${hasProblem(ids, rows, ctx) ? 'bad' : ''}`}
            aria-labelledby={`ch-sec-${section.key}`}
          >
            <div className="tlSectionHead">
              <h3 id={`ch-sec-${section.key}`}>{section.title}</h3>
              {section.sub && <span className="apChSub">{section.sub}</span>}
            </div>
            <Rows ids={ids} rows={rows} ctx={ctx} partId="channels" />
          </section>
        );
      })}
      <More s={s} k="itemMore" ids={more} />
    </div>
  );
}
