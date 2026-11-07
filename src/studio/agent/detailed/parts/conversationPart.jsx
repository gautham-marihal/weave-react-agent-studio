import React from 'react';
import { TrySpeechView } from '../../../form/TryPanels.jsx';
import { ruleWords } from '../../../form/tryPanels.js';
import { getAtPath } from '../../schemaPath.js';
import { InlineItems } from '../Detailed.jsx';
import { notRunAt } from '../../../preflight.ts';
import { speaks } from './agentPart.jsx';
import ConversationWorkspace from '../conversationView/ConversationWorkspace.jsx';
import { QuietScript, RetryGrid, WaitChoice } from '../conversationView/conversationEditors.jsx';
import RememberSheet from '../conversationView/RememberSheet.jsx';
import { C, INTERRUPTION, QUIET, R, TURNS, eventName, readQuiet, setQuietOn } from '../conversationView/conversationWords.js';

// 2 · Conversation: how the agent behaves during a call (taking turns, quiet callers, how it sounds, what it remembers
// and reacts to, failing services). Gathered from Settings › Conversation flow, Reliability and the Workflow's state and
// events, all in the draft's `defaults.conversation`, `defaults.reliability`, `state` and `events`.
// Drawn as a call you can see (conversationView/ConversationWorkspace.jsx); these cards are its rows and All settings.

const nameOfRule = (rule, i) => {
  if (!rule || typeof rule !== 'object') return `Rule ${i + 1}`;
  const said = rule.say || rule.word || rule.match || rule.from || rule.pattern;
  if (typeof said === 'string' && said) return said;
  // no words of its own: what it does, in words ("A word list · 3 words"), not its kind in the file
  const words = ruleWords(rule.type || rule.kind);
  const count = Array.isArray(rule.entries) ? ` · ${rule.entries.length} word${rule.entries.length === 1 ? '' : 's'}` : '';
  return rule.type || rule.kind ? `${words.replace(/^./, (c) => c.toUpperCase())}${count}` : `Rule ${i + 1}`;
};
// a reaction by what starts it, in words ("A detail changes")
const nameOfEvent = (event, i) => (event && typeof event.on === 'string' ? eventName(event.on) : `Reaction ${i + 1}`);

const voiceOnly = (what) => (c) => (speaks(c.config) ? '' : `Only for voice: ${what}. This agent has no voice channel switched on.`);

