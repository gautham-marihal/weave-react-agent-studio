import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { applyChange, applyEdit, isApplied, queueChange, takeChange } from './pendingChange';
import { connectionChange, connectionId, connectionProblems, templateChange, voiceChange } from './manageChanges';

const config: AgentConfig = { persona: { style_rules: ['Be kind.'] }, defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1' } } }, tests: [{ id: 'kept' }] };
const scenario = { id: 'kept', channel: 'web', turns: [{ say: 'hi' }], expect: [{ said_matches: '.+' }] };

describe('a change queued for an agent’s draft', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('waits for its own agent, and is taken once', () => {
    queueChange('acme', { note: 'Added a test.', edits: [{ op: 'add_test', scenario }], target: { stage: 'build', focus: 'tests' } });
    expect(takeChange('other')).toBeNull();
    const change = takeChange('acme');
    expect(change?.note).toBe('Added a test.');
    expect(change?.target).toEqual({ stage: 'build', focus: 'tests' });
    expect(takeChange('acme')).toBeNull();
  });

  it('a newer change replaces one still waiting', () => {
    queueChange('acme', { note: 'one', edits: [] });
    queueChange('acme', { note: 'two', edits: [] });
    expect(takeChange('acme')?.note).toBe('two');
  });

  it('without storage nothing is carried over, and nothing breaks', () => {
    vi.stubGlobal('window', {});
    expect(() => queueChange('acme', { note: 'x', edits: [] })).not.toThrow();
    expect(takeChange('acme')).toBeNull();
  });
});

describe('the edits', () => {
  it('a test is added under a free name, leaving the rest as it was', () => {
    const next = applyEdit(config, { op: 'add_test', scenario });
    expect(next.tests.map((t: { id: string }) => t.id)).toEqual(['kept', 'kept_2']);
    expect(config.tests).toHaveLength(1);
  });

  it('rules are added once; a rule already there changes nothing', () => {
    const edit = { op: 'add_style_rules' as const, rules: ['Keep it short.'] };
    const next = applyEdit(config, edit);
    expect(next.persona?.style_rules).toEqual(['Be kind.', 'Keep it short.']);
    expect(isApplied(next, edit)).toBe(true);
    expect(applyEdit(next, edit)).toBe(next);
    expect(applyEdit({}, edit).persona?.style_rules).toEqual(['Keep it short.']);
  });

  it('a model is set, keeping the provider', () => {
    const next = applyEdit(config, { op: 'set_model', stage: 'llm', model: 'gpt-4.1-mini' });
    expect(next.defaults?.models?.llm).toEqual({ provider: 'openai', model: 'gpt-4.1-mini' });
    expect(isApplied(next, { op: 'set_model', stage: 'llm', model: 'gpt-4.1-mini' })).toBe(true);
  });

  it('a change applies its edits in order', () => {
    const next = applyChange(config, { edits: [{ op: 'add_style_rules', rules: ['A.'] }, { op: 'add_style_rules', rules: ['B.'] }] });
    expect(next.persona?.style_rules).toEqual(['Be kind.', 'A.', 'B.']);
  });
});

