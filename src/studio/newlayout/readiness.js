// "Getting it ready": the steps between a new agent and one that is live, as a checklist a person can follow while building, each pointing at the page where
// it is done. It is built from the draft and what the studio already knows (the checks, the tests and their latest run, the published versions, what is
// deployed); it informs and never blocks. It is the one answer to "is it ready?": the menu's progress card, the Overview, Home and Releases all read it.
// Pure: no React, no DOM.

import { readSimple } from '../simple/simpleModel.js';
import { readModels } from '../models/config.js';
import { modelLabel, providerLabel } from '../models/catalog.js';
import { gateCheck } from '../release/gateCheck.js';
import { tabFor } from './pages.js';

const list = (v) => (Array.isArray(v) ? v : []);
const words = (text) =>
  (
    String(text || '')
      .trim()
      .match(/\S+/g) || []
  ).length;

// steps: [{ id, label, text, state: 'done' | 'todo' | 'blocked' | 'optional', page, part?, target? }]; `target` says what to open on the Agent page, { open: <panel> } or { focus: 'role' | 'greeting' }; `next` is the first blocked step, else the first to do.
//   latestRun: the newest finished run of the tests ({ status, passed, total }), null when they were never run, undefined when not known (then written tests count as done).
//   gate: { enabled, savedAt, dirty } when "tests must pass before publishing" is on for the agent.
export function readinessSteps({ config, summary = null, report = null, scenarioCount = 0, latestRun, gate = null } = {}) {
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
          text: read.voiceChannel ? `${read.primaryLanguage}, with a voice chosen.` : `${read.primaryLanguage}.`,
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
          text: `${providerLabel(models.llm.provider)} · ${modelLabel('llm', models.llm.provider, models.llm.model)}`, // in words: "OpenAI · GPT-4.1 Mini"
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
          // to do either way (it is never optional, only not possible yet), so the number of steps stays the same once a version is published
          state: 'todo',
          page: 'releases',
          part: 'deploy',
        },
  );

  const counted = steps.filter((s) => s.state !== 'optional');
  const next = steps.find((s) => s.state === 'blocked') || steps.find((s) => s.state === 'todo') || null;
  return { steps, next, done: counted.filter((s) => s.state === 'done').length, total: counted.length };
}

// Where a step is done, as an address: the page (and its part), and on the Agent page the panel or field to open. A step about what the checks found
// opens the list of problems.
export function stepRoute(step) {
  if (!step) return { tab: 'home', params: undefined };
  if (step.page === 'checks') return { tab: 'agent', params: { show: 'problems' } };
  const tab = tabFor(step.page, step.part);
  const params = step.target?.open ? { open: step.target.open } : step.target?.focus ? { focus: step.target.focus } : undefined;
  return { tab, params };
}
