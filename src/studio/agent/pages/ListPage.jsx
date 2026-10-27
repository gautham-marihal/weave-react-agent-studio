import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Notice, Spinner } from '../../ui.jsx';
import { createEngine } from '../../form/engine.js';
import AddPicker from '../../form/AddPicker.jsx';
import { agentsUsingTool, describeAdvice, kindOfTool, unusedTools } from '../../form/toolInfo.js';
import { INTRO, pickerFor, takenIdsAt, WHAT } from '../../form/pickerOptions.js';
import { changesSomething, plainKind, plainToolKind } from '../../form/plainKinds.js';
import { uniqueId } from '../../form/ctx.js';
import { useSchema } from '../../form/useSchema.js';
import { useChannelTypes } from '../../form/useChannelTypes.js';
import { NOT_RUNNING, notRunningYet } from '../../form/channelTypes.js';
import { useProviders } from '../../models/useProviders.js';
import { defaultsForType } from '../../form/presets.js';
import { KNOWLEDGE_ID, addChannel, firstLineOf, shareFirstLine, switchOf } from '../../setup/setupModel.js';
import { groupIssues } from '../../../api/client.ts';
import PageShell, { EmptyState, Section, SettingRow } from '../PageShell.jsx';
import { StagedDrawer } from '../Drawer.jsx';
import { getAtPath, schemaAtPath, setAtPath } from '../schemaPath.js';
import { agentLabel, humanize, rowName } from '../rowNames.js';
import { checkWords, momentOf, ruleWords } from '../blocks/guardrailModel.js';
import { SENSITIVE } from '../blocks/afterCallModel.js';
import { speechText } from '../../../demo/simulatedAgent.js';

const FormEditor = lazy(() => import('../../form/FormEditor.jsx'));
const list = (v) => (Array.isArray(v) ? v : []);
const keyOfPath = (path) => (Array.isArray(path) ? path.join('.') : '');
// "Use when the caller asks for a person. Say …" → "Use when the caller asks for a person."
const firstSentence = (text) => (typeof text === 'string' ? (text.trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text.trim()) : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sizeOf = (v) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);
// The config with the entry agent offering the tool `id`.
function offerToEntry(config, id) {
  const items = list(config?.agents?.items);
  const at = Math.max(
    0,
    items.findIndex((a) => isObj(a) && a.id === config.agents.entry),
  );
  if (typeof id !== 'string' || !id || !isObj(items[at]) || list(items[at].tools).includes(id)) return config;
  return { ...config, agents: { ...config.agents, items: items.map((a, i) => (i === at ? { ...a, tools: [...list(a.tools), id] } : a)) } };
}

// The picture beside a row: what kind of thing it is.
function iconFor(kind, item) {
  if (kind === 'tools') {
    const k = kindOfTool(item);
    if (item?.builtin === 'end_call') return 'endCall';
    if (item?.builtin === 'transfer_or_callback') return 'phoneTransfer';
    if (item?.builtin === 'send_form') return 'records';
    if (k === 'http') return 'plug';
    if (k === 'knowledge') return 'records';
    return 'tools';
  }
  if (kind === 'channels') return item?.type === 'sip_voice' ? 'phone' : item?.type === 'web_voice' ? 'mic' : item?.type === 'email' ? 'mail' : 'chat';
  if (kind === 'escalation') return item?.action === 'end_call' ? 'endCall' : 'phoneTransfer';
  return 'shield';
}

