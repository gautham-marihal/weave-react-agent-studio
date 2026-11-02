import { describe, expect, it } from 'vitest';
import type { AgentConfig, ValidationReport } from '../types/studio';
import { firstGreeting, hasVoiceChannel, openStepsOn, readingOf, readinessSteps, type ReadinessInput } from './readiness';
import { languageName, defaultLanguage } from './languages';

const report = (errors = 0): ValidationReport => ({
  valid: errors === 0,
  errors: Array.from({ length: errors }, (_, i) => ({ path: ['persona', i], message: 'x' })),
  warnings: [],
  secrets_required: [],
  unsupported: [],
});

const config = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  meta: { name: 'A' },
  channels: [{ id: 'web', type: 'web_chat', enabled: true, greeting: { say: 'Hello there' } }],
  agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'You help customers with their orders and refunds.' }, tools: [] }] },
  defaults: { language: { primary: 'en-US' }, models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' }, tts: { provider: 'cartesia', voice_id: 'v1' } } },
  tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call' } as never],
  ...over,
});
const by = (r: ReturnType<typeof readinessSteps>, id: string) => {
  const step = r.steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};
const run = (input: Partial<ReadinessInput>) => readinessSteps({ config: config(), report: report(), ...input });

describe('readinessSteps', () => {
  it('a new agent has steps to do, the next one first', () => {
    const r = readinessSteps({ config: { meta: { name: 'A' } }, report: report() });
    expect(r.next?.id).toBe('prompt');
    expect(by(r, 'prompt').state).toBe('todo');
    expect(by(r, 'model').state).toBe('todo');
    expect(by(r, 'publish').state).toBe('todo');
    expect(by(r, 'deploy').state).toBe('todo');
    expect(by(r, 'deploy').text).toMatch(/Publish first/);
  });

  it('the number of steps stays the same when a version is published', () => {
    const before = run({});
    const after = run({ latestVersion: '0.1.0', deployed: {} });
    expect(after.total).toBe(before.total);
    expect(after.done).toBe(before.done + 1);
    expect(after.next?.id).toBe('deploy');
  });

  it('a filled-in agent has the building steps done and publishing to do', () => {
    const r = run({});
    for (const id of ['prompt', 'hello', 'voice', 'model', 'checks']) expect(by(r, id).state).toBe('done');
    expect(by(r, 'abilities').state).toBe('optional');
    expect(by(r, 'tests').state).toBe('optional');
    expect(r.next?.id).toBe('publish');
  });

  it('instructions need about eight words', () => {
    const short = config({ agents: { entry: 'a', items: [{ id: 'a', name: 'A', instructions: { role: 'Be nice.' }, tools: [] }] } });
    expect(by(readinessSteps({ config: short }), 'prompt').state).toBe('todo');
    expect(by(readinessSteps({ config: short }), 'prompt').text).toMatch(/Only 2 words/);
  });

  it('the tests step follows their latest run', () => {
    const base = { scenarioCount: 2 };
    expect(by(run(base), 'tests').state).toBe('done'); // the run is not known: written tests count
    const never = run({ ...base, latestRun: null });
    expect([by(never, 'tests').state, by(never, 'tests').label]).toEqual(['todo', 'Run the tests']);
    const passed = run({ ...base, latestRun: { status: 'passed', passed: 2, total: 2 } });
    expect(by(passed, 'tests').state).toBe('done');
    expect(by(passed, 'tests').text).toMatch(/2 of 2/);
    const failed = run({ ...base, latestRun: { status: 'failed', passed: 1, total: 2 } });
    expect([by(failed, 'tests').state, by(failed, 'tests').label]).toEqual(['blocked', 'Fix the failing tests']);
    expect(failed.next?.id).toBe('tests');
    expect(by(run({ ...base, latestRun: { status: 'error' } }), 'tests').text).toMatch(/broke/);
    expect(by(run({ ...base, latestRun: { status: 'skipped' } }), 'tests').text).toMatch(/skipped everything/);
    const gated = run({ ...base, latestRun: null, gate: { ok: false, why: 'The tests have not been run yet.', action: 'tests' } });
    expect([by(gated, 'tests').state, by(gated, 'tests').label, by(gated, 'tests').text]).toEqual(['blocked', 'Pass the tests', 'The tests have not been run yet.']);
  });

  it('a step points at the page where it is done', () => {
    const r = readinessSteps({ config: { meta: { name: 'A' } }, report: report(1) });
    expect(by(r, 'voice').target).toEqual({ stage: 'build', section: 'agent', focus: 'language' });
    expect(by(r, 'prompt').target).toEqual({ stage: 'build', section: 'agent', focus: 'instructions' });
    expect(by(r, 'hello').target).toEqual({ stage: 'build', section: 'channels', focus: 'greeting' });
    expect(by(r, 'checks').target).toEqual({ stage: 'build', focus: 'problems' });
    expect(by(r, 'publish').target).toEqual({ stage: 'release' });
    expect(by(r, 'deploy').target).toEqual({ stage: 'release', focus: 'deploy' });
    expect(by(r, 'abilities').target).toEqual({ stage: 'build', section: 'tools' });
  });

  it('problems block, and come before everything else to do', () => {
    const r = run({ report: report(2) });
    expect(by(r, 'checks').state).toBe('blocked');
    expect(by(r, 'checks').text).toMatch(/2 problems/);
    expect(r.next?.id).toBe('checks');
  });

  it('a published, deployed agent with a test is all done', () => {
    const r = readinessSteps({
      config: config({ tools: [{ id: 'lookup', type: 'http', description: 'Look up' }] }),
      report: report(),
      scenarioCount: 1,
      latestVersion: '0.1.0',
      deployed: { staging: '0.1.0' },
    });
    expect(r.next).toBeNull();
    expect(r.done).toBe(r.total);
    expect(by(r, 'deploy').text).toMatch(/staging/);
  });

  it('a text agent needs no voice; the language is said by name', () => {
    const noVoice = config({ defaults: { language: { primary: 'en-US' }, models: { llm: { provider: 'openai', model: 'm' } } } });
    expect(by(readinessSteps({ config: noVoice }), 'voice').state).toBe('done');
    expect(by(readinessSteps({ config: noVoice }), 'voice').text).toBe('English (United States).');
  });

  it('a voice channel needs a voice', () => {
    const voice = config({ channels: [{ id: 'v', type: 'web_voice', enabled: true, greeting: { say: 'Hi' } }], defaults: { language: { primary: 'en-GB' }, models: { llm: { provider: 'openai', model: 'm' } } } });
    const step = by(readinessSteps({ config: voice }), 'voice');
    expect([step.state, step.label, step.text]).toEqual(['todo', 'Pick a language and a voice', 'A voice channel needs a voice.']);
    expect(step.target.focus).toBe('voice');
  });

  it('the server’s checks not run yet: no checks step, nothing claimed', () => {
    const r = readinessSteps({ config: config(), report: null });
    expect(r.steps.some((s) => s.id === 'checks')).toBe(false);
  });

  it('a draft that failed to load says so and nothing else', () => {
    const r = readinessSteps({ config: {}, loadError: 'Request failed (500).' });
    expect(r.steps.map((s) => s.id)).toEqual(['load']);
    expect(r.next?.state).toBe('blocked');
    expect(r.next?.text).toMatch(/could not be read.*500/);
    expect(r.total).toBe(1);
    expect(r.done).toBe(0);
  });

  it('no config yet: no steps', () => {
    expect(readinessSteps({ config: null })).toEqual({ steps: [], next: null, done: 0, total: 0 });
  });

  it('builtin tools (end the call) are not abilities; other tools and knowledge are', () => {
    expect(by(run({}), 'abilities').state).toBe('optional');
    const withKb = config({ knowledge: [{ id: 'kb', type: 'rag_api' }] });
    expect(by(readinessSteps({ config: withKb }), 'abilities').text).toBe('1 knowledge base.');
  });
});

