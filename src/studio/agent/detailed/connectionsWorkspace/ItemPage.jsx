import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { deleteWithUndo, isShown } from '../Detailed.jsx';
import { More, Rows, hasProblem, reveal } from '../workspaceKit.jsx';
import { PAGES } from './connectionsLayout.js';
import { countSteps, stepsWords } from '../describe.js';
import { formsOf, messagesOf, phoneSystemWords, systemsOf, tasksOf, transferPath, transfersOf } from './connectionsWords.js';

// One item of Connections on a page of its own (canvas boards N3, N5, N6, N7): a system, a phone transfer (as the path
// of the call), a form (beside it, as the caller sees it), a message or a multi-step task. Its sections hold the list
// card's own rows for this item (the same controls as All settings); a row that doesn't apply to this item's kind is
// left out, and the rarer ones are under "more".

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// a long list of steps reads as one line until it is opened (a form's "when it is sent" can run to dozens)
const FOLD = ['sent', 'steps'];
// rows a transfer has only one way or the other: where to (by phone), the request (asking another system)
const ONLY = { target: (t) => t.method !== 'http_request', uri: (t) => t.method !== 'http_request', request: (t) => t.method === 'http_request' };

function infoOf(config, listId, key) {
  if (listId === 'connections') {
    const s = systemsOf(config).find((x) => x.id === key);
    return (
      s && {
        name: s.name,
        icon: s.icon,
        sub: `${s.kind}${s.users.length ? ` · used by ${s.users.length === 1 ? s.users[0].name : `${s.users.length}`}` : ' · not used yet'}`,
        state: s.state,
      }
    );
  }
  if (listId === 'transfers') {
    const t = transfersOf(config).find((x) => x.id === key);
    return t && { name: t.name, icon: t.icon, sub: `A phone transfer · ${t.how.toLowerCase()}`, state: t.state };
  }
  const all = { forms: formsOf, notifications: messagesOf, tasks: tasksOf }[listId](config);
  const it = all.find((x) => x.id === key);
  return it && { name: it.name, icon: it.icon, sub: `${it.what} · ${it.detail}`, state: it.state || null };
}

// a form as the caller sees it: its title, its questions and its button
function FormPreview({ form }) {
  const fields = list(form?.fields).filter(isObj);
  return (
    <div className="cxPreview" aria-label="As the caller sees it" role="img">
      <span className="cxPreviewHead">As the caller sees it</span>
      <div className="cxPreviewCard">
        <b>{form?.title || 'A form'}</b>
        {typeof form?.description === 'string' && form.description && <small>{form.description}</small>}
        {fields.slice(0, 8).map((f, i) => (
          <span key={`${f.name}-${i}`} className="cxField">
            {f.label || f.name}
            {f.required && <em> *</em>}
            <i className={f.type === 'textarea' ? 'tall' : ''} />
          </span>
        ))}
        {fields.length > 8 && <small>and {fields.length - 8} more questions</small>}
        {!fields.length && <small>No questions yet.</small>}
        <span className="cxSend">{form?.submit_label || 'Send'}</span>
      </div>
    </div>
  );
}

