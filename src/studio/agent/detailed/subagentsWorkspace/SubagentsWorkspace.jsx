import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import Select from '../../../../ui/Select.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { readSimple } from '../../../simple/simpleModel.js';
import { replaceRoute, routeHref, useRoute } from '../../../route.js';
import { addAgentTransfer, addBackToStart, addSubagent, addTransferToAgent } from '../../../workflow/workflowOps.js';
import { withHandoffRules } from '../../../workflow/handoffRules.js';
import { isShown } from '../Detailed.jsx';
import { AllSettings, Line, Popover, Rows, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import RelayMap from './RelayMap.jsx';
import SubagentPage from './SubagentPage.jsx';
import { LIMITS, PAGES, TOKENS } from './subagentsLayout.js';
import { agentsIn, firstOf, handoversIn, rulesMissing, sentenceOf, summaryLine, together, transfersOut } from './subagentsWords.js';
import './subagentsWorkspace.css';

// Build › Subagents and hand-overs as who answers (design: canvas page "7 · Subagents and hand-overs, redesigned"),
// for any agent. A sentence says who answers first, who it passes callers to, how many can send them back, and who is
// beyond this agent; under it, the relay drawn from the configuration. Then three chapters: its agents, the hand-overs
// (and a line to try), and coming back with the limits. An agent, a hand-over and a hand-over to another agent each open
// on a page of their own (SubagentPage). All settings: every setting, searchable, with the strip of hand-overs that
// chooses its cards' item. Every view edits with the part's own rows (subagentsForm), on the same draft as the Workflow
// canvas.

const VIEWS = makeViewStore('weave_subagents_view', 'overview');
const FIRST = ['overview', 'Who answers'];
const LABEL = 'How to see the subagents';
const MANY = 6;

const list = (v) => (Array.isArray(v) ? v : []);
const initialsOf = (name) =>
  (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const quoted = (t, n = 70) => `“${clip(t, n)}”`;

// the workspace's other agents a call can be transferred to (they take calls on a number)
const reachable = (workspace) => list(workspace?.agents).filter((a) => list(a.numbers).length);

// "Add a hand-over": where the caller should go (canvas board S6), then who from and to
function AddKinds({ ctx, onOpen }) {
  const config = ctx.config;
  const agents = agentsIn(config);
  const first = firstOf(config);
  const subs = agents.filter((a) => !a.first);
  const others = reachable(ctx.workspace);
  const [kind, setKind] = useState(null);
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState('');
  const pick = (k) => {
    setKind(k);
    setFrom(k === 'back' ? subs.find((s) => !s.canGoBack)?.key || '' : first);
    setTo(k === 'sub' ? agents.find((a) => a.key !== first)?.key || '' : k === 'agent' ? others[0]?.id || '' : '');
  };
  const KINDS = [
    {
      id: 'sub',
      icon: 'subagent',
      name: 'To a subagent',
      help: subs.length
        ? 'Inside this agent: the caller stays on the call and another agent takes over.'
        : 'Inside this agent: a new subagent is made, and the caller stays on the call as it takes over.',
    },
    {
      id: 'back',
      icon: 'undo',
      name: 'Back to the first agent',
      help: subs.length
        ? 'For a subagent that has finished its part, so the caller is never stuck.'
        : 'Once there is a subagent: so a caller is never stuck with it.',
      later: !subs.length,
    },
    {
      id: 'agent',
      icon: 'phoneTransfer',
      name: 'To another agent',
      help: others.length
        ? 'A separate agent of your workspace, on its own number.'
        : 'A separate agent of your workspace, on its own number. None has a number yet: one gets it when it goes live.',
      later: !others.length,
    },
    { id: 'person', icon: 'user', name: 'To a person', help: 'A colleague on your team: set on Tools › Pass to a person.' },
  ];
  const go = (k) => {
    if (k.later) return;
    if (k.id === 'person') return ctx.goTools?.('');
    // with one agent, a hand-over to a subagent makes the subagent (with its hand-over from the first)
    if (k.id === 'sub' && !subs.length) {
      const made = addSubagent(config, first, { name: 'New subagent' });
      ctx.set(made.config);
      return onOpen('agents', made.id);
    }
    pick(k.id);
  };
  const add = () => {
    if (kind === 'sub') {
      const next = addAgentTransfer(config, from, to);
      ctx.set(next);
      const made = handoversIn(next)
        .filter((h) => h.from === from && h.to === to)
        .at(-1);
      if (made) onOpen('handoffs', made.key);
    } else if (kind === 'back') {
      ctx.set(addBackToStart(config, from).config);
      onOpen('agents', from);
    } else if (kind === 'agent') {
      const made = addTransferToAgent(
        config,
        from,
        others.find((a) => a.id === to),
      );
      if (!made.id) return;
      ctx.set(made.config);
      onOpen('agentTransfers', made.id.split('::tool::')[1]);
    }
  };
  const chosen = KINDS.find((k) => k.id === kind);
  const backable = subs.filter((s) => !s.canGoBack);
  return (
    <div className="tlKindsWrap">
      <div className="tlKinds saKinds" role="group" aria-label="Where should the caller go?">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`tlKind ${k.later ? 'later' : ''} ${kind === k.id ? 'on' : ''}`}
            aria-pressed={kind === k.id}
            aria-disabled={k.later || undefined}
            onClick={() => go(k)}
          >
            <span className="tlKindIcon" aria-hidden="true">
              <Icon name={k.icon} size={16} />
            </span>
            <b>{k.name}</b>
            <small>{k.help}</small>
          </button>
        ))}
      </div>
      {chosen && (
        <div className="saAddForm" role="group" aria-label={chosen.name}>
          <b>{chosen.name}</b>
          {kind === 'back' && !backable.length ? (
            <p className="apNone">Every subagent can already send callers back.</p>
          ) : (
            <div className="saAddRow">
              <Select
                className="stFInput"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                aria-label={kind === 'back' ? 'Which subagent' : 'From'}
              >
                {(kind === 'back' ? backable : agents).map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </Select>
              {kind !== 'back' && (
                <>
                  <Icon name="arrowRight" size={15} />
                  <Select className="stFInput" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To">
                    {kind === 'sub'
                      ? agents
                          .filter((a) => a.key !== from)
                          .map((a) => (
                            <option key={a.key} value={a.key}>
                              {a.name}
                            </option>
                          ))
                      : others.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} · {a.numbers[0].number}
                          </option>
                        ))}
                  </Select>
                </>
              )}
              <Button type="button" variant="primary" size="small" disabled={!from || (kind !== 'back' && (!to || to === from))} onClick={add}>
                Add
              </Button>
              <Button type="button" variant="quiet" size="small" onClick={() => setKind(null)}>
                Cancel
              </Button>
            </div>
          )}
          <p className="apHint">
            {kind === 'sub'
              ? 'Then say when, in a sentence the model reads. The hand-over rules are added for you.'
              : kind === 'back'
                ? 'It gets the built-in “Back to the first agent” tool, shared by every subagent that has it.'
                : 'Then say when. If it can’t connect, it offers a call back.'}
          </p>
        </div>
      )}
    </div>
  );
}

