// Build's Guided view as nine steps: what each asks, and where the draft stands on it in a few words (the rail, the
// "Your agent so far" card and the last step's list). Pure: no React, no DOM.

import { languageName, readSimple } from '../../simple/simpleModel.js';
import { readModels } from '../../models/config.js';
import { voiceInUse } from '../pickers/pickerLogic.js';
import { REACH, actionsOf, reachOf } from '../../setup/setupModel.js';
import { knowledgeOf } from '../../setup/setupKnowledge.js';
import { momentsOf, topicsOf } from '../blocks/guardrailModel.js';
import { afterCallOf } from '../blocks/afterCallModel.js';
import { agentLabel } from '../rowNames.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const words = (text) => (String(text || '').match(/\S+/g) || []).length;
const lower = (text) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
const upper = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const first = (tone) =>
  String(tone || '')
    .split(',')
    .slice(0, 2)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');

// The steps in order. `page`: the Detailed part holding all of its settings; `optional`: it may be left as it is.
export const GUIDED_STEPS = [
  {
    id: 'who',
    page: 'agent',
    title: 'Who it is',
    question: 'Who is your agent?',
    lead: 'Its name, who it works for, how it sounds and what it should do. This shapes every reply.',
  },
  {
    id: 'voice',
    page: 'agent',
    title: 'Language and voice',
    question: 'How does it speak?',
    lead: 'The language it answers in first, and the voice people hear on a call.',
  },
  {
    id: 'knowledge',
    page: 'knowledge',
    title: 'What it knows',
    question: 'What should it know?',
    lead: 'The documents and web pages it answers from. Without them it answers from its instructions only.',
    optional: true,
  },
  {
    id: 'tools',
    page: 'tools',
    title: 'What it can do',
    question: 'What can it do besides talk?',
    lead: 'End a conversation, pass someone to your team, take a request or look something up.',
    optional: true,
  },
  {
    id: 'channels',
    page: 'channels',
    title: 'Where people reach it',
    question: 'Where do people reach it?',
    lead: 'By chat or by talking on your website, or by phone. Switch on one at least.',
  },
  {
    id: 'workflow',
    page: 'subagents',
    title: 'How a conversation moves',
    question: 'Who answers, and who takes over?',
    lead: 'One agent for everything, or a first one that passes people to specialists.',
  },
  {
    id: 'guardrails',
    page: 'guardrails',
    title: 'Its boundaries',
    question: 'What must it never do?',
    lead: 'Keep it on topic, and decide when it passes someone to your team or ends a call.',
    optional: true,
  },
  {
    id: 'aftercall',
    page: 'aftercall',
    title: 'After the call',
    question: 'What happens after a call?',
    lead: 'A note of every call, answers to your own questions, and what is kept.',
    optional: true,
  },
  { id: 'ready', page: '', title: 'Ready to try', question: 'Ready to try', lead: '' },
];
export const GUIDED_IDS = GUIDED_STEPS.map((s) => s.id);

// The agent's voice in a word: the catalogue name, or that one is set from the person's own account
function voiceName(config) {
  const tts = readModels(config).tts;
  if (!tts?.voiceId) return '';
  return voiceInUse(tts)?.name || 'Its own voice';
}

// What it can do, in words: "Ends calls · passes to a person"
export function canWords(config) {
  const on = actionsOf(config);
  return [on.end_call.on && 'ends calls', on.hand_over.on && 'passes to a person', on.details.on && 'takes requests', on.lookup.on && 'looks things up'].filter(
    Boolean,
  );
}

// Where people reach it, in words: the switches' names, then any other channel counted
export function reachWords(config) {
  const on = reachOf(config);
  const named = REACH.filter((r) => on[r.type]).map((r) => r.label);
  const others = list(config?.channels).filter((c) => isObj(c) && c.enabled !== false && !(c.type in on)).length;
  return [...named, others ? plural(others, 'other channel') : ''].filter(Boolean);
}

