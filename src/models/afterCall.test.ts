import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { unknownKeys } from '../test/schemaKeys';
import {
  addArtifact,
  addWrapup,
  artifactWords,
  artifactsOf,
  folderProblem,
  observabilityOf,
  removeArtifact,
  removeWrapup,
  setArtifact,
  setObservability,
  setOtel,
  setSessionLogField,
  setSinkField,
  setSinkType,
  setSummary,
  setSummaryModel,
  summaryModelOf,
  summaryModelShown,
  setWrapupGoodbye,
  setWrapupWait,
  wrapupStepWords,
  wrapupsOf,
} from './afterCall';

const bare = (): AgentConfig => ({
  schema_version: '1.2',
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
  connections: { crm: { base_url: 'https://crm.example.com' } },
});

describe('the model that writes the summaries (ported from build-aftercall.test.js)', () => {
  it('is asked only once summaries are on, or a model is already set', () => {
    expect(summaryModelShown(bare())).toBe(false);
    expect(summaryModelShown(setSummary(bare(), { on: false }))).toBe(false);
    expect(summaryModelShown(setSummary(bare(), { on: true }))).toBe(true);
    expect(summaryModelShown({ post_call: { summary: { enabled: false, llm: { provider: 'anthropic' } } } } as AgentConfig)).toBe(true);
  });

  it('cannot switch summaries on or off by itself, and empties back to the agent’s model', () => {
    expect(setSummaryModel(bare(), { model: 'x' })).toEqual(bare());
    let c = setSummary(bare(), { on: true });
    c = setSummaryModel(c, { provider: 'anthropic', model: 'claude-haiku', temperature: '5' });
    expect(c.post_call?.summary).toEqual({ enabled: true, llm: { provider: 'anthropic', model: 'claude-haiku', temperature: 2 } });
    expect(summaryModelOf(c)).toEqual({ provider: 'anthropic', model: 'claude-haiku', temperature: 2 });
    c = setSummaryModel(c, { provider: '', model: '', temperature: '' });
    expect(c.post_call?.summary).toEqual({ enabled: true });
    expect(unknownKeys(c)).toEqual([]);
  });
});

describe('files after each call', () => {
  it('a file goes to a folder first; a web service can be chosen, and the two keep nothing of each other', () => {
    let c = addArtifact(bare(), 'transcript');
    expect(c.post_call?.artifacts).toEqual([{ kind: 'transcript', sink: { type: 'file', directory: 'transcripts' } }]);
    c = setSinkField(c, 0, 'filename', 'call.json');
    c = setSinkField(c, 0, 'filename', '  ');
    expect(artifactsOf(c)[0].sink.filename).toBe('');
    c = setSinkType(c, 0, 'http', ['crm']);
    expect(c.post_call?.artifacts?.[0].sink).toEqual({ type: 'http', connection: 'crm', method: 'POST', path: '/' });
    c = setSinkField(c, 0, 'path', '/calls');
    expect(artifactWords(artifactsOf(c)[0])).toBe('The transcript, sent by POST to /calls on the connection “crm”.');
    c = setArtifact(c, 0, { enabled: false, kind: 'metrics' });
    expect(artifactWords(artifactsOf(c)[0])).toMatch(/^The call’s numbers.*\(switched off\)\.$/);
    c = setArtifact(c, 0, { enabled: true });
    expect('enabled' in (c.post_call?.artifacts?.[0] as Record<string, unknown>)).toBe(false);
    expect(unknownKeys(c)).toEqual([]);
    expect(removeArtifact(c, 0).post_call).toBeUndefined();
  });
});

describe('closing messages', () => {
  it('a new one ends the call after a wait; its goodbye and wait change; it says which tools start it', () => {
    let c = addWrapup(bare());
    c = addWrapup(c);
    expect(wrapupsOf(c).map((w) => w.id)).toEqual(['wrapup', 'wrapup_2']);
    c = setWrapupGoodbye(c, 0, 'Thanks, goodbye!');
    expect((c as Record<string, unknown>).wrapups).toMatchObject([{ id: 'wrapup', wait_s: 8, on_silence: [{ type: 'end_call', say: 'Thanks, goodbye!' }] }, { id: 'wrapup_2' }]);
    c = setWrapupWait(c, 0, '12.5');
    c = setWrapupWait(c, 0, '');
    c = setWrapupWait(c, 0, '-1');
    expect(wrapupsOf(c)[0].waitS).toBe(12.5);
    c = setWrapupGoodbye(c, 0, '');
    expect(wrapupsOf(c)[0].steps).toEqual([{ type: 'end_call' }]);
    expect(wrapupsOf(c)[0].usedBy).toEqual([]);
    c.tools = [{ id: 'book', type: 'http', effects: [{ do: [{ type: 'wrapup', wrapup: 'wrapup' }] }] }];
    expect(wrapupsOf(c)[0].usedBy).toEqual(['book']);
    expect(unknownKeys(c)).toEqual([]);
    c = removeWrapup(removeWrapup(c, 0), 0);
    expect('wrapups' in c).toBe(false);
  });

  it('reads its other steps in words', () => {
    const c = bare();
    const speech = (s: unknown) => (typeof s === 'string' ? s : '');
    expect(wrapupStepWords({ type: 'say', text: 'Still there?' }, c, speech)).toBe('Say “Still there?”');
    expect(wrapupStepWords({ type: 'end_call', say: 'Bye' }, c, speech)).toBe('Say “Bye”, then end the call');
    expect(wrapupStepWords({ type: 'play_sound' }, c, speech)).toBe('play sound');
  });
});

describe('call records and logs', () => {
  it('each setting goes back to the server’s default when cleared, and the part goes when empty', () => {
    let c = setObservability(bare(), 'log_level', 'INFO');
    c = setObservability(c, 'log_pii', false);
    c = setSessionLogField(c, 'detail', 'full');
    c = setSessionLogField(c, 'directory', 'calls');
    expect(observabilityOf(c)).toMatchObject({ logLevel: 'INFO', logPii: false, sessionDetail: 'full', sessionDirectory: 'calls', otel: null });
    c = setOtel(c, { enabled: true });
    c = setOtel(c, { endpoint: 'https://collector.example.com:4318', serviceName: 'acme' });
    expect(c.observability?.otel).toEqual({ enabled: true, endpoint: 'https://collector.example.com:4318', service_name: 'acme' });
    expect(unknownKeys(c)).toEqual([]);
    c = setOtel(c, { enabled: false });
    c = setObservability(setObservability(c, 'log_level', ''), 'log_pii', null);
    c = setSessionLogField(setSessionLogField(c, 'detail', ''), 'directory', '');
    expect(c.observability).toBeUndefined();
  });

  it('a log folder stays inside the agent’s own folder', () => {
    expect(folderProblem('sessions')).toBe('');
    expect(folderProblem('/var/log')).toMatch(/not a full path/);
    expect(folderProblem('C:\\logs')).toMatch(/not a full path/);
    expect(folderProblem('a/../b')).toMatch(/“\.\.”/);
  });
});