// Every setting of the part, as cards of rows: what All settings shows, and the rows the overview opens.
export const conversationForm = {
  id: 'conversation',
  num: '2',
  title: 'Conversation',
  question: 'How a call goes: taking turns, quiet callers, how it sounds, and what happens behind the scenes.',
  cols: [
    [
      {
        id: 'turns',
        title: 'Taking turns',
        // only a voice conversation takes turns
        waiting: voiceOnly('how long it waits for a caller to finish and what happens when they cut in'),
        lead: 'How long it waits before answering, and what happens when a caller cuts in.',
        rows: [
          {
            id: 'wait',
            label: 'How long it waits',
            hint: 'After the caller stops talking, before it answers: quick, usual or patient',
            wide: true,
            errPath: [...TURNS, 'endpointing'],
            render: (c) => <WaitChoice {...c} />,
          },
          { id: 'min', label: 'Answer no sooner than', unit: 'seconds', path: [...TURNS, 'endpointing', 'min_delay'] },
          { id: 'max', label: 'Answer no later than', unit: 'seconds', path: [...TURNS, 'endpointing', 'max_delay'] },
          // on unless switched off (the engine's usual), so an unset switch shows on
          {
            id: 'interrupt',
            label: 'Callers can cut in',
            hint: 'It stops talking and listens.',
            path: [...INTERRUPTION, 'enabled'],
            get: (config) => getAtPath(config, [...INTERRUPTION, 'enabled']) !== false,
          },
          {
            id: 'shortest',
            label: 'It counts as cutting in after',
            hint: 'So a short “mm-hm” doesn’t stop it. Empty is the usual.',
            unit: 'seconds of speech',
            path: [...INTERRUPTION, 'min_duration'],
          },
          { id: 'words', label: 'And at least', hint: 'Empty or 0: any speech counts.', unit: 'words', path: [...INTERRUPTION, 'min_words'] },
          {
            id: 'resume',
            label: 'If it was only a cough, carry on',
            hint: 'It picks up what it was saying. On unless switched off.',
            path: [...INTERRUPTION, 'resume_false_interruption'],
            get: (config) => getAtPath(config, [...INTERRUPTION, 'resume_false_interruption']) !== false,
          },
          {
            id: 'resumeAfter',
            label: 'Carry on after',
            hint: 'Empty is the usual, 2 seconds.',
            unit: 'seconds',
            hidden: (config) => getAtPath(config, [...INTERRUPTION, 'resume_false_interruption']) === false,
            path: [...INTERRUPTION, 'false_interruption_timeout'],
          },
          {
            id: 'noticed',
            label: 'Notice cutting in with',
            path: [...INTERRUPTION, 'mode'],
            options: [
              { value: 'vad', label: 'Simple voice detection' },
              { value: 'adaptive', label: 'Smarter detection (LiveKit Cloud only)' },
            ],
          },
          {
            id: 'fixed',
            label: 'Lines that can’t be cut off',
            kind: 'note',
            text: 'A line that must be heard in full, such as a goodbye or a safety warning, is set on the line itself: Agent › Fixed lines.',
          },
        ],
        adv: [
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
        rows: [
          {
            id: 'variables',
            label: 'Details',
            hint: 'Kind, how it starts, kept secret',
            wide: true,
            errPath: ['state'],
            render: (c) => <RememberSheet {...c} />,
          },
        ],
      },
      {
        id: 'events',
        title: 'What it reacts to',
        lead: 'Steps that run on their own, beside the conversation. Most agents need none.',
        rows: [
          {
            id: 'events',
            label: 'Reactions',
            hint: 'When this happens, only when, then do',
            errPath: ['events'],
            render: (c) => <InlineItems ctx={c} id={c.id} path={['events']} word="reaction" label="Reactions" nameOf={nameOfEvent} />,
          },
        ],
      },
      {
        id: 'fails',
        title: 'When a service fails',
        lead: 'If hearing, thinking or speaking keeps failing. Each one retries on its own first.',
        rows: [
          { id: 'failures', label: 'Close the call after', unit: 'failures in a row', path: [...R, 'max_unrecoverable_errors'] },
          {
            id: 'failThen',
            label: 'As the call closes',
            hint: 'It can’t speak then (the voice may be what failed): play a recording, call a web address or write to the log.',
            kind: 'form',
            path: [...R, 'on_session_error'],
          },
        ],
        adv: [
          {
            id: 'retries',
            label: 'Retries per service',
            hint: 'Tries again, the gap between tries, and when it gives up',
            wide: true,
            render: (c) => <RetryGrid {...c} />,
          },
        ],
      },
    ],
    [
      {
        id: 'quiet',
        title: 'When someone goes quiet',
        rows: [
          // switched on with nothing set up yet, it sets up the usual script (two check-ins, then a goodbye)
          {
            id: 'nudge',
            label: 'Check in when someone goes quiet',
            hint: 'A short “are you still there?”, a few times, before it closes.',
            path: [...QUIET, 'enabled'],
            // read as the sentence and the script above it read it (readQuiet): a script with no `enabled` counts as on
            get: (config) => readQuiet(config).state === 'on',
            put: (config, on) => setQuietOn(config, on, speaks(config)),
          },
          {
            id: 'clock',
            label: 'Count quiet time',
            hint: 'Automatic: on calls, while both sides are quiet (paused while a tool runs); in chat, since the last message.',
            path: [...QUIET, 'clock'],
            options: [
              { value: 'auto', label: 'Automatic' },
              { value: 'silence', label: 'While both sides are quiet' },
              { value: 'user_activity', label: 'Since their last message' },
            ],
          },
          {
            id: 'script',
            label: 'The script',
            hint: 'How long it waits, the check-ins it says, and what happens then',
            wide: true,
            errPath: QUIET,
            hidden: (config) => getAtPath(config, [...QUIET, 'enabled']) === false,
            render: (c) => <QuietScript {...c} />,
          },
        ],
      },
      {
        id: 'speech',
        title: 'How the voice reads things',
        waiting: voiceOnly('how numbers, dates and names are read aloud'),
        rows: [
          {
            id: 'rules',
            label: 'Say it like',
            hint: 'Rules run in order on what the voice says: money, times, dates, long numbers, spell out, find and replace, a word list. The chat transcript keeps the words as written.',
            errPath: [...C, 'speech', 'pronunciation'],
            render: (c) => (
              <InlineItems ctx={c} id={c.id} path={[...C, 'speech', 'pronunciation']} word="rule" label="Pronunciation rules" nameOf={nameOfRule} />
            ),
          },
          {
            id: 'apply',
            label: 'Use the rules for',
            path: [...C, 'speech', 'apply_to'],
            options: [
              { value: 'model', label: 'What the AI writes' },
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
        // the server reports the sounds as one block, above the two rows (agent config guide 8)
        lead: (c) =>
          notRunAt(c?.editor?.report?.unsupported, [...C, 'sounds'])
            ? 'Not run yet: the server keeps the sound while it thinks and the background sound, but does not play them.'
            : '',
        waiting: voiceOnly('sounds while it thinks, background sound and noise'),
        rows: [
          { id: 'thinking', label: 'Sound while it thinks', kind: 'form', path: [...C, 'sounds', 'thinking'] },
          { id: 'ambient', label: 'Background sound', kind: 'form', path: [...C, 'sounds', 'ambient'] },
          {
            id: 'noise',
            label: 'Noise reduction',
            hint: 'Needs LiveKit Cloud; the phone channel switches it on.',
            kind: 'form',
            path: [...C, 'noise_cancellation'],
          },
          { id: 'ivr', label: 'Listen for phone menus', hint: 'For calls that might reach a machine instead of a person.', path: [...C, 'ivr_detection'] },
        ],
      },
    ],
  ],
};

// Build › Conversation: a call you can see, or every setting at once (conversationView/), both from conversationForm.
export const conversationPart = { ...conversationForm, render: (ctx) => <ConversationWorkspace ctx={ctx} form={conversationForm} /> };