// The Library's changes ("use this voice", "add this connection") and the Create dialog's template, built in
// models/manageChanges.ts and carried by the same queue.
describe('voices, connections and templates', () => {
  const draft: AgentConfig = { meta: { id: 'x', name: 'X', version: '0.1.0' }, defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1' } } } };

  it('a voice is set without disturbing anything else, and the same provider keeps its model', () => {
    const change = voiceChange({ name: 'Sarah', provider: 'ElevenLabs', voiceId: 'abc123' });
    expect(change.note).toMatch(/Sarah/);
    expect(change.target).toEqual({ stage: 'build', section: 'agent', focus: 'voice' });
    const next = applyChange(draft, change);
    expect(next.defaults?.models?.tts).toEqual({ provider: 'elevenlabs', voice_id: 'abc123', model: 'eleven_flash_v2_5' });
    expect(next.defaults?.models?.llm).toEqual(draft.defaults?.models?.llm);
    expect(draft.defaults?.models?.tts).toBeUndefined();
    const chosen: AgentConfig = { defaults: { models: { tts: { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'abc123' } } } };
    expect(applyChange(chosen, voiceChange({ name: 'Adam', provider: 'ElevenLabs', voiceId: 'zzz' })).defaults?.models?.tts).toEqual({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'zzz' });
    expect(applyChange(chosen, voiceChange({ name: 'Skylar', provider: 'Cartesia', voiceId: 'c1' })).defaults?.models?.tts?.model).toBe('sonic-3');
    expect(applyChange(chosen, voiceChange({ name: 'Own', provider: 'openai', voiceId: 'alloy' })).defaults?.models?.tts).toEqual({ provider: 'openai', voice_id: 'alloy' });
    expect(isApplied(chosen, { op: 'set_voice', provider: 'ElevenLabs', voiceId: 'abc123' })).toBe(true);
  });

  it('a connection is added under a free, valid id and signs in with a server secret by name only', () => {
    const change = connectionChange({ name: 'My CRM (Prod)', url: 'https://crm.example.test', auth: 'bearer', secret: 'CRM_API_TOKEN' });
    expect(change.note).toMatch(/CRM_API_TOKEN/);
    expect(change.target).toEqual({ stage: 'build', section: 'tools' });
    const once = applyChange(draft, change);
    expect(once.connections).toEqual({ my_crm_prod: { type: 'http', base_url: 'https://crm.example.test', timeout_s: 10, auth: { type: 'bearer', token: { secret: 'CRM_API_TOKEN' } } } });
    expect(applyChange(once, change)).toBe(once);
    const other = applyChange(once, connectionChange({ name: 'My CRM (Prod)', url: 'https://crm2.example.test', auth: 'none', secret: '' }));
    expect(Object.keys(other.connections ?? {})).toEqual(['my_crm_prod', 'my_crm_prod_2']);
    expect(other.connections?.my_crm_prod_2).not.toHaveProperty('auth');
    const key = applyChange(draft, connectionChange({ name: 'x', url: 'https://x.test', auth: 'api_key', secret: 'K', header: 'X-Key' }));
    expect((key.connections?.x as { auth: unknown }).auth).toEqual({ type: 'api_key', header: 'X-Key', key: { secret: 'K' } });
    expect(connectionId('9 lives!')).toBe('lives');
    expect(connectionId('')).toBe('connection');
  });

  it('a connection form says what is missing, in words', () => {
    const fine = connectionProblems({ name: 'crm', url: 'https://crm.test', auth: 'bearer', secret: 'CRM_API_TOKEN' });
    expect(Object.values(fine).every((p) => p === '')).toBe(true);
    expect(connectionProblems({ name: 'crm', url: '', auth: 'none', secret: '' }).url).toMatch(/give the system’s address/);
    expect(connectionProblems({ name: 'crm', url: 'crm.test', auth: 'none', secret: '' }).url).toMatch(/https:\/\//);
    expect(connectionProblems({ name: '9x', url: 'https://a.b', auth: 'none', secret: '' }).name).not.toBe('');
    expect(connectionProblems({ name: 'crm', url: 'https://a.b', auth: 'bearer', secret: 'lower' }).secret).toMatch(/capital letters/);
    expect(connectionProblems({ name: 'crm', url: 'https://a.b', auth: 'api_key', secret: 'K', header: 'bad header' }).header).not.toBe('');
  });

  it('a template keeps the draft’s own id, name and version', () => {
    const template: AgentConfig = { meta: { tags: ['care'] }, persona: { name: 'Care' }, tools: [{ id: 'end_call', type: 'builtin', builtin: 'end_call' }] };
    const change = templateChange(template, 'Care desk');
    const next = applyChange(draft, change);
    expect(next.meta).toEqual({ tags: ['care'], id: 'x', name: 'X', version: '0.1.0' });
    expect(next.tools).toEqual(template.tools);
    expect(change.note).toMatch(/Care desk/);
  });
});