// -> { state: 'done' | 'todo' | 'optional', answer, todo? } for one step. `todo`: what is missing, as a task
function stepState(id, config) {
  const read = readSimple(config);
  switch (id) {
    case 'who': {
      const missing = [words(read.role) < 8 && 'what it should do', !read.greeting && 'what it says first'].filter(Boolean);
      const who = [read.persona || read.name, first(read.tone)].filter(Boolean).join(' · ');
      if (missing.length) return { state: 'todo', answer: `Still to write: ${missing.join(' and ')}`, todo: `Write ${missing.join(' and ')}` };
      return { state: 'done', answer: who || 'Its instructions are written' };
    }
    case 'voice': {
      if (!read.primaryLanguage) return { state: 'todo', answer: 'No main language yet', todo: 'Choose its main language' };
      const voice = voiceName(config);
      if (read.voiceChannel && !voice) return { state: 'todo', answer: `${languageName(read.primaryLanguage)} · no voice yet`, todo: 'Choose its voice' };
      return { state: 'done', answer: [languageName(read.primaryLanguage), read.voiceChannel ? voice : 'types only'].join(' · ') };
    }
    case 'knowledge': {
      const { files, pages } = knowledgeOf(config);
      const own = list(config?.knowledge).filter((b) => isObj(b) && b.id !== 'knowledge').length;
      const what = [
        files.length && plural(files.length, 'document'),
        pages.length && plural(pages.length, 'web page'),
        own && plural(own, 'knowledge base'),
      ].filter(Boolean);
      return what.length ? { state: 'done', answer: what.join(' · ') } : { state: 'optional', answer: 'No documents · optional' };
    }
    case 'tools': {
      const can = canWords(config);
      return can.length ? { state: 'done', answer: upper(can.join(' · ')) } : { state: 'optional', answer: 'It only talks · optional' };
    }
    case 'channels': {
      const reach = reachWords(config);
      return reach.length
        ? { state: 'done', answer: [reach[0], ...reach.slice(1).map(lower)].join(' · ') }
        : { state: 'todo', answer: 'Nowhere yet', todo: 'Switch on a way to reach it' };
    }
    case 'workflow': {
      const agents = list(config?.agents?.items).filter(isObj);
      if (agents.length <= 1) return { state: 'done', answer: 'One agent answers everything' };
      const entry = agents.find((a) => a.id === config.agents.entry) || agents[0];
      return { state: 'done', answer: `${plural(agents.length, 'agent')} · ${agentLabel(config, entry.id)} answers first` };
    }
    case 'guardrails': {
      const topics = topicsOf(config);
      // the moments that pass a caller to a person, and the one that ends the call (not a hand-over)
      const on = Object.entries(momentsOf(config)).filter(([, m]) => m?.on);
      const handOvers = on.filter(([id]) => id !== 'abusive_end').length;
      const ends = on.some(([id]) => id === 'abusive_end');
      const parts = [
        topics.allowed.length && `keeps to ${plural(topics.allowed.length, 'topic')}`,
        topics.blocked.length && `avoids ${plural(topics.blocked.length, 'topic')}`,
        handOvers && plural(handOvers, 'hand-over rule'),
        ends && 'ends abusive calls',
      ].filter(Boolean);
      return parts.length ? { state: 'done', answer: upper(parts.join(' · ')) } : { state: 'optional', answer: 'Nothing set · optional' };
    }
    case 'aftercall': {
      const after = afterCallOf(config);
      const parts = [
        after.summary.on && 'summary',
        after.questions.length && plural(after.questions.length, 'question'),
        after.recording.audio ? 'keeps transcripts and audio' : after.recording.transcript ? 'keeps transcripts' : '',
      ].filter(Boolean);
      return parts.length ? { state: 'done', answer: upper(parts.join(' · ')) } : { state: 'optional', answer: 'Nothing kept · optional' };
    }
    default:
      return { state: 'end', answer: 'Talk to it, then publish' };
  }
}

// -> the nine steps, each with its state and answer; `done`: how many of the first eight are done or fine as they are;
// `next`: the first step still to do (or null)
export function guidedSteps(config) {
  const steps = GUIDED_STEPS.map((step) => ({ ...step, ...(isObj(config) ? stepState(step.id, config) : { state: 'todo', answer: '' }) }));
  const todo = steps.filter((s) => s.state === 'todo');
  return { steps, todo, done: steps.filter((s) => s.state === 'done' || s.state === 'optional').length, next: todo[0] || null };
}
