import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { TYPE_LABELS } from '../../../form/presets.js';
import { replaceRoute, routeHref, useRoute } from '../../../route.js';
import { AllSettings, Line, Popover, Rows, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import { useAddChoices } from '../AddItem.jsx';
import ChannelPage from './ChannelPage.jsx';
import { Doors, WeekStrip } from './ChannelPictures.jsx';
import { PAGES, TOKENS } from './channelsLayout.js';
import { WAYS, callerOf, carriesWords, schedulesOf, sentenceOf, summaryLine, waysOf } from './channelsWords.js';
import './channelsWorkspace.css';

// Build › Channels as how people reach the agent (design: canvas page "6 · Channels, redesigned"), for any agent. A
// sentence says the ways in that are on (the working ones that aren't are grey blanks after "Not yet:"), when its team
// is in, and how it knows who is calling; under it, a door for each way in and the week of its hours. Then three
// chapters: ways in, when your team is in, who is calling. A way in and a set of hours each open on a page of their own
// (ChannelPage). All settings: every setting, searchable. Every view edits with the part's own rows (channelsForm).

const VIEWS = makeViewStore('weave_channels_view', 'overview');
const FIRST = ['overview', 'How people reach it'];
const LABEL = 'How to see the channels';

const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

function joined(nodes, last = 'and') {
  return nodes.map((node, i) => (
    <React.Fragment key={i}>
      {i > 0 && (i === nodes.length - 1 ? ` ${last} ` : ', ')}
      {node}
    </React.Fragment>
  ));
}

// "Add a way in": each kind, by how people reach it; one not connected to the runtime yet says so
function WayKinds({ ctx, onAdded }) {
  const choices = useAddChoices({ ctx, path: ['channels'], pickerKey: 'channels', word: 'channel', onAdded });
  if (!choices) return null;
  return (
    <div className="tlKindsWrap">
      <div className="tlKinds" role="group" aria-label="How should people reach it?">
        {choices.options.map((option) => (
          <button key={option.id} type="button" className={`tlKind ${option.unavailable ? 'later' : ''}`} onClick={() => choices.pick(option)}>
            <span className="tlKindIcon" aria-hidden="true">
              <Icon name={option.icon || 'chat'} size={16} />
            </span>
            <b>{option.label}</b>
            <small>{option.unavailable ? 'Kept in the file, but nothing connects it to the runtime yet.' : option.help}</small>
          </button>
        ))}
      </div>
      <p className="apHint">Each starts ready, with its own first words and what its kind carries.</p>
    </div>
  );
}

function Overview({ ctx, form, view }) {
  const rows = useMemo(() => rowsOf(form), [form]);
  const route = useRoute();
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  // a way in or a set of hours open on its own page: from the address (?item=list:key), so a link or a reload opens it
  // (and follows it: going to the plain address, from the menu say, closes the page)
  const itemParam = String(route.params?.item || '');
  const fromParam = (param) => {
    const [list, ...key] = param.split(':');
    return PAGES[list] && key.length ? { list, key: key.join(':') } : null;
  };
  const [item, setItem] = useState(() => fromParam(itemParam));
  const [seen, setSeen] = useState(itemParam);
  if (itemParam !== seen) {
    setSeen(itemParam);
    setItem(fromParam(itemParam));
  }
  const config = ctx.config;
  const types = ctx.channelTypes;
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const ways = waysOf(config, types);
  const schedules = schedulesOf(config);
  const caller = callerOf(config);
  const said = sentenceOf(config, types);

  const openItem = (list, key) => {
    setOpen(null);
    ctx.choose(list, key);
    setItem({ list, key });
    requestAnimationFrame(() => reveal(document.querySelector('.cxPage')));
  };
  const back = () => {
    setItem(null);
    if (route.view === 'bot') replaceRoute(routeHref(route.botId, route.tab, { ...route.params, item: undefined }));
  };
  const openLine = (line) => {
    setOpen({ line });
    requestAnimationFrame(() => reveal(document.querySelector(`.chWrap [data-line="${line}"]`)));
  };
  const openToken = (k) => {
    setOpen({ token: k });
    reveal(hero.current);
  };
  const addHours = () => {
    const made = form.cols
      .flat()
      .find((c) => c.of === 'schedules')
      ?.list?.add?.(config);
    if (!made) return;
    ctx.set(made.config);
    openItem('schedules', made.key);
  };

  if (item)
    return (
      <section className="dtPart apWrap chWrap" data-part="channels" aria-label="Channels">
        <ChannelPage ctx={ctx} form={form} listId={item.list} itemKey={item.key} onBack={back} />
      </section>
    );

  const tok = (k, words, blank = false) => (
    <button
      key={k}
      type="button"
      ref={(el) => {
        anchors.current[k] = el;
      }}
      className={['apTok', blank && 'blank optional', open?.token === k && 'on'].filter(Boolean).join(' ')}
      aria-expanded={open?.token === k}
      aria-haspopup="dialog"
      onClick={() => (open?.token === k ? close() : openToken(k))}
    >
      {blank ? TOKENS[k].blank : words}
      <span className="srOnly"> ({TOKENS[k].title}: change)</span>
    </button>
  );
  const s = { open, setOpen, openToken, close, rows, ctx, filled: {}, anchors, tokens: TOKENS, partId: 'channels' };
  // chatting and talking on the website said once: "chatting and talking on your website"
  const both = said.on.some((w) => w.type === 'web_chat') && said.on.some((w) => w.type === 'web_voice');
  const wordsOf = (w) => (both && w.type === 'web_chat' ? 'chatting' : w.words);
  const onParts = [
    ...said.on.map((w) => tok(w.type, wordsOf(w))),
    ...(said.others.length ? [<b key="others">{said.others.length === 1 ? 'one more way' : `${said.others.length} more ways`}</b>] : []),
  ];
  const offParts = said.off.map((w) => tok(w.type, '', true));
  const firstHours = schedules[0];

  return (
    <section className="dtPart apWrap chWrap" data-part="channels" aria-labelledby="dt-channels-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-channels-title">Channels</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero chHero" aria-label="How people reach it">
        <div className="apId">
          <span className="apAvatar chAvatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>How people reach {name}</h2>
            <p>{summaryLine(config, types)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={() => openLine('add')}>
              <Icon name="plus" size={14} />
              Add a way in
            </Button>
          </div>
        </div>
        <p className="apSentence chSentence">
          {onParts.length ? (
            <>
              People reach {name} by {joined(onParts)}.
            </>
          ) : (
            <>Nobody can reach {name} yet.</>
          )}
          {offParts.length > 0 && <> Not yet: {joined(offParts, 'or')}.</>}{' '}
          {said.hours ? <>Its team is in {tok('hours', said.hours)}</> : <>Its team’s hours: {tok('hours', '', true)}</>}
          {caller.set ? <>, and it knows callers by {tok('who', caller.words)}.</> : <>. How it knows who is calling: {tok('who', '', true)}.</>}
        </p>
        <p className="apHint">Click any part to change it.</p>
        <Doors ways={ways} onWay={(w) => openItem('channels', w.key)} onMissing={(type) => openToken(type)} />
        {firstHours ? (
          <WeekStrip schedule={firstHours} more={schedules.length - 1} onOpen={() => openItem('schedules', firstHours.key)} />
        ) : (
          <button type="button" className="chNoHours" onClick={addHours}>
            <Icon name="clock" size={15} />
            <span>No hours yet: a hand-over passes callers on at any time.</span>
            <span className="chNoHoursAdd">
              <Icon name="plus" size={13} />
              Add hours
            </span>
          </button>
        )}
        {open?.token && (
          <Popover
            key={open.token}
            anchor={anchors.current[open.token]}
            box={hero}
            title={TOKENS[open.token].title}
            onClose={close}
            width={TOKENS[open.token].width}
          >
            {open.token === 'hours' ? (
              <div className="cxTokenList">
                {schedules.length ? (
                  <ul className="cxUses">
                    {schedules.map((x) => (
                      <li key={x.key}>
                        <span className="cxIcon" aria-hidden="true">
                          <Icon name="clock" size={14} />
                        </span>
                        <span className="cxText">
                          <b>{x.name}</b>
                          <small>{x.week}</small>
                        </span>
                        <Button type="button" variant="quiet" size="small" onClick={() => openItem('schedules', x.key)}>
                          Open
                          <span className="srOnly"> {x.name}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="apNone">None yet.</p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    close();
                    addHours();
                  }}
                >
                  <Icon name="plus" size={14} />
                  Add hours
                </Button>
                <p className="cxNote">
                  <Icon name="info" size={14} />
                  Hours don’t close a way in: a hand-over passes callers on only while they are open, and a step can check them.
                </p>
              </div>
            ) : (
              <>
                <Rows ids={TOKENS[open.token].ids} rows={rows} ctx={ctx} partId="channels" />
                {WAYS.some((w) => w.type === open.token) && (
                  <p className="cxNote">
                    <Icon name="info" size={14} />
                    Switched on, a way in is made ready (with speech models if it needs them and has none). A phone number is added when the agent goes live,
                    under Releases › Deploy.
                  </p>
                )}
              </>
            )}
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="ch-ways">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="ch-ways">Ways in</h2>
          <span className="apChSub">Each says its own first words, and carries what its kind allows</span>
        </div>
        <div className="apDoc lines">
          {[...ways]
            .sort((a, b) => (a.state.tone === 'bad' ? 0 : 1) - (b.state.tone === 'bad' ? 0 : 1))
            .map((w) => (
              <Line
                key={w.key}
                s={s}
                k={`way:${w.key}`}
                icon={w.icon}
                label={w.name}
                action={w.state.tone === 'bad' ? 'Fix' : 'Open'}
                onAction={() => openItem('channels', w.key)}
                muted={!w.on}
              >
                {w.state.why || carriesWords(w) || 'carries nothing yet'}
                <span className={`tlPill ${w.state.tone}`}>{w.state.words}</span>
              </Line>
            ))}
          {said.off.map((w) => (
            <Line key={w.type} s={s} k={`off:${w.type}`} icon={w.icon} label={TYPE_LABELS[w.type]} token={w.type} action="Switch on" muted>
              Off
              <span className="apDim">
                {' '}
                · {w.type === 'sip_voice' ? 'switch it on, then add a number when it goes live' : 'switch it on and it is made ready'}
              </span>
            </Line>
          ))}
          <Line s={s} k="add" icon="plus" label="Add a way in" action="Add" muted below={<WayKinds ctx={ctx} onAdded={(key) => openItem('channels', key)} />}>
            WhatsApp, SMS, email or your own: kept, not connected yet
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="ch-hours">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="ch-hours">When your team is in</h2>
          <span className="apChSub">Read by a hand-over that passes callers on only while open, and by any step that checks the hours</span>
        </div>
        <div className="apDoc lines">
          {schedules.map((x) => (
            <Line key={x.key} s={s} k={`hours:${x.key}`} icon="clock" label={x.name} action="Open" onAction={() => openItem('schedules', x.key)}>
              {x.week}
              <span className="apDim">
                {x.timezone ? ` · ${x.timezone}` : ''}
                {` · ${x.users.length ? `used by ${x.users.length}` : 'not used yet'}`}
              </span>
              {x.open !== null && <span className={`chNow ${x.open ? '' : 'closed'}`}>{x.open ? 'Open now' : 'Closed now'}</span>}
            </Line>
          ))}
          <Line s={s} k="addHours" icon="plus" label="Add hours" action="Add" muted onAction={addHours}>
            {schedules.length ? 'another set, such as a weekend line' : 'none yet · starts as Monday to Friday, 9 to 5, in the agent’s time zone'}
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="ch-who">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="ch-who">Who is calling</h2>
          <span className="apChSub">How it knows the caller’s number, so tools can look them up</span>
        </div>
        <div className="apDoc lines">
          <Line s={s} k="sources" icon="user" label="Where the number comes from" token="who" muted={!caller.set}>
            {caller.set ? caller.sources[0].replace(/^./, (c) => c.toUpperCase()) : 'Not set'}
            {caller.sources.length > 1 && <span className="apDim"> · then {caller.sources.slice(1).join(', then ')} · tried in order</span>}
          </Line>
          <Line s={s} k="tidy" icon="user" label="Tidy the number" token="who" muted={!caller.tidy}>
            {caller.tidy === 'e164' ? 'International format' : caller.tidy === 'none' ? 'Left as it is' : 'Not set'}
            {caller.tidy === 'e164' && caller.country && <span className="apDim"> · {caller.country} when no country is given</span>}
          </Line>
        </div>
        <p className="apHint chWhoHint">A chat has no phone number: tools there ask the person instead.</p>
      </section>
    </section>
  );
}

export default function ChannelsWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the channels’ settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
