import React, { useState } from 'react';
import { TryGuardrailsView } from '../../../form/TryPanels.jsx';
import Select from '../../../../ui/Select.tsx';
import { Input } from '../../../../ui/Input.tsx';
import {
  BRINGS_HAND_OVER,
  LIMITS,
  MOMENTS,
  endingTools,
  limitsOf,
  momentOf,
  momentsOf,
  setLimit,
  setLimitSay,
  setMoment,
  setMomentWords,
  setOffTopic,
  setTopics,
  topicsOf,
} from '../../blocks/guardrailModel.js';
import { sensitiveChoices } from '../../blocks/afterCallModel.js';
import { guardNotRun } from '../../blocks/guardrailModel.js';
import { setEndCall, setHandOver } from '../../../setup/setupActions.js';
import { freshId } from '../../../form/references.js';
import { agentLabel, humanize } from '../../rowNames.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { fixedLineNote, lineOf, setLine } from '../../../form/speechLine.js';

// where the off-topic line and the line said when a limit ends the call are kept
const OFF_SAY = ['guardrails', 'topics', 'on_off_topic', 'say'];
const LIMIT_SAY = ['guardrails', 'limits', 'say'];
import { ChipList } from '../Detailed.jsx';
import AddItem from '../AddItem.jsx';
import GuardrailsWorkspace from '../guardrailsWorkspace/GuardrailsWorkspace.jsx';

// 10 · Guardrails: what it must never do. Topics and the three ready-made moments are guardrailModel.js's (each a rule
// in the draft's guardrails.escalation); checks on what the caller and the agent say are guardrails.input / .output,
// each with the same rows; a rule of its own is any other escalation rule; limits keep their units (minutes for a call).
// The workspace (GuardrailsWorkspace) draws these rows as the path of one line through a call; All settings shows the
// cards below.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const off = (config) => topicsOf(config).offTopic;
// what the server keeps but does not run yet, from its own report on the draft (agent config guide 8)
const notRun = (c) => guardNotRun(c?.editor?.report?.unsupported);
// one of the three ready-made rules; one that would clash with a check can't be switched on (it says why)
const moment = (id) => ({
  get: (config) => momentsOf(config)[id].on,
  put: (config, on) => {
    const m = momentsOf(config)[id];
    if (on && !m.possible) return config;
    // a hand-over rule on an agent that can't hand over yet switches hand-over on in the same change
    const base = on && m.needsHandOver ? setHandOver(config, true) : config;
    return setMoment(base, id, on, { keywords: m.keywords });
  },
  disabled: (config) => !momentsOf(config)[id].possible && !momentsOf(config)[id].on,
  note: (config) => {
    const m = momentsOf(config)[id];
    return m.changed || (!m.possible ? m.why : m.needsHandOver && !m.on ? BRINGS_HAND_OVER : '');
  },
});

// the words that trigger "pass people who ask for a manager"; the last one can't go
function MomentWords({ ctx, id }) {
  const m = momentsOf(ctx.config).asks_for_person;
  const [refused, setRefused] = useState('');
  return (
    <>
      <ChipList
        id={id}
        label="The words"
        items={m.keywords || []}
        disabled={!m.on}
        onChange={(words) => {
          const result = setMomentWords(ctx.config, 'asks_for_person', words);
          setRefused(result.refused);
          if (!result.refused) ctx.set(result.config);
        }}
      />
      {refused && (
        <small className="stFieldError" role="alert">
          {refused}
        </small>
      )}
    </>
  );
}

const limit = (key, extra = {}) => {
  const l = LIMITS.find((x) => x.key === key);
  return {
    id: key,
    label: extra.label || l.label,
    kind: 'num',
    unit: l.unit,
    errPath: ['guardrails', 'limits', key],
    get: (config) => {
      const v = limitsOf(config).values[key];
      return v === undefined ? undefined : Number(l.toInput ? l.toInput(v) : v);
    },
    put: (config, n) => setLimit(config, key, n ?? ''),
  };
};