// Above a channel's settings, in place of its greeting (asked once, on the Agent page). A channel that usually greets
// can be given the agent's first line here, since nowhere else adds it to just this channel.
function GreetingNote({ config, set, index, onShowGreeting }) {
  const channel = list(config?.channels)[index];
  if (!isObj(channel)) return null;
  const line = firstLineOf(config);
  if (channel.greeting?.say !== undefined) {
    // the same line on every channel, the agent's first line (some channels wait), or this channel's own line
    const sameAs = (c) => isObj(c) && c.greeting?.say !== undefined && JSON.stringify(c.greeting.say) === JSON.stringify(channel.greeting.say);
    const every = list(config?.channels).filter(isObj).every(sameAs);
    const own = String(speechText(channel.greeting.say, config) || '').trim();
    if (line !== undefined && own && JSON.stringify(line) !== JSON.stringify(channel.greeting.say))
      return (
        <p className="nlHint smElsewhere">
          This channel says its own first line: “{own}”.{' '}
          <button type="button" className="linkButton" onClick={() => set(shareFirstLine(config, index))}>
            Say the agent’s first line here instead
          </button>
        </p>
      );
    return (
      <p className="nlHint smElsewhere">
        {every ? 'What it says first is the same on every channel:' : 'What it says first is the agent’s first line:'}{' '}
        {onShowGreeting ? (
          <button type="button" className="linkButton" onClick={onShowGreeting}>
            change it on the Agent page
          </button>
        ) : (
          'change it on the Agent page'
        )}
        .
      </p>
    );
  }
  const greets = !!defaultsForType(channel.type).greeting;
  return (
    <p className="nlHint smElsewhere">
      {line === undefined
        ? 'This channel waits for the person to start. What it says first is set on the Agent page.'
        : 'This channel waits for the person to start.'}{' '}
      {line !== undefined && greets && (
        <button type="button" className="linkButton" onClick={() => set(shareFirstLine(config, index))}>
          Say the agent’s first line here too
        </button>
      )}
    </p>
  );
}

// Which agents may use a tool, one tick per agent, first in the tool's panel because a tool no agent offers is never
// used. Ticking edits the agents' tool lists on the panel's copy.
function ToolAgents({ config, set, index }) {
  const tool = list(config?.tools)[index];
  const agents = list(config?.agents?.items).filter((a) => isObj(a) && typeof a.id === 'string');
  if (!isObj(tool) || typeof tool.id !== 'string' || !tool.id || !agents.length) return null;
  // with one agent, a tool that a page switch stands for is given and taken by that switch (asked once)
  if (agents.length === 1 && switchOf(config, tool.id)) return null;
  const toggle = (agentId, on) =>
    set({
      ...config,
      agents: {
        ...config.agents,
        items: config.agents.items.map((a) => {
          if (!isObj(a) || a.id !== agentId) return a;
          const tools = list(a.tools).filter((t) => t !== tool.id);
          return { ...a, tools: on ? [...tools, tool.id] : tools };
        }),
      },
    });
  return (
    <fieldset className="nlToolAgents">
      <legend>{agents.length > 1 ? 'Which agents can use it' : 'Can the agent use it?'}</legend>
      <div className="suChecks">
        {agents.map((a) => (
          <label key={a.id} className="suCheck">
            <input type="checkbox" checked={list(a.tools).includes(tool.id)} onChange={(event) => toggle(a.id, event.target.checked)} />
            {agentLabel(config, a.id)}
          </label>
        ))}
      </div>
      {!agents.some((a) => list(a.tools).includes(tool.id)) && <p className="nlHint">Nothing can use it until an agent is ticked.</p>}
    </fieldset>
  );
}

const hostOf = (url) => {
  try {
    return new URL(String(url).replace(/\{\{[^}]*\}\}/g, 'x')).host;
  } catch {
    return '';
  }
};
// What a tool does, in one sentence (where it passes calls, what it searches...); '' when its kind says it all.
function toolDoes(config, tool) {
  if (tool.builtin === 'transfer_or_callback') {
    const transfer = list(config?.telephony?.transfers).find((t) => isObj(t) && t.id === tool.params?.transfer);
    if (typeof transfer?.target === 'string' && transfer.target.trim()) return `It passes calls to ${transfer.target.trim()}.`;
    if (transfer && transfer.target != null && typeof transfer.target !== 'string')
      return 'The number is chosen from what the caller wants (under Phone transfers).';
    return 'No number yet: callers are offered a callback instead.';
  }
  if (tool.builtin === 'send_form' && typeof tool.params?.form === 'string') return `It shows the form “${humanize(tool.params.form)}”.`;
  if (tool.type === 'knowledge' && typeof tool.source === 'string')
    return `It searches ${tool.source === KNOWLEDGE_ID ? '“What it knows” on the Knowledge page' : `“${humanize(tool.source)}” on the Knowledge page`}.`;
  if (tool.type === 'http') {
    const conn = typeof tool.connection === 'string' && tool.connection ? tool.connection : '';
    const host = hostOf(tool.request?.url) || (conn ? hostOf(config?.connections?.[conn]?.base_url) : '');
    const verb = changesSomething(tool) ? 'sends to' : 'asks';
    if (host) return `It ${verb} ${host}${conn ? `, through the “${humanize(conn)}” connection` : ''}.`;
    return conn ? `It ${verb} the “${humanize(conn)}” connection.` : '';
  }
  return '';
}