export default function ItemPage({ ctx, form, listId, itemKey, onBack, onOpen }) {
  const [open, setOpen] = useState(null);
  const [lit, setLit] = useState(null);
  const [unfolded, setUnfolded] = useState([]);
  const sections = useRef({});
  const page = PAGES[listId];
  const card = useMemo(() => form.cols.flat().find((c) => c.id === listId), [form, listId]);
  const entry = ctx.items(listId).find((e) => e.key === itemKey) || null;
  const rows = useMemo(() => {
    if (!entry || !card) return {};
    const here = { ...ctx, chosen: (id) => (id === listId ? entry : ctx.chosen(id)) };
    return Object.fromEntries([...card.rowsFor(here), ...card.advFor(here)].map((row) => [row.id, row]));
  }, [ctx, card, entry, listId]);
  if (!entry)
    return (
      <div className="cxPage">
        <button type="button" className="tlBack" onClick={onBack}>
          <Icon name="arrowLeft" size={14} />
          Back to <b>what it reaches</b>
        </button>
        <p className="apNone">This {page.word} isn’t in the draft any more.</p>
      </div>
    );
  const config = ctx.config;
  const item = isObj(entry.item) ? entry.item : {};
  const info = infoOf(config, listId, entry.key) || { name: entry.name, icon: 'plug', sub: '', state: null };
  // a row shows when it applies to this item (its kind, its way of transferring) and is not the agent-wide phone system
  const applies = (id) => {
    const row = rows[id];
    if (!row || !isShown(row, ctx)) return false;
    if (typeof row.disabled === 'function' && row.disabled(config)) return false;
    return listId !== 'transfers' || !ONLY[id] || ONLY[id](item);
  };
  const steps = page.path ? transferPath(config, entry.key) : [];
  const usedBy = listId === 'connections' ? systemsOf(config).find((x) => x.id === entry.key)?.users || [] : [];
  const s = { open, setOpen, rows, ctx, partId: 'connections' };
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

  const body = page.sections.map((section, i) => {
    const ids = section.ids.filter(applies);
    if (!ids.length && !section.uses) return null;
    const step = steps[i];
    const title = step ? step.title : section.title;
    const pbx = listId === 'transfers' && section.key === 'moves' && item.method === 'sip_refer';
    return (
      <section
        key={section.key}
        ref={(el) => {
          sections.current[section.key] = el;
        }}
        className={`tlSection ${lit === section.key ? 'lit' : ''} ${hasProblem(ids, rows, ctx) ? 'bad' : ''}`}
        aria-labelledby={`cx-sec-${section.key}`}
      >
        <div className="tlSectionHead">
          {step && (
            <span className={`tlStepN ${step.fail ? 'fail' : ''}`} aria-hidden="true">
              {step.fail ? <Icon name="close" size={12} /> : step.n}
            </span>
          )}
          <h3 id={`cx-sec-${section.key}`}>{title}</h3>
          {section.sub && <span className="apChSub">{section.sub}</span>}
        </div>
        {section.uses ? (
          usedBy.length ? (
            <ul className="cxUses">
              {usedBy.map((u) => (
                <li key={`${u.list}:${u.key}`}>
                  <span className="cxIcon" aria-hidden="true">
                    <Icon name={u.icon} size={14} />
                  </span>
                  <span className="cxText">
                    <b>{u.name}</b>
                    <small>{u.kind.charAt(0).toUpperCase() + u.kind.slice(1)}</small>
                  </span>
                  <Button type="button" variant="quiet" size="small" onClick={() => onOpen(u)}>
                    Open
                    <span className="srOnly"> {u.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="apNone">Nothing uses it yet. A tool, a transfer that asks another system, a form’s steps or a message reaches it by its name.</p>
          )
        ) : (
          ids.map((id) => {
            const value = rows[id].get ? rows[id].get(config) : undefined;
            if (FOLD.includes(id) && !unfolded.includes(id) && countSteps(value).top > 3)
              return (
                <div key={id} className="cxFold">
                  <span className="cxFoldLabel">{rows[id].label}</span>
                  <span className="cxFoldWords">{stepsWords(value)}</span>
                  <Button type="button" variant="secondary" size="small" onClick={() => setUnfolded([...unfolded, id])}>
                    Open the steps
                  </Button>
                </div>
              );
            return <Rows key={id} ids={[id]} rows={rows} ctx={ctx} partId="connections" />;
          })
        )}
        {pbx && (
          <p className="cxNote">
            <Icon name="phone" size={14} />
            By phone hands over the caller’s own line, through its phone system
            {phoneSystemWords(config) ? ` (${phoneSystemWords(config)})` : ', which isn’t set yet'}: change it under Passing callers on.
          </p>
        )}
        {listId === 'transfers' && section.key === 'moves' && item.method === 'http_request' && (
          <p className="cxNote">
            <Icon name="info" size={14} />
            Asking another system moves the conversation for it (into a queue, for example), so it works on web calls too.
          </p>
        )}
      </section>
    );
  });

  return (
    <div className="cxPage">
      <div className="tlPageBar">
        <button type="button" className="tlBack" onClick={onBack}>
          <Icon name="arrowLeft" size={14} />
          Back to <b>what it reaches</b>
        </button>
        <Button type="button" variant="secondary" size="small" onClick={remove}>
          Delete this {page.word}
        </Button>
      </div>
      <header className="tlPageHead">
        <span className="tlPageIcon cxPageIcon" aria-hidden="true">
          <Icon name={info.icon} size={20} />
        </span>
        <div className="tlPageName">
          <h2>{info.name}</h2>
          <p>{info.sub}</p>
        </div>
        {info.state && <span className={`tlPill ${info.state.tone}`}>{info.state.words}</span>}
      </header>
      {steps.length > 0 && (
        <ol className="tlSteps cxPath" aria-label="The path of the call">
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
      )}
      {page.preview ? (
        <div className="cxFormGrid">
          <FormPreview form={item} />
          <div className="cxStack">{body}</div>
        </div>
      ) : (
        body
      )}
      <More s={s} k="itemMore" ids={page.more.filter(applies)} />
    </div>
  );
}
