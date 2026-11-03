import React, { useState } from 'react';
import { TryGuardrailsView } from '../../../form/TryPanels.jsx';
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
import { SENSITIVE } from '../../blocks/afterCallModel.js';
import { setHandOver } from '../../../setup/setupActions.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { ChipList, InlineItems } from '../Detailed.jsx';
import AddItem from '../AddItem.jsx';

// 9 · Guardrails: what it must never do. Topics and the three ready-made moments are guardrailModel.js's (each a rule
// in the draft's guardrails.escalation); checks on what the caller and the agent say are guardrails.input / .output;
// limits keep their units (minutes for a call). Ready-made rules are switches; your own rules and checks sit under them.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const off = (config) => topicsOf(config).offTopic;
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

// a check's chosen card: what it looks for (personal details), what happens, how it is enforced. Each kind of check
// has its own fields (patterns for a pattern check, the words for a rule in words, no trigger action for some), so a
// row whose place the chosen check's shape in the schema doesn't have is left out: filled in, it would make it invalid.
const notInCheck = (key) => (config, ctx) => !ctx.facts(key);
const checkRows = (entry) => {
  const at = (key) => [...entry.base, ...key];
  return [
    {
      id: 'entities',
      label: 'Personal details it looks for',
      kind: 'multi',
      options: SENSITIVE.map(([value, label]) => ({ value, label })),
      hidden: notInCheck(at(['entities'])),
      get: (config) => list(getAtPath(config, at(['entities']))),
      put: (config, v) => setPath(config, at(['entities']), v),
    },
    { id: 'action', label: 'When a check triggers', hidden: notInCheck(at(['on_trigger', 'action'])), pathFor: () => at(['on_trigger', 'action']) },
    { id: 'enforce', label: 'How it is enforced', pathFor: () => at(['enforcement']) },
  ];
};
const checkAdv = (entry) => {
  const at = (key) => [...entry.base, ...key];
  return [
    { id: 'patterns', label: 'Patterns to look for', kind: 'form', hidden: notInCheck(at(['patterns'])), pathFor: () => at(['patterns']) },
    { id: 'fields', label: 'Fields to keep away', kind: 'form', hidden: notInCheck(at(['fields'])), pathFor: () => at(['fields']) },
    { id: 'statement', label: 'The rule in words', kind: 'long', rows: 2, hidden: notInCheck(at(['text'])), pathFor: () => at(['text']) },
    {
      id: 'say',
      label: 'What it says when it triggers',
      kind: 'form',
      hidden: notInCheck(at(['on_trigger', 'say'])),
      pathFor: () => at(['on_trigger', 'say']),
    },
  ];
};
const checkName = (c, i) => (isObj(c) && (c.id || c.type)) || `Check ${i + 1}`;

export const guardrailsPart = {
  id: 'guardrails',
  num: '9',
  title: 'Guardrails',
  question: 'What must it never do? Ready-made rules are switches; your own rules and checks sit right under them.',
  cols: [
    [
      {
        id: 'topics',
        title: 'Topics',
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
            put: (c, on) =>
              on ? setOffTopic(c, { strikes: 3, then: endingTools(c)[0]?.id || '', say: 'I can only help with what I’m here for.' }) : setOffTopic(c, null),
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
            label: 'What it says first',
            kind: 'text',
            disabled: (c) => !off(c),
            get: (c) => off(c)?.say,
            put: (c, say) => setOffTopic(c, { ...off(c), say }),
          },
        ],
      },
      {
        id: 'moments',
        title: 'Hand over or end the call',
        rows: [
          { id: 'frustrated', label: MOMENTS[0].label, kind: 'sw', ...moment('frustrated_to_person') },
          { id: 'manager', label: 'Pass people who ask for a manager', kind: 'sw', ...moment('asks_for_person') },
          { id: 'words', label: 'The words', hidden: (c) => !momentsOf(c).asks_for_person.on, render: (c) => <MomentWords ctx={c} id={c.id} /> },
          { id: 'abusive', label: MOMENTS[2].label, kind: 'sw', ...moment('abusive_end') },
          {
            id: 'rules',
            label: 'Your own rules',
            hint: 'Only when: what they want, words, how they feel, turns in a row, a remembered value',
            errPath: ['guardrails', 'escalation'],
            render: (c) => (
              <InlineItems
                ctx={c}
                id={c.id}
                path={['guardrails', 'escalation']}
                word="rule"
                label="Your own rules"
                // the three switches above are rules too; listed here only once changed by hand
                nameOf={(r, i) => (isObj(r) && !momentOf(r, c.config) ? r.id || `Rule ${i + 1}` : isObj(r) ? `${r.id} (a switch above)` : `Rule ${i + 1}`)}
              />
            ),
          },
        ],
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
          hint: 'Add: block words or patterns, keep secret fields away from the model, a rule in words',
          nameOf: checkName,
          renderAdd: (c) => (
            <AddItem ctx={c} path={['guardrails', 'input']} pickerKey="guardrails.input" word="check" onAdded={(key) => c.choose('input', key)} />
          ),
        },
        of: 'input',
        word: 'check',
        remove: (c, entry) =>
          c.set(
            setPath(
              c.config,
              ['guardrails', 'input'],
              list(c.config?.guardrails?.input).filter((_, i) => i !== entry.base.at(-1)),
            ),
          ),
        rowsFor: (c) => (c.chosen('input') ? checkRows(c.chosen('input')) : []),
        advFor: (c) => (c.chosen('input') ? checkAdv(c.chosen('input')) : []),
      },
      {
        id: 'output',
        title: 'Checks on what the agent says',
        rows: [
          {
            id: 'checks',
            label: 'Checks',
            hint: 'Add: block words or patterns, a rule in words',
            errPath: ['guardrails', 'output'],
            render: (c) => (
              <InlineItems ctx={c} id={c.id} path={['guardrails', 'output']} word="check" label="Checks on what the agent says" nameOf={checkName} />
            ),
          },
        ],
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
            get: (c) => limitsOf(c).say,
            put: (c, text) => setLimitSay(c, text || ''),
          },
        ],
      },
    ],
  ],
};