// the agents, the ones that need a look first; many get a search and a filter (canvas board S8)
function AgentLines({ s, agents, alone, name, onOpen }) {
  const [query, setQuery] = useState('');
  const [bad, setBad] = useState(false);
  const many = agents.length > MANY;
  const q = query.trim().toLowerCase();
  const sorted = [...agents].sort((a, b) => (a.state ? 0 : 1) - (b.state ? 0 : 1) || (a.first ? 0 : 1) - (b.first ? 0 : 1));
  const shown = sorted.filter((a) => (!bad || a.state) && (!q || `${a.name} ${a.does}`.toLowerCase().includes(q)));
  const nBad = agents.filter((a) => a.state).length;
  return (
    <>
      {many && (
        <div className="cxFilters">
          <span className="rmFind">
            <Icon name="search" size={15} />
            <Input
              size="small"
              aria-label="Search the agents"
              placeholder={`Search ${agents.length} agents`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <div className="cvPills" role="group" aria-label="Show">
            <button type="button" aria-pressed={!bad} className={!bad ? 'on' : ''} onClick={() => setBad(false)}>
              All {agents.length}
            </button>
            {nBad > 0 && (
              <button type="button" aria-pressed={bad} className={bad ? 'on' : ''} onClick={() => setBad(true)}>
                Needs a look {nBad}
              </button>
            )}
          </div>
        </div>
      )}
      {shown.map((a) => (
        <Line
          key={a.key}
          s={s}
          k={`agent:${a.key}`}
          icon={a.first ? 'agent' : 'subagent'}
          label={a.name}
          action={a.state ? 'Fix' : 'Open'}
          onAction={() => onOpen('agents', a.key)}
        >
          {alone ? 'Answers every call itself' : a.first ? 'Answers first' : a.kind}
          <span className="apDim">
            {alone
              ? ` · what it does is written on Build › Agent`
              : `${a.state ? ` · ${a.state.why}` : a.does ? ` · ${clip(a.does, 60)}` : ''} · ${a.tools ? `${a.tools} ${a.tools === 1 ? 'tool' : 'tools'}` : 'no tools'}`}
          </span>
          {a.state && <span className={`tlPill ${a.state.tone}`}>{a.state.words}</span>}
        </Line>
      ))}
      {(q || bad) && !shown.length && <p className="apNone">No agent matches.</p>}
      <Line s={s} k="addAgent" icon="plus" label="Add a subagent" action="Add" muted onAction={s.addAgent}>
        {alone
          ? `One job each, such as bookings or billing; ${name} learns when to pass callers to it`
          : 'One job each; the first agent learns when to pass callers to it'}
      </Line>
    </>
  );
}

function Overview({ ctx, form, view }) {
  const route = useRoute();
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);
  const cards = useMemo(() => Object.fromEntries(form.cols.flat().map((c) => [c.id, c])), [form]);
  // the part-level rows: the cards' own, and the back card's settings for the whole team (not its per-agent switch)
  const rows = useMemo(
    () => ({
      ...rowsOf(form),
      ...Object.fromEntries(
        cards.back
          .rowsFor(ctx)
          .filter((r) => r.id !== 'back')
          .map((r) => [`back.${r.id}`, r]),
      ),
    }),
    [form, cards, ctx],
  );
  // an agent or a hand-over open on its own page: from the address (?item=list:key), so a link or a reload opens it
  // (and follows it: going to the plain address, from the menu say, closes the page)
  const itemParam = String(route.params?.item || '');
  const fromParam = (param) => {
    const [l, ...key] = param.split(':');
    return PAGES[l] && key.length ? { list: l, key: key.join(':') } : null;
  };
  const [item, setItem] = useState(() => fromParam(itemParam));
  const [seen, setSeen] = useState(itemParam);
  if (itemParam !== seen) {
    setSeen(itemParam);
    setItem(fromParam(itemParam));
  }
  const config = ctx.config;
  const workspace = ctx.workspace;
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const agents = agentsIn(config);
  const hands = handoversIn(config);
  const outs = transfersOut(config, workspace);
  const said = sentenceOf(config, workspace);
  const missing = rulesMissing(config);

  const openItem = (l, key) => {
    setOpen(null);
    ctx.choose(l, key);
    setItem({ list: l, key });
    requestAnimationFrame(() => reveal(document.querySelector('.cxPage')));
  };
  const back = () => {
    setItem(null);
    if (route.view === 'bot') replaceRoute(routeHref(route.botId, route.tab, { ...route.params, item: undefined }));
  };
  const openLine = (line) => {
    setOpen({ line });
    requestAnimationFrame(() => reveal(document.querySelector(`.saWrap [data-line="${line}"]`)));
  };
  const openToken = (k) => {
    setOpen({ token: k });
    reveal(hero.current);
  };
  const addAgent = () => {
    const made = cards.who.list.add(config);
    ctx.set(made.config);
    openItem('agents', made.key);
  };
  // an item a list or the picture names: a hand-over to a person lives on Tools
  const openAny = (p) => (p.list === 'tools' ? ctx.goTools?.(p.key) : openItem(p.list, p.key));

  if (item)
    return (
      <section className="dtPart apWrap saWrap" data-part="subagents" aria-label="Subagents and hand-overs">
        <SubagentPage ctx={ctx} form={form} listId={item.list} itemKey={item.key} onBack={back} onOpen={openAny} />
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
      {blank ? TOKENS[k].blank || words : words}
      <span className="srOnly"> ({TOKENS[k].title}: change)</span>
    </button>
  );
  const s = { open, setOpen, openToken, close, rows, ctx, filled: {}, anchors, tokens: TOKENS, partId: 'subagents', addAgent };
  const subs = agents.filter((a) => !a.first);
  const first = said.first;
  const firstName = first?.name || name;
  const fromFirst = hands.filter((h) => h.from === first?.key).length;
  const backWords = said.back === subs.length ? (subs.length === 1 ? 'it' : 'all of them') : `${said.back} of them`;
  const others = said.others;
  const otherWords = others.length === 1 ? others[0].toName : `${others.length} other agents`;
  const beyond = [...(others.length ? [tok('others', otherWords)] : []), ...(said.person ? [tok('person', 'a person')] : [])];
  const backTool = list(config?.tools).some((t) => t?.builtin === 'return_to_entry');
  const pending = rows['back.pending']?.get?.(config);
  const loops = rows['back.loops']?.get?.(config);
  const moves = rows['back.moves'] ? config?.guardrails?.limits?.max_handoffs_per_call : undefined;
  const backers = agents.filter((a) => a.canGoBack);

  // what a part of the sentence opens: its own setting, or the list of its kind
  const listOf = (k) => {
    if (k === 'subs')
      return {
        items: subs.map((a) => ({ list: 'agents', key: a.key, name: a.name, words: a.state ? a.state.why : a.does || a.kind, icon: 'subagent' })),
        add: ['Add a subagent', addAgent],
      };
    if (k === 'others')
      return {
        items: outs
          .filter((o) => o.to === 'agent')
          .map((o) => ({ list: 'agentTransfers', key: o.key, name: o.toName, words: `from ${o.fromName}`, icon: 'phoneTransfer' })),
        add: ['Add a hand-over to another agent', () => openLine('addHand')],
        note: 'The call is transferred to that agent’s number: an agent of your workspace gets one when it goes live.',
      };
    if (k === 'person')
      return {
        items: outs
          .filter((o) => o.to === 'person')
          .map((o) => ({ list: 'tools', key: o.key, name: `${o.fromName} → a person`, words: 'set on Tools · Pass to a person', icon: 'user' })),
        note: 'A hand-over to a person is a tool: its number, its words and its hours are set on Tools.',
      };
    return null;
  };
  const popover = () => {
    const k = open.token;
    if (k === 'first')
      return (
        <>
          <Rows ids={TOKENS.first.ids} rows={rows} ctx={ctx} partId="subagents" />
          <p className="cxNote">
            <Icon name="info" size={14} />
            It takes every new call. The others take over only when a hand-over passes the caller on.
          </p>
        </>
      );
    if (k === 'back')
      return (
        <div className="cxTokenList">
          {subs.length ? (
            <ul className="cxUses">
              {subs.map((a) => (
                <li key={a.key}>
                  <span className="cxIcon" aria-hidden="true">
                    <Icon name="subagent" size={14} />
                  </span>
                  <span className="cxText">
                    <b>{a.name}</b>
                    <small>{a.canGoBack ? `can send the caller back to ${firstName}` : 'can’t send them back yet'}</small>
                  </span>
                  <Button type="button" variant="quiet" size="small" onClick={() => openItem('agents', a.key)}>
                    Open
                    <span className="srOnly"> {a.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="apNone">No subagents yet.</p>
          )}
          <p className="cxNote">
            <Icon name="info" size={14} />
            Each subagent’s way back is on its own page, under “Coming back”.
          </p>
        </div>
      );
    const l = listOf(k);
    return (
      <div className="cxTokenList">
        {l.items.length ? (
          <ul className="cxUses">
            {l.items.map((x) => (
              <li key={`${x.list}:${x.key}`}>
                <span className="cxIcon" aria-hidden="true">
                  <Icon name={x.icon} size={14} />
                </span>
                <span className="cxText">
                  <b>{x.name}</b>
                  <small>{x.words}</small>
                </span>
                <Button type="button" variant="quiet" size="small" onClick={() => openAny(x)}>
                  {x.list === 'tools' ? 'Open in Tools' : 'Open'}
                  <span className="srOnly"> {x.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="apNone">None yet.</p>
        )}
        {l.add && (
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => {
              close();
              l.add[1]();
            }}
          >
            <Icon name="plus" size={14} />
            {l.add[0]}
          </Button>
        )}
        {l.note && (
          <p className="cxNote">
            <Icon name="info" size={14} />
            {l.note}
          </p>
        )}
      </div>
    );
  };

  return (
    <section className="dtPart apWrap saWrap" data-part="subagents" aria-labelledby="dt-subagents-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-subagents-title">Subagents and hand-overs</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero saHero" aria-label="Who answers">
        <div className="apId">
          <span className="apAvatar saAvatarBig" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>Who answers for {name}</h2>
            <p>{summaryLine(config, workspace)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={() => openLine('try')}>
              <Icon name="play" size={12} />
              Try a line
            </Button>
          </div>
        </div>
        {missing > 0 && (
          <div className="saFix" role="note">
            <Icon name="alert" size={15} />
            <span>
              Hand-overs may go wrong: {missing === 1 ? 'one agent is' : `${missing} agents are`} missing the hand-over rules, so callers can get stuck with the
              wrong one.
            </span>
            <Button type="button" variant="secondary" size="small" onClick={() => ctx.set(withHandoffRules(config))}>
              Add the hand-over rules
            </Button>
          </div>
        )}
        <p className="apSentence saSentence">
          {said.alone ? (
            <>
              {tok('first', firstName)} answers every call itself. Not yet: {tok('subs', '', true)}
              {!others.length && <> or {tok('others', 'another agent to transfer to', true)}</>}.
              {beyond.length > 0 && (
                <>
                  {' '}
                  It can pass callers to {beyond[0]}
                  {beyond[1] && <> or {beyond[1]}</>}.
                </>
              )}
            </>
          ) : (
            <>
              {tok('first', firstName)} answers first{fromFirst ? ' and passes callers to ' : ', with '}
              {tok('subs', said.subs)}
              {fromFirst ? '' : ' beside it, though it passes nobody on yet'}
              {said.back ? <>; {tok('back', backWords)} can send callers back.</> : <>. Not yet: {tok('back', 'a way back to the first', true)}.</>}
              {beyond.length > 0 && (
                <>
                  {' '}
                  Beyond {name}, it can pass them to {beyond[0]}
                  {beyond[1] && <> or {beyond[1]}</>}.
                </>
              )}
            </>
          )}
        </p>
        <p className="apHint">Click any part to change it.</p>
        <RelayMap config={config} workspace={workspace} name={name} onAgent={(key) => openItem('agents', key)} onBeyond={openAny} onAdd={addAgent} />
        {open?.token && (
          <Popover
            key={open.token}
            anchor={anchors.current[open.token]}
            box={hero}
            title={TOKENS[open.token]?.title || 'A person'}
            onClose={close}
            width={TOKENS[open.token]?.width || 520}
          >
            {popover()}
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="sa-agents">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="sa-agents">Its agents</h2>
          <span className="apChSub">{agents.length > MANY ? 'Those that need a look come first' : 'Who answers first, and what each subagent does'}</span>
        </div>
        <div className="apDoc lines">
          <AgentLines s={s} agents={agents} alone={said.alone} name={name} onOpen={openItem} />
        </div>
      </section>

      <section className="apCh" aria-labelledby="sa-hands">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="sa-hands">Hand-overs</h2>
          <span className="apChSub">When each passes the caller on, and what it says while it does</span>
        </div>
        <div className="apDoc lines">
          {[...hands]
            .sort((a, b) => (a.state ? 0 : 1) - (b.state ? 0 : 1))
            .map((h) => (
              <Line
                key={h.key}
                s={s}
                k={`hand:${h.key}`}
                icon="subagent"
                label={`${h.fromName} → ${h.toName}`}
                action={h.state ? 'Fix' : 'Open'}
                onAction={() => openItem('handoffs', h.key)}
              >
                {h.state ? h.state.why : h.when ? quoted(h.when) : 'No “when” yet'}
                {h.says && <span className="apDim"> · says {quoted(h.says, 40)}</span>}
                {h.state && <span className={`tlPill ${h.state.tone}`}>{h.state.words}</span>}
              </Line>
            ))}
          {outs.map((o) => (
            <Line
              key={o.key}
              s={s}
              k={`out:${o.key}`}
              icon={o.to === 'agent' ? 'phoneTransfer' : 'user'}
              label={`${o.fromName} → ${o.toName}`}
              action={o.to === 'agent' ? 'Open' : 'Open in Tools'}
              onAction={() => (o.to === 'agent' ? openItem('agentTransfers', o.key) : ctx.goTools?.(o.key))}
            >
              {o.to === 'agent' ? 'Another agent' : <span className="apDim">Set on Tools › Pass to a person</span>}
              {o.to === 'agent' && <span className="apDim"> · transferred to its number{o.hours ? ` · ${o.hours}` : ''}</span>}
            </Line>
          ))}
          <Line s={s} k="addHand" icon="plus" label="Add a hand-over" action="Add" muted below={<AddKinds ctx={ctx} onOpen={openItem} />}>
            {!said.alone
              ? 'From one agent to another, to another agent, back to the first, or to a person'
              : hands.length + outs.length
                ? 'To a subagent, to another agent, or to a person'
                : 'None yet · to a subagent, to another agent, or to a person'}
          </Line>
          <Line s={s} k="try" icon="play" label="Try a line" ids={LIMITS.try} action="Try" muted>
            Which agent would take what a caller says, and why
            <span className="apDim"> · nothing is called or saved</span>
          </Line>
        </div>
      </section>

      {subs.length > 0 && (
        <section className="apCh" aria-labelledby="sa-back">
          <div className="apChHead">
            <span className="apChNum">03</span>
            <h2 id="sa-back">Coming back, and limits</h2>
            <span className="apChSub">So a caller is never stuck with an agent that has finished its job</span>
          </div>
          <div className="apDoc lines">
            <Line s={s} k="ways" icon="undo" label="Ways back" token="back" action="Open" muted={!backers.length}>
              {backers.length ? together(backers.map((a) => a.name)) : 'None yet'}
              <span className="apDim">{backers.length ? ` · can send the caller back to ${firstName}` : ' · open a subagent to let it send callers back'}</span>
            </Line>
            {[
              [
                'pending',
                'Their unfinished request',
                pending ? <>Kept in {pending}</> : 'Not kept',
                pending ? 'the first agent picks up where they left off' : 'keep it in a value it remembers, and the first agent picks up where they left off',
              ],
              ['loops', 'Stop loops', loops ? 'On' : 'Off', loops ? 'never bounces a caller back and forth' : 'a caller can be bounced back and forth'],
            ].map(([id, label, value, why]) =>
              backTool && isShown(rows[`back.${id}`], ctx) ? (
                <Line key={id} s={s} k={id} icon="undo" label={label} ids={LIMITS[id]}>
                  {value}
                  <span className="apDim"> · {why}</span>
                </Line>
              ) : (
                <Line key={id} s={s} k={id} icon="undo" label={label} locked muted>
                  Comes with the first way back
                </Line>
              ),
            )}
            <Line s={s} k="moves" icon="undo" label="Most moves in one call" ids={LIMITS.moves} muted={moves === undefined}>
              {moves === undefined ? 'No limit set' : `${moves} ${moves === 1 ? 'move' : 'moves'}`}
            </Line>
          </div>
        </section>
      )}
    </section>
  );
}

export default function SubagentsWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the subagents’ settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