// A check's rows: what it looks for (personal details, patterns, fields, the rule in words), what happens when it finds
// it, how it is enforced, and its name. Each kind of check has its own fields, so a row whose place the chosen check's
// shape in the schema doesn't have is left out: filled in, it would make it invalid. The checks on what the agent says
// have the same rows, named with "Out" so no two rows of the part share a name.
const notInCheck = (key) => (config, ctx) => !ctx.facts(key);
const checkRows = (entry, sfx = '') => {
  const at = (key) => [...entry.base, ...key];
  return [
    {
      id: `entities${sfx}`,
      label: 'Personal details it looks for',
      kind: 'multi',
      options: (config, ctx) => sensitiveChoices(ctx?.redactionKinds),
      hidden: notInCheck(at(['entities'])),
      errPath: at(['entities']),
      get: (config) => list(getAtPath(config, at(['entities']))),
      put: (config, v) => setPath(config, at(['entities']), v),
    },
    // a pattern can hold a comma (\d{2,4}), so not the chip list, which splits on commas
    { id: `patterns${sfx}`, label: 'Patterns to look for', kind: 'form', hidden: notInCheck(at(['patterns'])), pathFor: () => at(['patterns']) },
    { id: `fields${sfx}`, label: 'Fields to keep out', kind: 'list', hidden: notInCheck(at(['fields'])), pathFor: () => at(['fields']) },
    { id: `statement${sfx}`, label: 'The rule in words', kind: 'long', rows: 2, hidden: notInCheck(at(['text'])), pathFor: () => at(['text']) },
    { id: `action${sfx}`, label: 'When a check triggers', hidden: notInCheck(at(['on_trigger', 'action'])), pathFor: () => at(['on_trigger', 'action']) },
    { id: `enforce${sfx}`, label: 'How it is enforced', pathFor: () => at(['enforcement']) },
  ];
};
const checkAdv = (entry, sfx = '') => {
  const at = (key) => [...entry.base, ...key];
  return [
    {
      id: `checkSay${sfx}`,
      label: 'What it says when it triggers',
      kind: 'form',
      hidden: notInCheck(at(['on_trigger', 'say'])),
      pathFor: () => at(['on_trigger', 'say']),
    },
    { id: `name${sfx}`, label: 'Its name', hint: 'How the call log names it when it triggers', kind: 'text', pathFor: () => at(['id']) },
  ];
};
const checkName = (c, i) => (isObj(c) && (c.id || c.type)) || `Check ${i + 1}`;
const removeAt = (where) => (c, entry) =>
  c.set(
    setPath(
      c.config,
      ['guardrails', where],
      list(c.config?.guardrails?.[where]).filter((_, i) => i !== entry.base.at(-1)),
    ),
  );

// ---- a rule of its own: every escalation rule that isn't one of the three switches
export const ruleEntries = (config) =>
  list(config?.guardrails?.escalation)
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isObj(r) && !momentOf(r, config))
    .map(({ r, i }) => ({
      key: typeof r.id === 'string' && r.id ? r.id : String(i),
      name: r.id || `Rule ${i + 1}`,
      base: ['guardrails', 'escalation', i],
      item: r,
    }));
