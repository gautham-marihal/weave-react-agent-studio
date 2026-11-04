import React from 'react';
import { NumberInput } from '../../../form/fields.jsx';
import { TrySpeechView } from '../../../form/TryPanels.jsx';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { InlineItems } from '../Detailed.jsx';
import { speaks } from './agentPart.jsx';

// 2 · Conversation: how the agent behaves during a call (taking turns, silences, what it remembers and reacts to, how
// it reads things aloud, failing services). Gathered from Settings › Conversation flow, Reliability and the Workflow's
// state and events, all in the draft's `defaults.conversation`, `defaults.reliability`, `state` and `events`.

const C = ['defaults', 'conversation'];
const TURNS = [...C, 'turn_handling'];
const QUIET = [...C, 'inactivity'];
const R = ['defaults', 'reliability'];
const STAGES = [
  ['stt', 'Hearing'],
  ['llm', 'Thinking'],
  ['tts', 'Speaking'],
];

// One number per service (hearing, thinking, speaking), side by side: the reliability of each connection.
function PerService({ ctx, id, field, unit }) {
  return (
    <div className="dtPerService" id={id}>
      {STAGES.map(([stage, name]) => {
        const path = [...R, 'connection', stage, field];
        const value = getAtPath(ctx.config, path);
        return (
          <label key={stage}>
            <span>{name}</span>
            <NumberInput
              value={value ?? null}
              nullable
              min={0}
              onChange={(n) => ctx.set(setPath(ctx.config, path, n === null ? undefined : n))}
              aria-label={`${name}: ${field}`}
            />
            {unit && <small>{unit}</small>}
          </label>
        );
      })}
    </div>
  );
}

const nameOfRule = (rule, i) => {
  if (!rule || typeof rule !== 'object') return `Rule ${i + 1}`;
  const said = rule.say || rule.word || rule.match || rule.from || rule.pattern;
  return typeof said === 'string' && said ? said : rule.type || rule.kind || `Rule ${i + 1}`;
};
const nameOfEvent = (event, i) => (event && typeof event.on === 'string' ? event.on.replace(/_/g, ' ') : `Event ${i + 1}`);
const nameOfVar = (variable, key) => `${key}${variable?.type ? ` · ${variable.type}` : ''}${variable?.sensitive ? ' · secret' : ''}`;