// The top of a tool's panel: what it does, its switch on this page, and when the agent uses it (the agent reads this to
// decide, so it is asked here, not in the folded settings). Changes go on the panel's copy.
function ToolPlain({ config, set, index, problem }) {
  const tool = list(config?.tools)[index];
  if (!isObj(tool)) return null;
  const toggle = switchOf(config, tool.id);
  const does = toolDoes(config, tool);
  const description = typeof tool.description === 'string' ? tool.description : '';
  const advice = describeAdvice(description);
  const setDescription = (text) =>
    set({ ...config, tools: config.tools.map((t, i) => (i === index ? (text ? { ...t, description: text } : omit(t, 'description')) : t)) });
  // ending the call: its last line typed here, or a fixed message (changed under Fixed lines)
  const ends = tool.builtin === 'end_call';
  const say = tool.params?.say;
  const setGoodbye = (text) =>
    set({
      ...config,
      tools: config.tools.map((t, i) => {
        if (i !== index) return t;
        const params = { ...(isObj(t.params) ? t.params : {}) };
        if (text) params.say = text;
        else delete params.say;
        return Object.keys(params).length ? { ...t, params } : omit(t, 'params');
      }),
    });
  return (
    <section className="nlToolPlain" aria-label="What this tool does">
      <p>
        <strong>{plainToolKind(tool) || 'A tool'}.</strong> {does}
      </p>
      {toggle && (
        <p className="nlHint">
          {toggle.on
            ? `It is the switch “${toggle.label}” on this page: switch that off to take it away.`
            : `The switch “${toggle.label}” on this page gives it to the agent that answers.`}
          {tool.builtin === 'transfer_or_callback' && toggle.on ? ' The number is set there too.' : ''}
        </p>
      )}
      {ends &&
        (typeof say === 'string' || say === undefined ? (
          <label className="nlToolWhen">
            <span>What it says before it hangs up</span>
            <small>Said in full, then the call ends.</small>
            <textarea
              className="stFInput"
              rows={2}
              value={say || ''}
              placeholder="Thank you for calling. Goodbye!"
              onChange={(event) => setGoodbye(event.target.value)}
            />
          </label>
        ) : (
          <p className="nlHint">
            Before it hangs up it says {speechText(say, config) ? `“${speechText(say, config)}”, ` : ''}one of its fixed lines: change it on the Agent page,
            under Fixed lines.
          </p>
        ))}
      <label className="nlToolWhen">
        <span>When it uses it</span>
        <small>The agent reads this to decide when to use the tool. One or two sentences that say when.</small>
        <textarea
          className="stFInput"
          rows={3}
          value={description}
          placeholder="For example: Use when the caller asks for a person, or you can’t help them."
          aria-invalid={problem ? true : undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
        {problem ? <small className="stFieldError">{problem}</small> : advice.text && <small className={`nlToolAdvice ${advice.level}`}>{advice.text}</small>}
      </label>
    </section>
  );
}
// A check's panel top, in words: what it is, what it does on a hit, how it is enforced and which side it watches.
const CHECK_SIDE = { input: 'It reads what the caller says, before the agent answers.', output: 'It reads what the agent says, before it is spoken.' };
// A personal-details check shows its kinds as ticks (as After the call does); an unknown kind is kept, ticked, under
// its own name. The last tick stays: a check that looks for nothing finds nothing.
function CheckPlain({ config, set, path, index }) {
  const rule = list(getAtPath(config, path))[index];
  const [refused, setRefused] = useState('');
  if (!isObj(rule)) return null;
  const { then, how } = checkWords(rule);
  const entities = list(rule.entities).filter((e) => typeof e === 'string');
  const kinds = [...SENSITIVE, ...entities.filter((e) => !SENSITIVE.some(([id]) => id === e)).map((e) => [e, humanize(e)])];
  const tick = (id, on) => {
    const next = on ? [...entities, id] : entities.filter((e) => e !== id);
    if (!next.length) {
      setRefused('It needs at least one. To stop it, delete the check.');
      return;
    }
    setRefused('');
    set(
      setAtPath(
        config,
        [...path, index, 'entities'],
        kinds.map(([k]) => k).filter((k) => next.includes(k)),
      ),
    );
  };
  return (
    <section className="nlToolPlain" aria-label="What this check does">
      <p>
        <strong>{plainKind(rule.type) || 'A check'}.</strong> {CHECK_SIDE[path[1]] || ''} {then ? `When it finds something, it ${then}.` : ''}
      </p>
      {how && <p className="nlHint">{how}</p>}
      {rule.type === 'pii_detect' && (
        <fieldset className="nlToolAgents nlCheckKinds">
          <legend>What it looks for</legend>
          <div className="suChecks">
            {kinds.map(([id, label]) => (
              <label key={id} className="suCheck" title={id}>
                <input type="checkbox" checked={entities.includes(id)} onChange={(event) => tick(id, event.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          {refused && (
            <p className="nlHint warn" role="alert">
              {refused}
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}

// A hand-over or ending rule's panel top in words, with the switch that made it (once changed here, it is your own).
function RulePlain({ config, index }) {
  const rule = list(config?.guardrails?.escalation)[index];
  if (!isObj(rule)) return null;
  const moment = momentOf(rule, config);
  // an unfinished rule says what is missing, rather than a sentence about nothing
  const when = isObj(rule.when) && Object.values(rule.when).some((v) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
  const then = rule.action === 'end_call' || (rule.action === 'handoff' && rule.to) || (rule.action === 'tool' && rule.tool);
  const missing = [!when && 'when it applies (Only when)', !then && 'what it does then'].filter(Boolean);
  return (
    <section className="nlToolPlain" aria-label="What this rule does">
      <p>{missing.length ? `Not finished yet: say ${missing.join(' and ')}.` : `${ruleWords(rule, config)}.`}</p>
      {moment && (
        <p className="nlHint">
          It is the switch “{moment.label}” above: switch that off to take it away. Change what it does here and it becomes a rule of your own.
        </p>
      )}
    </section>
  );
}

// What the form leaves out: what the panel asks above it, and what doesn't apply (a tool rule isn't asked for an agent,
// nor a hand-over rule for a tool; each shows again while it is set).
function askedAbove(kind, itemPath, item) {
  if (kind === 'channels') return [[...itemPath, 'greeting', 'say']];
  if (kind === 'tools')
    return [
      [...itemPath, 'description'],
      [...itemPath, 'params', 'say'],
    ];
  if (kind === 'guardrails' && isObj(item) && item.type === 'pii_detect') return [[...itemPath, 'entities']];
  if (kind === 'escalation' && isObj(item))
    return [...(item.action !== 'handoff' && !item.to ? [[...itemPath, 'to']] : []), ...(item.action !== 'tool' && !item.tool ? [[...itemPath, 'tool']] : [])];
  return undefined;
}

const omit = (o, key) => {
  const next = { ...o };
  delete next[key];
  return next;
};

// A page listing one kind of thing (tools, channels, checks), one row each, plus an Add. A row opens a panel with that
// item's settings, edited on a copy until Done. Other sections (connections, forms...) are rows that open their form.
//   lists: [{ id, path, kind, word, title?, lead?, pickerKey, empty }]
//   extras: [{ key, title, value (a sentence), icon, status?(config, engine), start? }]
//   extras[].start: { title, text, label, make(config) }, what an empty panel offers to begin from
//   top: drawn above the lists (the setup's simple switches)
export default function ListPage({
  title,
  lead,
  editor,
  lists,
  extras = [],
  extrasTitle = 'More settings',
  footer = null,
  notice = null,
  top = null,
  onShowGreeting = null,
  rowInfo = null,
  onShowJson,
  onOpenJson,
  onShowModels,
  openRequest = null,
}) {
  const config = editor.parsed.value;
  const { schema } = useSchema();
  const { types: channelTypes } = useChannelTypes();
  const { providers } = useProviders();
  const engine = useMemo(() => (schema ? createEngine(schema) : null), [schema]);
  const [panel, setPanel] = useState(null); // { list, index, made?, extra? }
  // an item just deleted from its panel, offered back with Undo until the draft changes again
  // { label, previous, after }: `after` is the draft as the deletion left it
  const [removed, setRemoved] = useState(null);
  useEffect(() => {
    if (!removed) return;
    // the first draft other than `previous` is the one the deletion left
    if (!removed.after) {
      if (config !== removed.previous) setRemoved({ ...removed, after: config });
    } else if (config !== removed.after) setRemoved(null);
  }, [config, removed]);
  const issues = useMemo(() => groupIssues(editor.report).filter((i) => i.severity === 'error' && i.path), [editor.report]);
  const unusedSet = useMemo(() => new Set(unusedTools(config)), [config]);

  // "show me" on a problem opens the item or the section that holds it
  React.useEffect(() => {
    const path = openRequest?.path;
    if (!path) return;
    const found = lists.find((l) => l.path.every((p, i) => path[i] === p));
    if (found && typeof path[found.path.length] === 'number') setPanel({ list: found, index: path[found.path.length] });
    else {
      const extra = extras.find((e) => e.key === path[0]);
      if (extra) setPanel({ extra });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  const problemsIn = (path) => issues.filter((i) => path.every((p, n) => i.path[n] === p)).length;
  // a problem in what a tool's panel asks above its folded settings (when it uses it)
  const ownProblem = (path) => issues.some((i) => keyOfPath(i.path) === keyOfPath([...path, 'description']));

  const pickerOf = (l) => {
    if (!engine) return null;
    const listSchema = schemaAtPath(engine, schema, l.path);
    const shape = listSchema ? engine.resolveShape(listSchema, getAtPath(config, l.path)) : null;
    const rawItems = shape?.items || null;
    const items = rawItems ? engine.flatten(rawItems) : null;
    const isUnion = !!items && engine.kindOf(items) === 'union';
    const takenIds = takenIdsAt(config, l.path); // for a list of guardrails, the ids of all three lists
    const offered = pickerFor(l.pickerKey, {
      engine,
      branches: isUnion ? engine.branchesOf(items) : null,
      takenIds,
      botId: config?.meta?.id || '',
      channelTypes,
    });
    return (
      (offered && l.kind === 'tools' ? toolOptions(offered) : offered && l.kind === 'channels' ? channelOptions(offered) : offered) ||
      (rawItems
        ? [
            {
              id: 'plain',
              group: 'Add',
              label: `A new ${l.word}`,
              help: '',
              make: () => {
                const made = engine.defaultFor(rawItems);
                if (isObj(made) && 'id' in made && !made.id) made.id = uniqueId(takenIds, l.word.replace(/\s+/g, '_'));
                return made;
              },
            },
          ]
        : null)
    );
  };

  // Ending the call and passing to a person need one tool each: if one exists its panel opens, rather than adding a
  // second that nothing would use. Other kinds can sensibly be added twice.
  const ONE_OF = { end_call: 'end_call', hand_over: 'transfer_or_callback' };
  const toolOptions = (options) =>
    options.map((option) => {
      const builtin = ONE_OF[option.id];
      const at = builtin ? list(config?.tools).findIndex((t) => isObj(t) && t.type === 'builtin' && t.builtin === builtin) : -1;
      return at < 0 ? option : { ...option, help: `${option.help} It has one already: this opens it.`, existing: at };
    });
  // a channel kind it already has is marked on its card, so a second (needing its own widget or number) is deliberate
  const channelOptions = (options) =>
    options.map((option) =>
      option.type && !option.badge && list(config?.channels).some((c) => isObj(c) && c.type === option.type)
        ? { ...option, badge: 'Already added', help: `${option.help} It has one already: this adds a second.` }
        : option,
    );
  const pick = (l, option, made) =>
    option.existing !== undefined ? setPanel({ list: l, index: option.existing }) : setPanel({ list: l, index: list(getAtPath(config, l.path)).length, made });

  const renderPanel = () => {
    if (!panel) return null;
    if (panel.extra) {
      const e = panel.extra;
      return (
        <StagedDrawer key={e.key} editor={editor} title={e.title} icon={e.icon} width="wide" onClose={() => setPanel(null)}>
          {(c, s, staged) =>
            e.start && !sizeOf(c?.[e.key]) ? (
              <EmptyState
                icon={e.icon}
                title={e.start.title}
                text={e.start.text}
                action={
                  <button type="button" className="quietButton" onClick={() => s(e.start.make(c))}>
                    {e.start.label}
                  </button>
                }
              />
            ) : (
              <Suspense fallback={<Spinner label="Loading the settings" />}>
                <FormEditor editor={staged} only={[e.key]} embedded onShowJson={onShowJson} onOpenJson={onOpenJson} onShowModels={onShowModels} />
              </Suspense>
            )
          }
        </StagedDrawer>
      );
    }
    const { list: l, index, made } = panel;
    const itemPath = [...l.path, index];
    // a new channel is added as the switches add one: with the agent's first line, and for voice, speech models and the
    // recording notice
    const initial = !made
      ? undefined
      : l.kind === 'channels'
        ? (c) => addChannel(c, made, { providers })
        : l.kind === 'tools'
          ? // a new tool goes to the entry agent (its panel says so and can give it to others instead)
            (c) => offerToEntry(setAtPath(c, l.path, [...list(getAtPath(c, l.path)), made]), made?.id)
          : (c) => setAtPath(c, l.path, [...list(getAtPath(c, l.path)), made]);
    const item = made || list(getAtPath(config, l.path))[index];
    const name = isObj(item) ? rowName(l.kind, item, index, config).title : `${l.word}`;
    return (
      <StagedDrawer
        key={`${l.id}-${index}-${made ? 'new' : 'old'}`}
        editor={editor}
        title={made ? `New ${l.word}` : `${l.word[0].toUpperCase()}${l.word.slice(1)} “${name}”`}
        icon={iconFor(l.kind, item)}
        width="wide"
        initial={initial}
        onClose={() => setPanel(null)}
      >
        {(c, s, staged, { done }) => (
          <Suspense fallback={<Spinner label="Loading the settings" />}>
            {/* the greeting is asked on the Agent page, so the channel panel doesn't ask it again */}
            {l.kind === 'channels' && <GreetingNote config={c} set={s} index={index} onShowGreeting={onShowGreeting} />}
            {l.kind === 'tools' && (
              <ToolPlain
                config={c}
                set={s}
                index={index}
                problem={
                  groupIssues(staged.report || editor.report).find(
                    (i) => i.severity === 'error' && keyOfPath(i.path) === keyOfPath([...itemPath, 'description']),
                  )?.message || ''
                }
              />
            )}
            {l.kind === 'tools' && <ToolAgents config={c} set={s} index={index} />}
            {l.kind === 'guardrails' && <CheckPlain config={c} set={s} path={l.path} index={index} />}
            {l.kind === 'escalation' && <RulePlain config={c} index={index} />}
            <FormEditor
              editor={staged}
              itemPath={itemPath}
              itemWord={l.word}
              onItemGone={() => {
                if (!made) setRemoved({ label: `${l.word[0].toUpperCase()}${l.word.slice(1)} “${name}” deleted.`, previous: config });
                done();
              }}
              onShowJson={onShowJson}
              onOpenJson={onOpenJson}
              onShowModels={onShowModels}
              hide={askedAbove(l.kind, itemPath, getAtPath(c, itemPath))}
              // the tool's full settings are folded under the words above; open for a new tool (it may need them) or
              // one with something to fix
              fold={l.kind === 'tools' ? { label: 'Technical details', open: !!made || problemsIn(itemPath) > (ownProblem(itemPath) ? 1 : 0) } : null}
            />
          </Suspense>
        )}
      </StagedDrawer>
    );
  };

  const addAction =
    lists.length === 1
      ? (() => {
          const l = lists[0];
          const opts = pickerOf(l);
          return opts ? (
            <AddPicker
              what={WHAT[l.pickerKey] || `a ${l.word}`}
              intro={INTRO[l.pickerKey]}
              options={opts}
              onPick={(option, made) => pick(l, option, made)}
              // outlined: the top bar has the page's one dark button (Publish, or Save)
              className="nlAddPicker quiet"
            />
          ) : null;
        })()
      : null;

  return (
    <PageShell title={title} lead={lead} actions={addAction}>
      {removed && (
        <Notice
          kind="info"
          title={removed.label}
          actions={
            <>
              <button
                type="button"
                className="quietButton"
                onClick={() => {
                  editor.setValue(removed.previous);
                  setRemoved(null);
                }}
              >
                Undo
              </button>
              <button type="button" className="linkButton" onClick={() => setRemoved(null)}>
                Dismiss
              </button>
            </>
          }
        />
      )}
      {notice}
      {top}
      {lists.map((l) => {
        const items = list(getAtPath(config, l.path));
        const opts = lists.length > 1 ? pickerOf(l) : null;
        return (
          <Section
            key={l.id}
            title={l.title || null}
            lead={l.lead}
            action={
              opts ? (
                // one of several lists: a quieter button, since its heading says what it adds
                <AddPicker
                  what={WHAT[l.pickerKey] || `a ${l.word}`}
                  intro={INTRO[l.pickerKey]}
                  label={`Add a ${l.word}`}
                  options={opts}
                  onPick={(option, made) => pick(l, option, made)}
                  className="nlAddPicker quiet"
                />
              ) : null
            }
          >
            {items.length === 0 ? (
              <EmptyState icon={iconFor(l.kind, null)} title={l.empty.title} text={l.empty.text} />
            ) : (
              <div className="nlRows">
                {items.map((item, index) => {
                  const { title: t, hint, id } = rowName(l.kind, item, index, config);
                  const used = l.kind === 'tools' && isObj(item) && item.id ? agentsUsingTool(config, item.id) : null;
                  const problems = problemsIn([...l.path, index]);
                  // tools and checks say what they are ("Hides personal details"); checks also say what they do
                  const kindWord = !isObj(item) ? '' : l.kind === 'tools' ? plainToolKind(item) : l.kind === 'guardrails' ? plainKind(item.type) : '';
                  const checkThen = l.kind === 'guardrails' && isObj(item) ? checkWords(item).then : '';
                  const status = problems
                    ? { tone: 'bad', text: `${problems} to fix` }
                    : l.kind === 'tools' && isObj(item) && unusedSet.has(item.id)
                      ? { tone: '', text: 'Not used' }
                      : l.kind === 'channels' && isObj(item) && item.enabled === false
                        ? { tone: '', text: 'Off' }
                        : // a kind the runtime can't run yet (WhatsApp, SMS, email) says so, as its card in Add does
                          l.kind === 'channels' && isObj(item) && notRunningYet(channelTypes, item.type)
                          ? { tone: '', text: NOT_RUNNING }
                          : null;
                  // which agents use a tool, only when there are several
                  const several = list(config?.agents?.items).length > 1;
                  const usedBy = several && used && used.length ? `used by ${used.map((a) => agentLabel(config, a)).join(', ')}` : '';
                  // what the page knows about a row beyond the config (a phone line's number)
                  const extra = rowInfo && isObj(item) ? rowInfo(l.kind, item) : '';
                  // a tool names its switch above, else when it is used (its description's first sentence)
                  const toggle = l.kind === 'tools' && isObj(item) ? switchOf(config, item.id) : null;
                  const when = l.kind === 'tools' && isObj(item) ? firstSentence(item.description) : '';
                  const said = toggle?.on ? 'switched on above' : when || (checkThen ? `then it ${checkThen}` : '') || (hint && hint !== kindWord ? hint : '');
                  const sub = [kindWord, extra, said, usedBy].filter(Boolean).join(' · ');
                  return (
                    <SettingRow
                      key={index}
                      icon={iconFor(l.kind, item)}
                      title={t}
                      value={sub}
                      hint=""
                      status={status}
                      tip={id ? `Id: ${id}` : undefined}
                      onOpen={() => setPanel({ list: l, index })}
                    />
                  );
                })}
              </div>
            )}
          </Section>
        );
      })}
      {extras.length > 0 && (
        <Section title={extrasTitle}>
          <div className="nlRows">
            {extras.map((e) => {
              const n = sizeOf(config?.[e.key]);
              const problems = problemsIn([e.key]);
              return (
                <SettingRow
                  key={e.key}
                  icon={e.icon}
                  title={e.title}
                  value={e.value(config, n)}
                  status={problems ? { tone: 'bad', text: `${problems} to fix` } : e.status?.(config, engine) || null}
                  onOpen={() => setPanel({ extra: e })}
                />
              );
            })}
          </div>
        </Section>
      )}
      {footer}
      {renderPanel()}
    </PageShell>
  );
}