describe('the documents step', () => {
  const withDocs = config({ knowledge: [{ id: 'kb', type: 'vector_store', sources: [{ type: 'file', file_id: 'faq.md' }] }] });
  const step = (knowledge: ReadinessInput['knowledge']) => readinessSteps({ config: withDocs, knowledge }).steps.find((s) => s.id === 'knowledge');

  it('is there only for an agent with documents to read', () => {
    expect(run({}).steps.some((s) => s.id === 'knowledge')).toBe(false);
    expect(step(null)).toBeDefined();
  });

  it('says what the server has read, the worst first', () => {
    expect(step([{ id: 'kb', index: null, build: null, problems: [] }])).toMatchObject({ state: 'todo', text: 'Its documents are saved but not read yet.' });
    expect(step([])?.text).toBe('Its documents are saved but not read yet.');
    expect(step([{ id: 'kb', index: null, build: { status: 'failed' } }])?.text).toBe('Reading its documents failed.');
    expect(step([{ id: 'kb', index: null, build: { status: 'running' } }])?.text).toBe('Its documents are being read.');
    expect(step([{ id: 'kb', index: { built_at: 'x' }, problems: ['the file faq.md changed after the index was built'] }])?.text).toBe('Its documents changed since they were read.');
    expect(step([{ id: 'kb', index: { built_at: 'x' }, problems: [] }])).toMatchObject({ state: 'done', text: 'Read, and ready to answer from.' });
  });

  it('not known (not read from the server): counted, and not claimed to need anything', () => {
    expect(step(null)?.state).toBe('done');
    const r = readinessSteps({ config: withDocs, knowledge: [{ id: 'kb', index: null }] });
    expect(r.total).toBe(r.steps.filter((s) => s.state !== 'optional').length);
  });

  it('readingOf reads a base as the server reports it', () => {
    expect(readingOf(undefined)).toBe('unread');
    expect(readingOf({ id: 'kb', index: { x: 1 }, build: { status: 'failed' } })).toBe('ready');
  });
});