export const conversationPart = {
  id: 'conversation',
  num: '2',
  title: 'Conversation',
  question: 'How does it behave during a call: taking turns, silences, what it remembers, what it reacts to. A new part, gathered from Settings and Workflow.',
  cols: [
    [
      {
        id: 'turns',
        title: 'Taking turns',
        // only a voice conversation takes turns
        waiting: (c) =>
          speaks(c.config)
            ? ''
            : 'Only for voice: how long it waits for a caller to finish and how it handles being talked over. This agent has no voice channel switched on.',
        lead: 'How long it waits before answering, and how it handles a caller who talks over it.',
        rows: [
          { id: 'wait', label: 'Wait after the caller stops', path: [...TURNS, 'endpointing', 'mode'] },
          { id: 'min', label: 'Shortest wait', unit: 'seconds', path: [...TURNS, 'endpointing', 'min_delay'] },
          { id: 'max', label: 'Longest wait', unit: 'seconds', path: [...TURNS, 'endpointing', 'max_delay'] },
          { id: 'interrupt', label: 'Callers can interrupt it', path: [...TURNS, 'interruption', 'enabled'] },
          { id: 'noticed', label: 'How interruptions are noticed', path: [...TURNS, 'interruption', 'mode'] },
          { id: 'shortest', label: 'Shortest interruption', unit: 'seconds', path: [...TURNS, 'interruption', 'min_duration'] },
          { id: 'words', label: 'Words that count as interrupting', unit: 'words', path: [...TURNS, 'interruption', 'min_words'] },
        ],
        adv: [
          { id: 'resume', label: 'Resume after a false interruption', path: [...TURNS, 'interruption', 'resume_false_interruption'] },
          { id: 'early', label: 'Start answering early', path: [...TURNS, 'preemptive_generation'] },
          { id: 'turnlimit', label: 'Longest caller turn', path: [...TURNS, 'user_turn_limit'] },
          { id: 'vad', label: 'Voice detection tuning', path: ['defaults', 'models', 'vad'] },
          { id: 'eot', label: 'End-of-turn model', path: ['defaults', 'models', 'turn_detector'] },
        ],
      },
      {
        id: 'steps',
        title: 'Tools in a row',
        rows: [
          { id: 'maxsteps', label: 'Most tool steps in a row', hint: 'Before it must answer the caller', unit: '1 to 20', path: [...C, 'max_tool_steps'] },
        ],
      },
      {
        id: 'remembers',
        title: 'What it remembers',
        lead: 'Values it keeps during a call, for tools and hand-overs to use.',
        rows: [
          {
            id: 'variables',
            label: 'Variables',
            hint: 'Kind, allowed values, can be empty, keep secret, starts as',
            errPath: ['state'],
            render: (c) => (
              <InlineItems ctx={c} id={c.id} path={['state', 'variables']} word="value" label="Variables" collection="state_vars" nameOf={nameOfVar} />
            ),
          },
        ],
      },
      {
        id: 'events',
        title: 'When something happens',
        rows: [
          {
            id: 'events',
            label: 'Events',
            hint: 'When this happens, only when, then do',
            errPath: ['events'],
            render: (c) => <InlineItems ctx={c} id={c.id} path={['events']} word="event" label="Events" nameOf={nameOfEvent} />,
          },
        ],
      },
      {
        id: 'fails',
        title: 'When a service fails',
        lead: 'If the thinking, hearing or speaking service keeps failing.',
        rows: [
          { id: 'failures', label: 'Failures before giving up', path: [...R, 'max_unrecoverable_errors'] },
          { id: 'failThen', label: 'Then', kind: 'form', path: [...R, 'on_session_error'] },
        ],
        adv: [
          { id: 'retries', label: 'Retries per service', render: (c) => <PerService ctx={c} id={c.id} field="max_retry" /> },
          { id: 'between', label: 'Wait between retries', render: (c) => <PerService ctx={c} id={c.id} field="retry_interval_s" unit="seconds" /> },
          { id: 'timeout', label: 'Timeout per service', render: (c) => <PerService ctx={c} id={c.id} field="timeout_s" unit="seconds" /> },
        ],
      },
    ],
    [
      {
        id: 'quiet',
        title: 'When the caller goes quiet',
        rows: [
          { id: 'nudge', label: 'Nudge a silent caller', path: [...QUIET, 'enabled'] },
          { id: 'clock', label: 'What counts as quiet', path: [...QUIET, 'clock'] },
          { id: 'timeout', label: 'Wait before nudging', unit: 'seconds', path: [...QUIET, 'timeout_s'] },
          { id: 'nudges', label: 'How many nudges', path: [...QUIET, 'max_nudges'] },
          { id: 'say', label: 'Things to say', kind: 'form', path: [...QUIET, 'nudges'] },
          { id: 'quietThen', label: 'Then', kind: 'form', path: [...QUIET, 'on_exhausted'] },
        ],
      },
      {
        id: 'speech',
        title: 'How the voice reads things',
        waiting: (c) => (speaks(c.config) ? '' : 'Only for voice: how numbers, dates and names are read aloud. This agent has no voice channel switched on.'),
        rows: [
          {
            id: 'rules',
            label: 'Pronunciation rules',
            hint: 'Say a word a certain way, replace text, spell out, numbers in groups, dates',
            errPath: [...C, 'speech', 'pronunciation'],
            render: (c) => (
              <InlineItems ctx={c} id={c.id} path={[...C, 'speech', 'pronunciation']} word="rule" label="Pronunciation rules" nameOf={nameOfRule} />
            ),
          },
          {
            id: 'apply',
            label: 'Which lines use them',
            path: [...C, 'speech', 'apply_to'],
            options: [
              { value: 'model', label: 'What the model says' },
              { value: 'all', label: 'Everything it says' },
            ],
          },
          // the try-out that was under these settings: what the voice would be given for a line
          { id: 'trySpeech', label: 'Try a line', tags: 'p', render: (c) => <TrySpeechView config={c.config} /> },
        ],
        adv: [{ id: 'buffer', label: 'Text held back before speaking', path: [...C, 'speech', 'buffer', 'max_hold_chars'] }],
      },
      {
        id: 'sounds',
        title: 'Sounds and the line',
        waiting: (c) =>
          speaks(c.config) ? '' : 'Only for voice: sounds while it thinks, background sound and noise. This agent has no voice channel switched on.',
        rows: [
          { id: 'thinking', label: 'Sound while it thinks', kind: 'form', path: [...C, 'sounds', 'thinking'] },
          { id: 'ambient', label: 'Background sound', kind: 'form', path: [...C, 'sounds', 'ambient'] },
          { id: 'noise', label: 'Background noise reduction', kind: 'form', path: [...C, 'noise_cancellation'] },
          { id: 'ivr', label: 'Detect automated phone menus', path: [...C, 'ivr_detection'] },
        ],
      },
    ],
  ],
};