// the ids already taken: checks and rules share one set on the server
const takenIds = (config) => ['input', 'output', 'escalation'].flatMap((k) => list(config?.guardrails?.[k]).map((x) => x?.id));
const transferTool = (config) => list(config?.tools).find((t) => isObj(t) && t.builtin === 'transfer_or_callback' && t.id)?.id || '';
// a new rule passes the caller to a person (or ends the call when nobody can take them); when is for the person to say
export function newRule(config) {
  const id = freshId(takenIds(config), 'rule');
  const tool = transferTool(config);
  const rule = { id, when: {}, ...(tool ? { action: 'tool', tool } : { action: 'end_call' }) };
  const g = isObj(config?.guardrails) ? config.guardrails : {};
  return { config: setPath(config, ['guardrails', 'escalation'], [...list(g.escalation), rule]), key: id };
}
const FEELS = [
  { value: 'any', label: 'Any' },
  { value: 'frustrated', label: 'Frustrated' },
  { value: 'negative', label: 'Unhappy' },
  { value: 'abusive', label: 'Abusive' },
];
const COMPARES = [
  { value: 'equals', label: 'is' },
  { value: 'gte', label: 'is at least' },
  { value: 'lte', label: 'is at most' },
];
// what a typed value is: a number, true or false, else the words
const valueOf = (typed, numeric) => {
  const t = String(typed).trim();
  if (t === '') return undefined;
  if (numeric) return Number.isFinite(Number(t)) ? Number(t) : undefined;
  if (t === 'true' || t === 'false') return t === 'true';
  return Number.isFinite(Number(t)) ? Number(t) : t;
};
function CompareEditor({ ctx, entry, id }) {
  const at = (k) => [...entry.base, 'when', k];
  const when = isObj(getAtPath(ctx.config, [...entry.base, 'when'])) ? getAtPath(ctx.config, [...entry.base, 'when']) : {};
  const op = COMPARES.find((c) => when[c.value] !== undefined)?.value || 'equals';
  const current = when[op];
  const [typed, setTyped] = useState(current === undefined ? '' : String(current));
  // another rule chosen (All settings keeps this row as the choice changes): its own value, never the last rule's
  const [forRule, setForRule] = useState(entry.key);
  if (forRule !== entry.key) {
    setForRule(entry.key);
    setTyped(current === undefined ? '' : String(current));
  }
  const write = (nextOp, text) => {
    let next = ctx.config;
    COMPARES.forEach((c) => {
      if (getAtPath(next, at(c.value)) !== undefined) next = setPath(next, at(c.value), undefined);
    });
    const v = valueOf(text, nextOp !== 'equals');
    ctx.set(v === undefined ? next : setPath(next, at(nextOp), v));
  };
  return (
    <span className="dtInline grCompare">
      <Select className="stFInput" value={op} aria-label="How it compares" onChange={(event) => write(event.target.value, typed)}>
        {COMPARES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <Input
        id={id}
        value={typed}
        placeholder={op === 'equals' ? 'a value, such as true or 3' : 'a number'}
        onChange={(event) => {
          setTyped(event.target.value);
          write(op, event.target.value);
        }}
      />
    </span>
  );
}
// what the rule does: pass them to a person, to another agent, end the call, or run a tool
const thenOf = (rule, config) => {
  if (rule?.action === 'handoff') return 'agent';
  if (rule?.action === 'end_call') return 'end';
  const tool = list(config?.tools).find((t) => isObj(t) && t.id === rule?.tool);
  return tool?.builtin === 'transfer_or_callback' ? 'person' : 'tool';
};
const otherTools = (config) => list(config?.tools).filter((t) => isObj(t) && t.id && t.builtin !== 'transfer_or_callback');
const otherAgents = (config) => list(config?.agents?.items).filter((a) => isObj(a) && a.id);
const ruleRows = (entry) => {
  const at = (key) => [...entry.base, ...key];
  const item = (key, row) => ({
    ...row,
    pathFor: () => at(key),
    get: (config) => getAtPath(config, at(key)),
    put: (config, v) => setPath(config, at(key), v === '' || (Array.isArray(v) && !v.length) ? undefined : v),
  });
  const rule = (config) => getAtPath(config, entry.base) || {};
  const setRule = (config, change) => setPath(config, entry.base, change({ ...rule(config) }));
  return [
    item(['when', 'intent'], { id: 'ruleIntent', label: 'What they want', hint: 'A name for what the caller wants, such as asks_for_human', kind: 'text' }),
    item(['when', 'keywords'], { id: 'ruleWords', label: 'Words they say', kind: 'list' }),
    {
      id: 'ruleFeel',
      label: 'How they feel',
      kind: 'ch',
      options: FEELS,
      errPath: at(['when']),
      get: (config) => getAtPath(config, at(['when', 'sentiment'])) || 'any',
      put: (config, v) => setPath(config, at(['when', 'sentiment']), v === 'any' ? undefined : v),
    },
    item(['when', 'state'], {
      id: 'ruleState',
      label: 'A value it remembers',
      hint: 'From Conversation › What it remembers',
      kind: 'pick',
      placeholder: 'None',
      options: (config) => Object.keys(isObj(config?.state?.variables) ? config.state.variables : {}).map((k) => ({ value: k, label: k })),
    }),
    {
      id: 'ruleCompare',
      label: 'When that value',
      hidden: (config) => !getAtPath(config, at(['when', 'state'])),
      render: (c) => <CompareEditor ctx={c} entry={entry} id={c.id} />,
    },
    {
      id: 'ruleThen',
      label: 'Then it',
      kind: 'ch',
      errPath: at(['action']),
      options: (config) => [
        { value: 'person', label: 'Passes them to a person' },
        ...(otherAgents(config).length > 1 ? [{ value: 'agent', label: 'Passes them to another agent' }] : []),
        { value: 'end', label: 'Ends the call' },
        ...(otherTools(config).length ? [{ value: 'tool', label: 'Runs a tool' }] : []),
      ],
      get: (config) => thenOf(rule(config), config),
      put: (config, v) => {
        if (v === 'person') {
          // nobody to pass to yet: "Pass to a person" is switched on, as the ready-made rules do
          const base = transferTool(config) ? config : setHandOver(config, true);
          return setPath(base, entry.base, { ...rule(base), action: 'tool', tool: transferTool(base), to: undefined });
        }
        if (v === 'agent') return setRule(config, (r) => ({ ...r, action: 'handoff', to: otherAgents(config)[0]?.id, tool: undefined }));
        if (v === 'end') return setRule(config, (r) => ({ ...r, action: 'end_call', tool: undefined, to: undefined }));
        return setRule(config, (r) => ({ ...r, action: 'tool', tool: otherTools(config)[0]?.id, to: undefined }));
      },
    },
    {
      id: 'ruleUsing',
      label: 'Using',
      kind: 'pick',
      errPath: at(['tool']),
      hidden: (config) => !['agent', 'tool'].includes(thenOf(rule(config), config)),
      options: (config) =>
        thenOf(rule(config), config) === 'agent'
          ? otherAgents(config).map((a) => ({ value: a.id, label: agentLabel(config, a.id) }))
          : otherTools(config).map((t) => ({ value: t.id, label: humanize(t.id) })),
      get: (config) => (thenOf(rule(config), config) === 'agent' ? rule(config).to : rule(config).tool),
      put: (config, v) => setRule(config, (r) => (r.action === 'handoff' ? { ...r, to: v } : { ...r, tool: v })),
    },
    { id: 'ruleSay', label: 'It says first', kind: 'form', pathFor: () => at(['say']) },
  ];
};
const ruleAdv = (entry) => {
  const at = (key) => [...entry.base, ...key];
  return [
    {
      id: 'ruleTurns',
      label: 'Turns in a row',
      hint: 'How many turns in a row it must hold before the rule acts',
      kind: 'num',
      integer: true,
      min: 1,
      pathFor: () => at(['when', 'consecutive_turns']),
    },
    { id: 'ruleName', label: 'Its name', kind: 'text', pathFor: () => at(['id']) },
  ];
};

export const guardrailsForm = {
  id: 'guardrails',
  num: '10',
  title: 'Guardrails',
  question: 'What it must never do: the checks on what is said, the topics it keeps to, when it hands over or ends, and its limits.',
  cols: [
    [
      {
        id: 'topics',
        title: 'Topics',
        lead: (c) =>
          notRun(c).topics
            ? 'Not run yet: the server keeps these topic settings but does not act on them, so nothing is turned away for being off topic. Say it in the instructions meanwhile.'
            : '',
        rows: [
          {
            id: 'allowed',
            label: 'What it talks about',
            kind: 'list',
            errPath: ['guardrails', 'topics'],
            get: (c) => topicsOf(c).allowed,
            put: (c, v) => setTopics(c, 'allowed', v),
          },
          { id: 'blocked', label: 'What it must not talk about', kind: 'list', get: (c) => topicsOf(c).blocked, put: (c, v) => setTopics(c, 'blocked', v) },
          {
            id: 'offtopic',
            label: 'When someone keeps going off topic',
            kind: 'sw',
            get: (c) => !!off(c),
            // the rule needs something to do once the tries are used up: with no tool at all, ending the call politely
            // is switched on with it (switching on did nothing before)
            note: (c) =>
              !off(c) && !endingTools(c).length ? 'Switching it on also switches on “End the call politely” on Tools, to do once the tries are used up.' : '',
            put: (c, on) => {
              if (!on) return setOffTopic(c, null);
              const base = endingTools(c).length ? c : setEndCall(c, true);
              return setOffTopic(base, { strikes: 3, then: endingTools(base)[0]?.id || '', say: 'I can only help with what I’m here for.' });
            },
          },
          {
            id: 'strikes',
            label: 'After how many tries',
            tags: 'r',
            kind: 'num',
            integer: true,
            min: 1,
            nullable: false,
            disabled: (c) => !off(c),
            get: (c) => off(c)?.strikes,
            put: (c, n) => setOffTopic(c, { ...off(c), strikes: n ?? 1 }),
          },
          {
            id: 'then',
            label: 'Then',
            tags: 'r',
            kind: 'pick',
            disabled: (c) => !off(c),
            // the tools on the Tools part that can end or pass on the conversation
            options: (c) => endingTools(c).map((t) => ({ value: t.id, label: t.label })),
            get: (c) => off(c)?.then,
            put: (c, then) => setOffTopic(c, { ...off(c), then }),
          },
          {
            id: 'say',
            label: 'What it says each time',
            kind: 'text',
            disabled: (c) => !off(c),
            // a fixed line ({ message }) shows its words and changes in place, so the rule keeps pointing at it
            note: (c) => fixedLineNote(c, getAtPath(c, OFF_SAY)),
            get: (c) => (off(c) ? lineOf(c, getAtPath(c, OFF_SAY)).text : ''),
            put: (c, say) => (say && lineOf(c, getAtPath(c, OFF_SAY)).at >= 0 ? setLine(c, OFF_SAY, say) : setOffTopic(c, { ...off(c), say, sayRef: '' })),
          },
        ],
      },
      {
        id: 'moments',
        title: 'Hand over or end the call',
        lead: (c) =>
          notRun(c).escalation
            ? 'Not run yet: the server keeps these rules but does not act on them, so no caller is passed on or cut off by them. Call limits do run.'
            : '',
        rows: [
          { id: 'frustrated', label: MOMENTS[0].label, kind: 'sw', ...moment('frustrated_to_person') },
          { id: 'manager', label: 'Pass people who ask for a manager', kind: 'sw', ...moment('asks_for_person') },
          { id: 'words', label: 'The words', hidden: (c) => !momentsOf(c).asks_for_person.on, render: (c) => <MomentWords ctx={c} id={c.id} /> },
          { id: 'abusive', label: MOMENTS[2].label, kind: 'sw', ...moment('abusive_end') },
        ],
      },
      {
        id: 'rule',
        title: 'Rules of its own',
        lead: (c) =>
          notRun(c).escalation
            ? 'Not run yet: the server keeps these rules but does not act on them. Meanwhile, say it in the instructions.'
            : 'Rules that act whatever the model decides: when the caller wants something, says certain words, sounds a certain way, or it remembers a value.',
        list: {
          id: 'rules',
          path: ['guardrails', 'escalation'],
          label: 'Rules',
          word: 'rule',
          entries: ruleEntries,
          add: newRule,
        },
        of: 'rules',
        word: 'rule',
        empty: 'None yet.',
        remove: (c, entry) =>
          c.set(
            setPath(
              c.config,
              ['guardrails', 'escalation'],
              list(c.config?.guardrails?.escalation).filter((_, i) => i !== entry.base.at(-1)),
            ),
          ),
        rowsFor: (c) => (c.chosen('rules') ? ruleRows(c.chosen('rules')) : []),
        advFor: (c) => (c.chosen('rules') ? ruleAdv(c.chosen('rules')) : []),
      },
      {
        id: 'try',
        title: 'Try the checks',
        rows: [{ id: 'try', label: 'A line a caller might say', tags: 'p', render: (c) => <TryGuardrailsView config={c.config} /> }],
      },
    ],
    [
      {
        id: 'input',
        title: 'Checks on what the caller says',
        list: {
          id: 'input',
          path: ['guardrails', 'input'],
          label: 'Checks',
          hint: 'Add: refuse tricks, hide personal details, block words or patterns, keep secret fields away from the model, a rule in words',
          nameOf: checkName,
          renderAdd: (c) => (
            <AddItem ctx={c} path={['guardrails', 'input']} pickerKey="guardrails.input" word="check" onAdded={(key) => c.choose('input', key)} />
          ),
        },
        of: 'input',
        word: 'check',
        remove: removeAt('input'),
        rowsFor: (c) => (c.chosen('input') ? checkRows(c.chosen('input')) : []),
        advFor: (c) => (c.chosen('input') ? checkAdv(c.chosen('input')) : []),
      },
      {
        id: 'output',
        title: 'Checks on what the agent says',
        lead: (c) => {
          const n = notRun(c).output.length;
          return n
            ? `Not run yet: ${n === 1 ? 'one check here is' : `${n} checks here are`} kept but not acted on by the server. A rule in words is told to the model and does apply.`
            : '';
        },
        list: {
          id: 'output',
          path: ['guardrails', 'output'],
          label: 'Checks',
          hint: 'Add: a rule in words, keep secret fields out, hide personal details, block words or patterns',
          nameOf: checkName,
          renderAdd: (c) => (
            <AddItem ctx={c} path={['guardrails', 'output']} pickerKey="guardrails.output" word="check" onAdded={(key) => c.choose('output', key)} />
          ),
        },
        of: 'output',
        word: 'check',
        remove: removeAt('output'),
        rowsFor: (c) => (c.chosen('output') ? checkRows(c.chosen('output'), 'Out') : []),
        advFor: (c) => (c.chosen('output') ? checkAdv(c.chosen('output'), 'Out') : []),
      },
      {
        id: 'limits',
        title: 'Limits',
        lead: 'Empty means no limit.',
        rows: [
          limit('max_call_duration_s'),
          limit('max_silence_s'),
          limit('max_tool_calls_per_call', { label: 'Most tool uses in one call' }),
          {
            id: 'limitSay',
            label: 'What it says when a limit ends the call',
            kind: 'text',
            note: (c) => fixedLineNote(c, getAtPath(c, LIMIT_SAY)),
            get: (c) => lineOf(c, getAtPath(c, LIMIT_SAY)).text,
            put: (c, text) => (text && lineOf(c, getAtPath(c, LIMIT_SAY)).at >= 0 ? setLine(c, LIMIT_SAY, text) : setLimitSay(c, text || '')),
          },
        ],
      },
    ],
  ],
};

export const guardrailsPart = { ...guardrailsForm, render: (ctx) => <GuardrailsWorkspace ctx={ctx} form={guardrailsForm} /> };
