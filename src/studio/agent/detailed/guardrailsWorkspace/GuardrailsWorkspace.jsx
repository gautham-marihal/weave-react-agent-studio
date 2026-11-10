import React, { useCallback, useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { groupIssues } from '../../../../api/client.ts';
import { readSimple } from '../../../simple/simpleModel.js';
import { replaceRoute, routeHref, useRoute } from '../../../route.js';
import { endingTools, momentsOf } from '../../blocks/guardrailModel.js';
import { lineOf } from '../../../form/speechLine.js';
import { AllSettings, Line, Popover, Rows, ViewSwitch, reveal, rowsOf, useShownView } from '../workspaceKit.jsx';
import { makeViewStore } from '../workspaceView.js';
import { useAddChoices } from '../AddItem.jsx';
import CallPath from './CallPath.jsx';
import GuardrailPage from './GuardrailPage.jsx';
import { LINES, PAGES, TOKENS } from './guardrailsLayout.js';
import { notRunOf, sentenceOf, summaryLine, together } from './guardrailsWords.js';
import './guardrailsWorkspace.css';

// Build › Guardrails as what it guards (design: canvas page "8 · Guardrails, redesigned"), for any agent. A sentence
// says what it checks before it hears a caller and before it speaks, the topics it keeps to, when it hands over or ends,
// and its longest call (what is not set is a grey blank after "Not yet:"); under it, the path of one line through a
// call, and what watches the whole call. Then three chapters: checks, topics and when to hand over or end, limits. A
// check and a rule of its own each open on a page of their own (GuardrailPage). All settings: every setting,
// searchable. Every view edits with the part's own rows (guardrailsForm); what the server keeps but doesn't act on yet
// is said from its own report.

const VIEWS = makeViewStore('weave_guardrails_view', 'overview');
const FIRST = ['overview', 'What it guards'];
const LABEL = 'How to see the guardrails';
const MANY = 6;

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

// "Add a check": on what callers say or on what it says, then by what it does (canvas board G5)
function AddCheck({ ctx, where, setWhere, name, onAdded }) {
  const choices = useAddChoices({ ctx, path: ['guardrails', where], pickerKey: `guardrails.${where}`, word: 'check', onAdded: (key) => onAdded(where, key) });
  return (
    <div className="tlKindsWrap">
      <div className="apSeg segmented grWhere" role="group" aria-label="Which words it checks">
        {[
          ['input', 'What callers say'],
          ['output', `What ${name} says`],
        ].map(([w, words]) => (
          <button key={w} type="button" aria-pressed={where === w} className={where === w ? 'on' : ''} onClick={() => setWhere(w)}>
            {words}
          </button>
        ))}
      </div>
      {choices && (
        <div className="tlKinds" role="group" aria-label="What should it check for?">
          {choices.options.map((option) => (
            <button key={option.id} type="button" className={`tlKind ${option.unavailable ? 'later' : ''}`} onClick={() => choices.pick(option)}>
              <span className="tlKindIcon" aria-hidden="true">
                <Icon name={option.icon || 'shield'} size={16} />
              </span>
              <b>{option.label}</b>
              <small>{option.help}</small>
            </button>
          ))}
        </div>
      )}
      <p className="apHint">
        {where === 'output'
          ? `On what ${name} says, only a rule in words is acted on today; the others are kept for when the server runs them.`
          : `Checked before ${name} hears the message, so nothing is spent on a message that is turned away.`}
      </p>
    </div>
  );
}

// the checks, those that need a look first; many get a search and a filter (canvas board G8)
function CheckLines({ s, checks, problemOf, name, onOpen }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const FILTERS = [
    { id: 'all', name: 'All', test: () => true },
    { id: 'input', name: 'What callers say', test: (c) => c.list === 'input' },
    { id: 'output', name: `What ${name} says`, test: (c) => c.list === 'output' },
    { id: 'bad', name: 'Needs a look', test: (c) => !!problemOf(c) },
  ];
  const many = checks.length > MANY;
  const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
  const q = query.trim().toLowerCase();
  const sorted = [...checks].sort((a, b) => (problemOf(a) ? 0 : 1) - (problemOf(b) ? 0 : 1));
  const shown = sorted.filter((c) => f.test(c) && (!q || `${c.name} ${c.kindName} ${c.looks}`.toLowerCase().includes(q)));
  return (
    <>
      {many && (
        <div className="cxFilters">
          <span className="rmFind">
            <Icon name="search" size={15} />
            <Input
              size="small"
              aria-label="Search the checks"
              placeholder={`Search ${checks.length} checks`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <div className="cvPills" role="group" aria-label="Show">
            {FILTERS.map((x) => {
              const n = checks.filter(x.test).length;
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
      {shown.map((c) => {
        const problem = problemOf(c);
        return (
          <Line
            key={`${c.list}:${c.key}`}
            s={s}
            k={`check:${c.list}:${c.key}`}
            icon={c.icon}
            label={c.name}
            action={problem ? 'Fix' : 'Open'}
            onAction={() => onOpen(c.list, c.key)}
          >
            {problem || (c.type === 'statement' ? c.looks.replace(/^n/, 'N') : `${c.does}${c.looks && c.type !== 'prompt_injection' ? `: ${c.looks}` : ''}`)}
            <span className="apDim"> · {c.list === 'input' ? 'what callers say' : `what ${name} says`}</span>
            {problem ? (
              <span className="tlPill bad">Needs a look</span>
            ) : c.how === 'kept' ? (
              <span className="tlPill warn">Not run yet</span>
            ) : c.how === 'told' ? (
              <span className="tlPill">Told to {name}</span>
            ) : null}
          </Line>
        );
      })}
      {(q || filter !== 'all') && !shown.length && <p className="apNone">No check matches.</p>}
    </>
  );
}

function Overview({ ctx, form, view }) {
  const route = useRoute();
  const hero = useRef(null);
  const anchors = useRef({});
  const [open, setOpen] = useState(null);
  const [where, setWhere] = useState('input');
  const close = useCallback(() => setOpen(null), []);
  const rows = useMemo(() => rowsOf(form), [form]);
  const cards = useMemo(() => Object.fromEntries(form.cols.flat().map((c) => [c.id, c])), [form]);
  // a check or a rule open on its own page: from the address (?item=list:key), so a link or a reload opens it (and
  // follows it: going to the plain address, from the menu say, closes the page)
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
  const unsupported = ctx.editor?.report?.unsupported;
  const notRun = notRunOf(config, unsupported);
  const simple = readSimple(config);
  const name = simple.persona || simple.name || 'It';
  const said = sentenceOf(config, unsupported);
  // what the checks found, errors and warnings, by where they are
  const found = groupIssues(ctx.editor?.report).filter((i) => Array.isArray(i.path));
  const problemAt = (base) => found.find((i) => base.every((p, n) => String(i.path[n]) === String(p)))?.message || '';
  // the server's word first, else what the check is plainly missing
  const problemOf = (c) => problemAt(c.base) || c.gap || '';
  const problems = [...said.input, ...said.output].filter(problemOf).length + said.rules.filter((r) => problemAt(r.base) || r.gap).length;

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
  const rekey = (key) => {
    ctx.choose(item.list, key);
    setItem({ ...item, key });
  };
  const openLine = (line) => {
    setOpen({ line });
    requestAnimationFrame(() => reveal(document.querySelector(`.grWrap [data-line="${line}"]`)));
  };
  const openToken = (k, at = k) => {
    setOpen({ token: k, at });
    reveal(hero.current);
  };
  const addCheck = (w) => {
    setWhere(w);
    openLine('addCheck');
  };
  const addRule = () => {
    const made = cards.rule.list.add(config);
    ctx.set(made.config);
    openItem('rules', made.key);
  };

  if (item)
    return (
      <section className="dtPart apWrap grWrap" data-part="guardrails" aria-label="Guardrails">
        <GuardrailPage
          ctx={ctx}
          form={form}
          listId={item.list}
          itemKey={item.key}
          name={name}
          notRun={notRun}
          unsupported={unsupported}
          onBack={back}
          onRekey={rekey}
        />
      </section>
    );

  const tok = (k, words, blank = false) => {
    const at = `${k}:${blank ? '' : words}`;
    const on = open?.token === k && open.at === at;
    return (
      <button
        key={at}
        type="button"
        ref={(el) => {
          anchors.current[at] = el;
        }}
        className={['apTok', blank && 'blank optional', on && 'on'].filter(Boolean).join(' ')}
        aria-expanded={on}
        aria-haspopup="dialog"
        onClick={() => (on ? close() : openToken(k, at))}
      >
        {blank ? TOKENS[k].blank : words}
        <span className="srOnly"> ({TOKENS[k].title}: change)</span>
      </button>
    );
  };
  const s = { open, setOpen, openToken, close, rows, ctx, filled: {}, anchors, tokens: TOKENS, partId: 'guardrails' };

  // ---- the sentence: what it checks, then what it keeps to and when it acts, then "Not yet:" for what isn't set
  // up to two kinds of check, each its whole phrase ("refuses tricks", "follows 2 rules in words"), then how many more
  const verbs = (checks, k) => {
    const kinds = [];
    checks.forEach((c) => {
      const kind = kinds.find((x) => x.type === c.type);
      if (kind) kind.n += 1;
      else kinds.push({ type: c.type, verb: c.verb, n: 1 });
    });
    const shown = kinds.slice(0, 2);
    const rest = checks.length - shown.reduce((sum, x) => sum + x.n, 0);
    const out = shown.map((x) => tok(k, x.type === 'statement' && x.n > 1 ? `follows ${x.n} rules in words` : x.verb));
    if (rest > 0) out.push(<React.Fragment key="more">{tok(k, `${rest} more ${rest === 1 ? 'check' : 'checks'}`)}</React.Fragment>);
    return joined(out);
  };
  const first = [];
  if (said.input.length)
    first.push(
      <React.Fragment key="in">
        Before {name} hears a caller, it {verbs(said.input, 'input')}
      </React.Fragment>,
    );
  if (said.output.length)
    first.push(
      <React.Fragment key="out">
        {said.input.length ? 'before it speaks, it ' : `Before ${name} speaks, it `}
        {verbs(said.output, 'output')}
      </React.Fragment>,
    );
  const topics = said.allowed.length + said.blocked.length;
  const second = [];
  if (said.allowed.length)
    second.push(<React.Fragment key="t">keeps to {tok('topics', `${said.allowed.length} ${said.allowed.length === 1 ? 'topic' : 'topics'}`)}</React.Fragment>);
  else if (said.blocked.length)
    second.push(
      <React.Fragment key="t">stays off {tok('topics', said.blocked.length === 1 ? said.blocked[0] : `${said.blocked.length} topics`)}</React.Fragment>,
    );
  if (said.person.length)
    second.push(
      <React.Fragment key="p">
        passes {joined(said.person.map((m) => tok('moments', m.id === 'frustrated_to_person' ? 'frustrated callers' : 'people asking for a manager')))} to a
        person
      </React.Fragment>,
    );
  if (said.abusive) second.push(<React.Fragment key="a">{tok('moments', 'ends the call')} when someone is abusive</React.Fragment>);
  if (said.rules.length)
    second.push(
      <React.Fragment key="r">follows {tok('rules', said.rules.length === 1 ? 'a rule of its own' : `${said.rules.length} rules of its own`)}</React.Fragment>,
    );
  if (said.limit)
    second.push(
      <React.Fragment key="l">
        {said.limit.key === 'max_call_duration_s' ? 'ends every call at ' : said.limit.key === 'max_silence_s' ? 'ends a call after ' : 'allows at most '}
        {tok('limits', said.limit.key === 'max_tool_calls_per_call' ? `${said.limit.words} tool uses a call` : said.limit.words)}
        {said.limit.key === 'max_silence_s' ? ' of silence' : ''}
      </React.Fragment>,
    );
  const blanks = [!said.input.length && tok('input', '', true), !topics && tok('topics', '', true), !said.limits.length && tok('limits', '', true)].filter(
    Boolean,
  );
  const nothing = !first.length && !second.length;

  // ---- what a part of the sentence opens: its own settings, or the list of its kind
  const listPop = (items, add, note) => (
    <div className="cxTokenList">
      {items.length ? (
        <ul className="cxUses">
          {items.map((x) => (
            <li key={x.key}>
              <span className="cxIcon" aria-hidden="true">
                <Icon name={x.icon} size={14} />
              </span>
              <span className="cxText">
                <b>{x.name}</b>
                <small>{x.words}</small>
              </span>
              <Button type="button" variant="quiet" size="small" onClick={x.open}>
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
          add[1]();
        }}
      >
        <Icon name="plus" size={14} />
        {add[0]}
      </Button>
      {note && (
        <p className="cxNote">
          <Icon name="info" size={14} />
          {note}
        </p>
      )}
    </div>
  );
  const popover = () => {
    const k = open.token;
    if (k === 'input' || k === 'output')
      return listPop(
        (k === 'input' ? said.input : said.output).map((c) => ({
          key: c.key,
          name: c.name,
          words: `${c.does}${problemOf(c) ? ` · needs a look` : ''}`,
          icon: c.icon,
          open: () => openItem(k, c.key),
        })),
        ['Add a check', () => addCheck(k)],
        k === 'output' && said.output.some((c) => c.how === 'kept')
          ? 'Only a rule in words is acted on in what it says today; the others are kept for later.'
          : '',
      );
    if (k === 'rules')
      return listPop(
        said.rules.map((r) => ({ key: r.key, name: r.name, words: r.words, icon: 'shield', open: () => openItem('rules', r.key) })),
        ['Add a rule', addRule],
        notRun.escalation ? 'The server keeps these rules but doesn’t act on them yet.' : '',
      );
    const note =
      k === 'topics' && notRun.topics
        ? 'Kept, but the server doesn’t act on topics yet: nobody is turned away for being off topic. Say it in the instructions meanwhile.'
        : k === 'moments' && notRun.escalation
          ? 'Kept, but the server doesn’t act on these yet: no caller is passed on or cut off by them. Limits do run.'
          : k === 'limits'
            ? 'Checked every time: when a limit is reached, it says its goodbye and the call ends. The most moves between agents is set on Subagents and hand-overs.'
            : '';
    return (
      <>
        <Rows ids={TOKENS[k].ids} rows={rows} ctx={ctx} partId="guardrails" />
        {note && (
          <p className="cxNote">
            <Icon name="info" size={14} />
            {note}
          </p>
        )}
      </>
    );
  };

  const moments = momentsOf(config);
  const momentLine = (id, k, label, icon, on, off) => (
    <Line s={s} k={k} icon={icon} label={label} ids={LINES[k]} action={moments[id].on ? 'Change' : 'Switch on'} muted={!moments[id].on}>
      {moments[id].on ? on : 'Off'}
      <span className="apDim">{moments[id].on ? off : moments[id].needsHandOver ? ' · switching it on also switches on “Pass to a person” on Tools' : ''}</span>
    </Line>
  );
  const limitLine = (k, key, label) => {
    const l = said.limits.find((x) => x.key === key);
    return (
      <Line s={s} k={k} icon="clock" label={label} ids={LINES[k]} muted={!l}>
        {l ? l.words : 'No limit'}
        {key === 'max_silence_s' && <span className="apDim">{l ? ' · whatever the nudges' : ' · its nudges still run'}</span>}
      </Line>
    );
  };
  const offTopic = said.offTopic ? config.guardrails.topics.on_off_topic : null;
  const offThen = offTopic ? endingTools(config).find((t) => t.id === offTopic.then)?.label : '';
  // its words, a fixed line's too
  const limitSay = lineOf(config, config?.guardrails?.limits?.say).text;

  return (
    <section className="dtPart apWrap grWrap" data-part="guardrails" aria-labelledby="dt-guardrails-title">
      <header className="apTop">
        <div className="apTopText">
          <h1 id="dt-guardrails-title">Guardrails</h1>
          <p className="dtQuestion">{form.question}</p>
        </div>
        <ViewSwitch view={view} onChoose={VIEWS.set} first={FIRST} label={LABEL} />
      </header>

      <section ref={hero} className="apHero grHero" aria-label="What it guards">
        <div className="apId">
          <span className="apAvatar grAvatarBig" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <div className="apName">
            <h2>What {name} must never do</h2>
            <p>{summaryLine(config, unsupported, problems)}</p>
          </div>
          <div className="apActs">
            <Button type="button" variant="primary" className="apInk" onClick={() => openLine('try')}>
              <Icon name="play" size={12} />
              Try a line
            </Button>
          </div>
        </div>
        <p className="apSentence grSentence">
          {nothing ? (
            <>{name} follows its instructions, and nothing is checked yet.</>
          ) : (
            <>
              {first.length > 0 && (
                <>
                  {first[0]}
                  {first[1] && <>; {first[1]}</>}.{' '}
                </>
              )}
              {second.length > 0 && (
                <>
                  {first.length ? 'It' : name} {joined(second)}.
                </>
              )}
            </>
          )}
          {blanks.length > 0 && <> Not yet: {joined(blanks, 'or')}.</>}
        </p>
        <p className="apHint">Click any part to change it.</p>
        <CallPath
          name={name}
          said={said}
          notRun={notRun}
          bad={(c) => !!problemOf(c)}
          onCheck={(c) => openItem(c.list, c.key)}
          onToken={openToken}
          onAdd={addCheck}
          onRule={(r) => openItem('rules', r.key)}
        />
        {open?.token && (
          <Popover
            key={open.token}
            // the part clicked, else the first part of the sentence that opens it (opened from the picture)
            anchor={
              anchors.current[open.at] || Object.entries(anchors.current).find(([key, el]) => el && key.startsWith(`${open.token}:`))?.[1] || hero.current
            }
            box={hero}
            title={TOKENS[open.token].title}
            onClose={close}
            width={TOKENS[open.token].width}
          >
            {popover()}
          </Popover>
        )}
      </section>

      <section className="apCh" aria-labelledby="gr-checks">
        <div className="apChHead">
          <span className="apChNum">01</span>
          <h2 id="gr-checks">Checks</h2>
          <span className="apChSub">
            On what callers say, before {name} hears it, and on what {name} says, before it is said
          </span>
        </div>
        <div className="apDoc lines">
          <CheckLines s={s} checks={[...said.input, ...said.output]} problemOf={problemOf} name={name} onOpen={openItem} />
          <Line
            s={s}
            k="addCheck"
            icon="plus"
            label="Add a check"
            action="Add"
            muted
            below={<AddCheck ctx={ctx} where={where} setWhere={setWhere} name={name} onAdded={openItem} />}
          >
            {said.input.length + said.output.length ? '' : 'None yet · '}Refuse tricks, hide personal details, block words, keep secret fields out, a rule in
            words
          </Line>
          <Line s={s} k="try" icon="play" label="Try a line" ids={LINES.try} action="Try" muted>
            What the checks on what callers say would do<span className="apDim"> · run by the same code as a live call · nothing is saved</span>
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="gr-topics">
        <div className="apChHead">
          <span className="apChNum">02</span>
          <h2 id="gr-topics">Topics, and when to hand over or end</h2>
          <span className="apChSub">What it keeps to, and when it passes a caller on or ends the call</span>
        </div>
        {(notRun.topics || notRun.escalation) && (
          <p className="cxNote grWarn grChNote">
            <Icon name="info" size={14} />
            {notRun.topics && notRun.escalation
              ? 'The server keeps the topics and these rules but doesn’t act on them yet: say it in the instructions meanwhile. Limits and the checks on what callers say do run.'
              : notRun.topics
                ? 'The server keeps the topics but doesn’t act on them yet: say it in the instructions meanwhile.'
                : 'The server keeps these rules but doesn’t act on them yet: no caller is passed on or cut off by them. Limits do run.'}
          </p>
        )}
        <div className="apDoc lines">
          <Line s={s} k="allowed" icon="chat" label="What it talks about" ids={LINES.allowed} muted={!said.allowed.length}>
            {said.allowed.length ? together(said.allowed) : 'Anything its instructions allow'}
          </Line>
          <Line s={s} k="blocked" icon="block" label="What it must not talk about" ids={LINES.blocked} muted={!said.blocked.length}>
            {said.blocked.length ? together(said.blocked) : 'Nothing listed'}
          </Line>
          <Line s={s} k="offtopic" icon="chat" label="When someone keeps going off topic" ids={LINES.offtopic} muted={!offTopic}>
            {offTopic ? `After ${offTopic.max_strikes} ${offTopic.max_strikes === 1 ? 'try' : 'tries'}` : 'Off'}
            {offTopic && <span className="apDim"> · then {offThen ? offThen.toLowerCase() : 'nothing chosen yet'}</span>}
          </Line>
          {momentLine('frustrated_to_person', 'frustrated', 'A frustrated caller', 'user', 'Passed to a person', ' · 2 turns in a row')}
          {momentLine(
            'asks_for_person',
            'manager',
            'Someone asking for a manager',
            'user',
            'Passed to a person',
            ` · ${(moments.asks_for_person.keywords || []).map((w) => `“${w}”`).join(', ')}`,
          )}
          {momentLine('abusive_end', 'abusive', 'Someone abusive', 'endCall', 'Ends the call', ' · with a short, polite goodbye')}
          {said.rules.map((r) => (
            <Line
              key={r.key}
              s={s}
              k={`rule:${r.key}`}
              icon="shield"
              label={r.name}
              action={problemAt(r.base) || r.gap ? 'Fix' : 'Open'}
              onAction={() => openItem('rules', r.key)}
            >
              {problemAt(r.base) || r.gap || `When ${r.when}: ${r.then}`}
              {(problemAt(r.base) || r.gap) && <span className="tlPill bad">Needs a look</span>}
            </Line>
          ))}
          <Line s={s} k="addRule" icon="plus" label="Add a rule" action="Add" muted onAction={addRule}>
            When: what they want, words, how they feel, a remembered value<span className="apDim"> · then: a person, an agent, end the call, a tool</span>
          </Line>
        </div>
      </section>

      <section className="apCh" aria-labelledby="gr-limits">
        <div className="apChHead">
          <span className="apChNum">03</span>
          <h2 id="gr-limits">Limits</h2>
          <span className="apChSub">Hard stops, checked every time: the limit is reached, it says its goodbye, the call ends</span>
        </div>
        <div className="apDoc lines">
          {limitLine('call', 'max_call_duration_s', 'Longest call')}
          {limitLine('silence', 'max_silence_s', 'Longest silence')}
          {limitLine('tools', 'max_tool_calls_per_call', 'Most tool uses in one call')}
          <Line s={s} k="limitSay" icon="quote" label="What it says when a limit ends the call" ids={LINES.limitSay} muted={!limitSay}>
            {limitSay ? `“${limitSay}”` : 'A short goodbye, in English'}
          </Line>
          <Line s={s} k="moves" icon="phoneTransfer" label="Most moves between agents" action="Open there" muted onAction={() => ctx.goPart?.('subagents')}>
            Set on Subagents and hand-overs
          </Line>
        </div>
      </section>
    </section>
  );
}

export default function GuardrailsWorkspace({ ctx, form }) {
  const { view, choose } = useShownView(ctx, VIEWS);
  if (view === 'all')
    return (
      <AllSettings
        ctx={ctx}
        form={form}
        searchLabel="Search the guardrails’ settings"
        switcher={<ViewSwitch view="all" onChoose={choose} first={FIRST} label={LABEL} />}
      />
    );
  return <Overview ctx={ctx} form={form} view={view} />;
}