describe('reading a config', () => {
  it('the first greeting is a literal line, or the message it names', () => {
    expect(firstGreeting(config())).toBe('Hello there');
    const ref = config({ channels: [{ id: 'w', type: 'web_chat', enabled: true, greeting: { say: { message: 'hi' } } }], messages: [{ id: 'hi', text: 'Welcome!' }] });
    expect(firstGreeting(ref)).toBe('Welcome!');
    expect(firstGreeting(config({ channels: [{ id: 'w', type: 'web_chat', enabled: false, greeting: { say: 'Off' } }] }))).toBe('');
  });

  it('a voice channel is a phone line or web voice that is on', () => {
    expect(hasVoiceChannel(config())).toBe(false);
    expect(hasVoiceChannel(config({ channels: [{ id: 'p', type: 'sip_voice', enabled: true }] }))).toBe(true);
    expect(hasVoiceChannel(config({ channels: [{ id: 'p', type: 'web_voice', enabled: false }] }))).toBe(false);
  });

  it('open steps on a page, for the ring on its menu item', () => {
    const r = readinessSteps({ config: { meta: { name: 'A' } } });
    expect(openStepsOn(r, (t) => t.stage === 'build' && t.section === 'agent').map((s) => s.id)).toEqual(['prompt', 'voice', 'model']);
  });
});

describe('languages', () => {
  it('names a code, or its language, or leaves it as it is', () => {
    expect(languageName('en-GB')).toBe('English (United Kingdom)');
    expect(languageName('en')).toBe('English');
    expect(languageName('xx-YY')).toBe('xx-YY');
  });

  it('the default is the browser’s own language when offered', () => {
    expect(defaultLanguage(['fr-CA', 'en-US'])).toBe('fr-CA');
    expect(defaultLanguage(['de'])).toBe('de-DE');
    expect(defaultLanguage(['xx'])).toBe('en-US');
    expect(defaultLanguage([])).toBe('en-US');
  });
});
