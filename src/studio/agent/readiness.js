// "Getting it ready": the checklist from a new agent to a live one, each step pointing at its page. The one answer to
// "is it ready?" for the menu, Overview, Home and Releases; it informs and never blocks. Pure: no React, no DOM.

import { languageName, readSimple } from '../simple/simpleModel.js';
import { readModels } from '../models/config.js';
import { modelLabel, providerLabel } from '../models/catalog.js';
import { gateCheck } from '../release/gateCheck.js';
import { coveredOnlySome, coveredOnlyText } from '../scenarios/runResults.js';
import { readingState } from '../knowledge/model.js';
import { tabFor } from './pages.js';

const list = (v) => (Array.isArray(v) ? v : []);
const words = (text) =>
  (
    String(text || '')
      .trim()
      .match(/\S+/g) || []
  ).length;

// What a step about the documents says while they are not ready, the worst first.
const KNOWLEDGE_TODO = {
  failed: 'Reading its documents failed.',
  missing: 'A document it lists is not on the server.',
  unsaved: 'Its documents are not saved yet.',
  changed: 'Its documents changed since they were read.',
  unread: 'Its documents are saved but not read yet.',
  reading: 'Its documents are being read.',
};

// -> { steps, next, done, total }
//   steps: [{ id, label, text, state: 'done' | 'todo' | 'blocked' | 'optional', page, part?, target? }]
// `target` is what to open on the Agent page; `next` is the first blocked step, else the first to do.
//   latestRun: newest finished test run ({ status, passed, total }); null if never run, undefined if unknown
//   gate: { enabled, savedAt, dirty } when "tests must pass before publishing" is on
//   knowledgeRead: what the server has read of the documents; if absent, documents count as read
export function readinessSteps({ config, summary = null, report = null, scenarioCount = 0, latestRun, gate = null, knowledgeRead = null } = {}) {
  const steps = [];
  if (!config || typeof config !== 'object') return { steps, next: null, done: 0, total: 0 };
  const read = readSimple(config);
  const models = readModels(config);
  const add = (step) => steps.push(step);

  add(
    words(read.role) >= 8
      ? {
          id: 'prompt',
          label: 'Say what it should do',
          text: `${words(read.role)} words of instructions.`,
          state: 'done',
          page: 'agent',
          target: { focus: 'role' },
        }
      : {
          id: 'prompt',
          label: 'Say what it should do',
          text: 'Write the instructions the agent follows: who it helps, what it does, what it must not do.',
          state: 'todo',
          page: 'agent',
          target: { focus: 'role' },
        },
  );

  add(
    read.greeting
      ? {
          id: 'hello',
          label: 'Choose what it says first',
          text: `“${read.greeting.length > 60 ? `${read.greeting.slice(0, 59)}…` : read.greeting}”`,
          state: 'done',
          page: 'agent',
          target: { focus: 'greeting' },
        }
      : {
          id: 'hello',
          label: 'Choose what it says first',
          text: 'Nothing is said when a call starts yet.',
          state: 'todo',
          page: 'agent',
          target: { focus: 'greeting' },
        },
  );

  const voiceOk = !!read.primaryLanguage && (!read.voiceChannel || !!models.tts.voiceId);
  add(
    voiceOk
      ? {
          id: 'voice',
          label: read.voiceChannel ? 'Pick a language and a voice' : 'Pick its language',
          text: read.voiceChannel ? `${languageName(read.primaryLanguage)}, with a voice chosen.` : `${languageName(read.primaryLanguage)}.`,
          state: 'done',
          page: 'agent',
          target: { open: 'language' },
        }
      : {
          id: 'voice',
          label: read.voiceChannel ? 'Pick a language and a voice' : 'Pick its language',
          text: !read.primaryLanguage ? 'No main language is set.' : 'A voice channel needs a voice.',
          state: 'todo',
          page: 'agent',
          target: { open: !read.primaryLanguage ? 'language' : 'voice' },
        },
  );

  add(
    models.llm.provider && models.llm.model
      ? {
          id: 'model',
          label: 'Choose the AI model',
          text: `${providerLabel(models.llm.provider)} · ${modelLabel('llm', models.llm.provider, models.llm.model)}`,
          state: 'done',
          page: 'agent',
          target: { open: 'models' },
        }
      : {
          id: 'model',
          label: 'Choose the AI model',
          text: 'The language model that decides what to say is not chosen yet.',
          state: 'todo',
          page: 'agent',
          target: { open: 'models' },
        },
  );

  const tools = list(config.tools).filter((t) => t && typeof t === 'object');
  const knowledge = list(config.knowledge);
  add(
    tools.some((t) => !t.builtin) || knowledge.length
      ? {
          id: 'abilities',
          label: 'Give it tools or knowledge',
          text: `${tools.length} tool${tools.length === 1 ? '' : 's'}${knowledge.length ? `, ${knowledge.length} knowledge base${knowledge.length === 1 ? '' : 's'}` : ''}.`,
          state: 'done',
          page: 'tools',
        }
      : {
          id: 'abilities',
          label: 'Give it tools or knowledge',
          text: 'Optional: let it look something up, hand over to a person, or answer from your documents.',
          state: 'optional',
          page: 'tools',
        },
  );

  // documents must be read before the agent can answer from them: a step while any are unsaved, unread or changed since
  const readable = knowledge.filter((b) => b && typeof b === 'object' && b.type === 'vector_store');
  if (readable.length) {
    const states = knowledgeRead
      ? readable.map((b) => readingState(list(knowledgeRead.bases).find((s) => s.id === b.id) || null, { draftSources: list(b.sources) }).state)
      : [];
    const worst = Object.keys(KNOWLEDGE_TODO).find((state) => states.includes(state));
    const step = { id: 'knowledge', label: 'Let it read its documents', page: 'knowledge' };
    add(
      worst
        ? { ...step, text: KNOWLEDGE_TODO[worst], state: 'todo' }
        : { ...step, text: knowledgeRead ? 'Read, and ready to answer from.' : 'Its documents and web pages.', state: 'done' },
    );
  }

  const errors = list(report?.errors).length;
  if (report) {
    add(
      errors
        ? {
            id: 'checks',
            label: 'Fix what the checks found',
            text: `${errors} ${errors === 1 ? 'problem' : 'problems'} to fix before it can be published.`,
            state: 'blocked',
            page: 'checks',
          }
        : { id: 'checks', label: 'The checks pass', text: 'Nothing the checks found is wrong.', state: 'done', page: 'checks' },
    );
  }

  const tests = `${scenarioCount} test${scenarioCount === 1 ? '' : 's'}`;
  const held = gate?.enabled
    ? gateCheck({ enabled: true, scenarioCount, latestRun: latestRun || null, savedAt: gate.savedAt || '', dirty: !!gate.dirty })
    : null;
  const testStep = { id: 'tests', page: 'tests', part: 'scenarios' };
  if (held && !held.ok)
    add({ ...testStep, label: 'Pass the tests', text: held.why, state: 'blocked', part: held.action === 'callers' ? 'callers' : 'scenarios' });
  else if (scenarioCount === 0)
    add({
      ...testStep,
      label: 'Write a test',
      text: 'Optional: a conversation it must always get right, checked every time it changes.',
      state: 'optional',
    });
  else if (latestRun === undefined) add({ ...testStep, label: 'Write a test', text: `${tests} written.`, state: 'done' });
  else if (latestRun === null) add({ ...testStep, label: 'Run the tests', text: `${tests} written, not run yet.`, state: 'todo' });
  else if (latestRun.status === 'passed' && coveredOnlySome(latestRun, scenarioCount))
    add({ ...testStep, label: 'Run the tests', text: `${coveredOnlyText(latestRun, scenarioCount)} Run them all.`, state: 'todo' });
  else if (latestRun.status === 'passed')
    add({
      ...testStep,
      label: 'Run the tests',
      text: `The latest run passed (${latestRun.passed ?? scenarioCount} of ${latestRun.total ?? scenarioCount}).`,
      state: 'done',
    });
  else
    add({
      ...testStep,
      label: 'Fix the failing tests',
      text: `The latest run ${latestRun.status === 'error' ? 'broke' : latestRun.status === 'skipped' ? 'skipped everything' : 'failed'}.`,
      state: 'blocked',
    });

  const published = !!summary?.latest_version;
  const live = Object.values(summary?.deployed || {}).some(Boolean);
  add(
    published
      ? { id: 'publish', label: 'Publish a version', text: `v${summary.latest_version} is published.`, state: 'done', page: 'releases', part: 'versions' }
      : {
          id: 'publish',
          label: 'Publish a version',
          text: 'Freeze the draft as a version you can put live.',
          state: 'todo',
          page: 'releases',
          part: 'versions',
        },
  );
  add(
    live
      ? {
          id: 'deploy',
          label: 'Put it live',
          text: `Running in ${Object.entries(summary.deployed)
            .filter(([, v]) => v)
            .map(([env]) => env)
            .join(' and ')}.`,
          state: 'done',
          page: 'releases',
          part: 'deploy',
        }
      : {
          id: 'deploy',
          label: 'Put it live',
          text: published ? 'Choose where this version runs.' : 'Publish first, then choose where it runs.',
          // always to do (never optional, only not possible yet), so the step count stays the same after a publish
          state: 'todo',
          page: 'releases',
          part: 'deploy',
        },
  );

  const counted = steps.filter((s) => s.state !== 'optional');
  const next = steps.find((s) => s.state === 'blocked') || steps.find((s) => s.state === 'todo') || null;
  return { steps, next, done: counted.filter((s) => s.state === 'done').length, total: counted.length };
}

// A step's address: its page and part, plus the Agent page panel or field to open. A checks step opens the problems.
export function stepRoute(step) {
  if (!step) return { tab: 'home', params: undefined };
  if (step.page === 'checks') return { tab: 'agent', params: { show: 'problems' } };
  const tab = tabFor(step.page, step.part);
  const params = step.target?.open ? { open: step.target.open } : step.target?.focus ? { focus: step.target.focus } : undefined;
  return { tab, params };
}
