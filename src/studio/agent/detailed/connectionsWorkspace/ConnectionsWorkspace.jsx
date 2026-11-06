import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { navigate, replaceRoute, routeHref, useRoute } from '../../../route.js';
import { AllSettings, Line, Popover, ViewSwitch, reveal, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import { AddConnectionSteps } from '../parts/ConnectionsOverview.jsx';
import ItemPage from './ItemPage.jsx';
import ReachMap from './ReachMap.jsx';
import { PAGES, TOKENS } from './connectionsLayout.js';
import { formsOf, messagesOf, phoneSystemWords, sentenceOf, summaryLine, systemsOf, tasksOf, transfersOf } from './connectionsWords.js';
import './connectionsWorkspace.css';

// Build › Connections as what the agent reaches (design: canvas page "5 · Connections, redesigned"), for any agent and
// any use case. A sentence says what it reaches, where it passes callers on, and what it shows, sends and runs (what it
// has none of yet is a grey blank after "Not yet:"); under it, a picture of the agent, what reaches out and the systems
// it reaches. Then three chapters: systems, passing callers on, what it shows and sends. Each item opens on a page of its
// own (ItemPage). All settings: every setting, searchable. Every view edits with the part's own rows (connectionsForm).

const VIEWS = makeViewStore('weave_connections_view', 'overview');
const FIRST = ['overview', 'What it reaches'];
const LABEL = 'How to see the connections';
const MANY = 8;

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

// what each part of the sentence says when the agent has some, and the verb before it
const SAID = { sys: 'reaches', tr: 'passes callers on to', form: 'shows', msg: 'sends', task: 'runs' };
// the filters over many systems
const FILTERS = [
  { id: 'all', name: 'All', test: () => true },
  { id: 'http', name: 'Web API', test: (s) => s.type === 'http' },
  { id: 'notifier', name: 'Texts and emails', test: (s) => s.type === 'notifier' },
  { id: 'mcp', name: 'MCP', test: (s) => s.type === 'mcp' },
  { id: 'bad', name: 'Needs a look', test: (s) => s.state.tone === 'bad' },
];

function SystemLines({ s, systems, openItem }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [all, setAll] = useState(false);
  const many = systems.length > MANY;
  const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
  const q = query.trim().toLowerCase();
  // the ones that need a look first
  const sorted = [...systems].sort((a, b) => (a.state.tone === 'bad' ? 0 : 1) - (b.state.tone === 'bad' ? 0 : 1));
  const matching = sorted.filter((x) => f.test(x) && (!q || `${x.name} ${x.id} ${x.meta}`.toLowerCase().includes(q)));
  const shown = many && !all && !q && filter === 'all' ? matching.slice(0, MANY) : matching;
  return (
    <>
      {many && (
        <div className="cxFilters">
          <span className="rmFind">
            <Icon name="search" size={15} />
            <Input
              size="small"
              aria-label="Search the systems"
              placeholder={`Search ${systems.length} systems`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <div className="cvPills" role="group" aria-label="Show">
            {FILTERS.map((x) => {
              const n = systems.filter(x.test).length;
              if (!n && x.id !== 'all') return null;
              return (
                <button key={x.id} type="button" aria-pressed={filter === x.id} className={filter === x.id ? 'on' : ''} onClick={() => setFilter(x.id)}>
                  {x.name} {n}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {shown.map((x) => (
        <Line
          key={x.id}
          s={s}
          k={`sys:${x.id}`}
          icon={x.icon}
          label={x.name}
          action={x.state.tone === 'bad' ? 'Fix' : 'Open'}
          onAction={() => openItem('connections', x.id)}
        >
          {x.kind}
          <span className="apDim">
            {x.meta.replace(x.kind, '')}
            {` · ${x.users.length ? `used by ${x.users.length}` : 'not used yet'}`}
          </span>
          <span className={`tlPill ${x.state.tone}`}>{x.state.words}</span>
        </Line>
      ))}
      {many && shown.length < matching.length && (
        <p className="cxCount">
          {shown.length} of {matching.length} ·{' '}
          <button type="button" className="linkButton" onClick={() => setAll(true)}>
            Show all {matching.length}
          </button>
        </p>
      )}
      {(q || filter !== 'all') && !matching.length && <p className="apNone">No system matches.</p>}
    </>
  );
}

function Overview({ ctx, form, view }) {
  const route = useRoute();
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  // an item open on its own page: from the address (?item=list:key), so a link or a reload opens the same one
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
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const systems = systemsOf(config);
  const transfers = transfersOf(config);
  const shows = [...formsOf(config), ...messagesOf(config), ...tasksOf(config)];
  const said = sentenceOf(config);
  const cards = useMemo(() => Object.fromEntries(form.cols.flat().map((c) => [c.id, c])), [form]);
  // the phone system: one for the whole agent, set on the "Passing callers on" chapter
  const pbxRow = useMemo(
    () =>
      cards.transfers
        .advFor({ ...ctx, chosen: () => ({ key: '', name: '', base: ['telephony', 'transfers', 0], item: undefined }) })
        .find((r) => r.id === 'pbx'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards],
  );
  const rows = { 'transfers.pbx': pbxRow };

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
    requestAnimationFrame(() => reveal(document.querySelector(`.cxWrap [data-line="${line}"]`)));
  };
  // a thing that reaches out opens where it lives: a tool on Tools, a reaction on Conversation, a search service on
  // Knowledge, the rest here
  const openUser = (u) => {
    if (PAGES[u.list]) return openItem(u.list, u.key);
    const tab = { tools: 'tools', events: 'conversation', knowledge: 'knowledge' }[u.list];
    if (tab && route.botId) navigate(routeHref(route.botId, tab, u.list === 'tools' ? { item: `tools:${u.key}` } : {}));
  };
  const add = (list) => {
    const made = cards[list]?.list?.add?.(config);
    if (!made) return;
    ctx.set(made.config);
    openItem(list, made.key);
  };

  if (item)
    return (
      <section className="dtPart apWrap cxWrap" data-part="connections" aria-label="Connections">
        <ItemPage ctx={ctx} form={form} listId={item.list} itemKey={item.key} onBack={back} onOpen={openUser} />
      </section>
    );

  const s = { open, setOpen, openToken: (k) => setOpen({ token: k }), close, rows, ctx, filled: said.words, anchors, tokens: TOKENS, partId: 'connections' };
  const tok = (k, blank = false) => (
    <button
      key={k}
      type="button"
      ref={(el) => {
        anchors.current[k] = el;
      }}
      className={['apTok', blank && 'blank optional', open?.token === k && 'on'].filter(Boolean).join(' ')}
      aria-expanded={open?.token === k}
      aria-haspopup="dialog"
      onClick={() => setOpen(open?.token === k ? null : { token: k })}
    >
      {blank ? TOKENS[k].blank : said.words[k]}
      <span className="srOnly"> ({TOKENS[k].title}: change)</span>
    </button>
  );
  const has = Object.keys(SAID).filter((k) => said.words[k]);
  const missing = Object.keys(SAID).filter((k) => !said.words[k]);
  const itemsOf = (k) =>
    k === 'sys'
      ? systems.map((x) => ({ list: 'connections', id: x.id, name: x.name, icon: x.icon, detail: x.meta }))
      : k === 'tr'
        ? transfers.map((x) => ({ list: 'transfers', id: x.id, name: x.name, icon: x.icon, detail: `${x.how} · ${x.detail}` }))
        : shows.filter((x) => x.list === TOKENS[k].list).map((x) => ({ list: x.list, id: x.id, name: x.name, icon: x.icon, detail: x.detail }));
  const addFor = (k) => (k === 'sys' ? () => openLine('add') : () => add(TOKENS[k].list));
  const ADD_WORDS = { sys: 'Add a system', tr: 'Add a transfer', form: 'Add a form', msg: 'Add a message', task: 'Add a task' };
  const POINTER = {
    sys: 'A system is set up once, then used by as many tools, transfers, forms and messages as need it.',
    tr: 'A hand-over (a quick ability on Tools, or a step) takes the caller to one of these.',
    form: 'A form shows on a chat, and its answers come back to the agent; a tool on Tools shows it.',
    msg: 'A message is sent by a step (after a tool, a form, a transfer or the call), through a system that sends texts or emails.',
    task: 'A short exchange that ends in a result, such as checking who the caller is; a task tool on Tools starts it.',
  };

  return (
    <section className="dtPart apWrap cxWrap" data-part="connections" aria-labelledby="dt-connections-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-connections-title">Connections</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero cxHero" aria-label="What it reaches">
        <div className="apId">
          <span className="apAvatar cxAvatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>What {name} reaches</h2>
            <p>{summaryLine(config)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={() => openLine('add')}>
              <Icon name="plus" size={14} />
              Add a system
            </Button>
          </div>
        </div>
        <p className="apSentence cxSentence">
          {has.length ? (
            <>
              {name}{' '}
              {joined(
                has.map((k) => (
                  <React.Fragment key={k}>
                    {SAID[k]} {tok(k)}
                  </React.Fragment>
                )),
              )}
              .
            </>
          ) : (
            <>{name} reaches nothing outside the conversation yet.</>
          )}
          {missing.length > 0 && (
            <>
              {' '}
              Not yet:{' '}
              {joined(
                missing.map((k) => tok(k, true)),
                'or',
              )}
              .
            </>
          )}
        </p>
        <p className="apHint">Click any part to change it.</p>
        <ReachMap
          config={config}
          name={name}
          agentWords={(() => {
            const n = Array.isArray(config?.agents?.items) ? config.agents.items.length : 0;
            return n > 1 ? `${n} agents use these` : 'answers your callers';
          })()}
          onSystem={(id) => openItem('connections', id)}
          onUser={openUser}
          onAdd={() => openLine('add')}
          // a system nothing uses yet: Tools is where a tool can be given it
          onIdle={() => route.botId && navigate(routeHref(route.botId, 'tools'))}
        />
        {open?.token && (
          <Popover key={open.token} anchor={anchors.current[open.token]} box={hero} title={TOKENS[open.token].title} onClose={close} width={560}>
            <div className="cxTokenList">
              {itemsOf(open.token).length ? (
                <ul className="cxUses">
                  {itemsOf(open.token).map((x) => (
                    <li key={x.id}>
                      <span className="cxIcon" aria-hidden="true">
                        <Icon name={x.icon} size={14} />
                      </span>
                      <span className="cxText">
                        <b>{x.name}</b>
                        <small>{x.detail}</small>
                      </span>
                      <Button type="button" variant="quiet" size="small" onClick={() => openItem(x.list, x.id)}>
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
                  const go = addFor(open.token);
                  setOpen(null);
                  go();
                }}
              >
                <Icon name="plus" size={14} />
                {ADD_WORDS[open.token]}
              </Button>
              <p className="cxNote">
                <Icon name="info" size={14} />
                {POINTER[open.token]}
              </p>
            </div>
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="cx-sys">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="cx-sys">Systems it reaches</h2>
          <span className="apChSub">Set up once each, used by as many tools, forms and steps as need them</span>
        </div>
        <div className="apDoc lines">
          <SystemLines s={s} systems={systems} openItem={openItem} />
          <Line
            s={s}
            k="add"
            icon="plus"
            label="Add a system"
            action="Add"
            muted
            below={<AddConnectionSteps ctx={ctx} onClose={() => setOpen(null)} onAdded={(key) => openItem('connections', key)} />}
          >
            {systems.length ? '' : 'None yet · '}a web API, texts and emails, or an MCP server
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="cx-tr">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="cx-tr">Passing callers on</h2>
          <span className="apChSub">Where a hand-over takes the caller, and how it gets there</span>
        </div>
        <div className="apDoc lines">
          {transfers.map((t) => (
            <Line
              key={t.id}
              s={s}
              k={`tr:${t.id}`}
              icon={t.icon}
              label={t.name}
              action={t.state.tone === 'bad' ? 'Fix' : 'Open'}
              onAction={() => openItem('transfers', t.id)}
            >
              {t.how}
              <span className="apDim"> · {t.detail}</span>
              <span className={`tlPill ${t.state.tone}`}>{t.state.words}</span>
            </Line>
          ))}
          {pbxRow && (
            <Line s={s} k="pbx" icon="phone" label="Phone system" ids={['transfers.pbx']} muted={!phoneSystemWords(config)}>
              {phoneSystemWords(config) || 'Not set'}
              <span className="apDim"> · for transfers by phone (SIP), on phone calls</span>
            </Line>
          )}
          <Line s={s} k="addTr" icon="plus" label="Add a transfer" action="Add" muted onAction={() => add('transfers')}>
            {transfers.length ? '' : 'None yet · '}to a number by phone, or ask another system to move the call
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="cx-show">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="cx-show">What it shows and sends</h2>
          <span className="apChSub">Forms on a chat, texts and emails, and short exchanges that end in a result</span>
        </div>
        <div className="apDoc lines">
          {shows.map((x) => (
            <Line
              key={`${x.list}:${x.id}`}
              s={s}
              k={`${x.list}:${x.id}`}
              icon={x.icon}
              label={x.name}
              action={x.state ? 'Fix' : 'Open'}
              onAction={() => openItem(x.list, x.id)}
            >
              {x.what}
              <span className="apDim"> · {x.detail}</span>
              {x.state && <span className={`tlPill ${x.state.tone}`}>{x.state.words}</span>}
            </Line>
          ))}
          <Line
            s={s}
            k="addShow"
            icon="plus"
            label="Add one"
            action="Add"
            muted
            below={
              <div className="cxAddShow" role="group" aria-label="What to add">
                {[
                  ['forms', 'records', 'A form', 'Shown on a chat; its answers come back to the agent.'],
                  ['notifications', 'mail', 'A text or an email', 'Sent by a step, through a system that sends them.'],
                  ['tasks', 'list', 'A multi-step task', 'A short exchange that ends in a result, checked in code.'],
                ].map(([list, icon, title, help]) => (
                  <button key={list} type="button" className="tlKind" onClick={() => add(list)}>
                    <span className="tlKindIcon" aria-hidden="true">
                      <Icon name={icon} size={16} />
                    </span>
                    <b>{title}</b>
                    <small>{help}</small>
                  </button>
                ))}
              </div>
            }
          >
            {shows.length ? '' : 'None yet · '}a form to show, a text or email to send, or a multi-step task
          </Line>
        </div>
      </section>
    </section>
  );
}

export default function ConnectionsWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the connections’ settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
