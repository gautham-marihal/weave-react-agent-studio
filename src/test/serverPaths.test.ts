import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { draftBody } from '../api/client';
import { settingsCatalog } from '../data/settingsCatalog';
import { starters } from '../data/starters';
import { applyStarter } from '../models/setup';
import { putAt } from '../utils/path';
import { parsePath } from '../utils/path';
import { providerFollowUps } from '../utils/settingOptions';
import { isSchemaPath, unknownKeys } from './schemaKeys';

// The minimal draft POST /bots gives a new agent (read from the live API on 2026-10-26).
const SERVER_DRAFT: AgentConfig = {
  schema_version: '1.2',
  meta: { id: 'new-agent', name: 'New Agent', version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } }, conversation: {} },
  persona: { name: 'New Agent' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'new-agent-widget' }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: 'Hello! How can I help you today?' } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'New Agent', kind: 'standalone', instructions: { role: 'You are a helpful assistant.' }, tools: [] }] },
};

const sample = (type: string, path: string): unknown => {
  if (type === 'toggle') return true;
  if (type === 'number') return 30;
  if (type === 'lines') return ['One question at a time.'];
  if (path === 'runtime.provider_mode') return 'plugins';
  return 'x';
};

describe('forms write the server’s real config paths', () => {
  it('every setting in the catalogue is a path in GET /schema', () => {
    const notInSchema = settingsCatalog.map((s) => s.path).filter((p) => !isSchemaPath(p));
    expect(notInSchema).toEqual([]);
  });

  it('a draft edited through every setting has no key the schema does not know', () => {
    const edited = settingsCatalog.reduce<AgentConfig>((config, s) => putAt(config, parsePath(s.path), sample(s.type, s.path)), SERVER_DRAFT);
    expect(unknownKeys(draftBody(edited).config)).toEqual([]);
  });

  it('PUT /draft sends the config exactly as the editor holds it, nothing added or renamed', () => {
    const body = draftBody(SERVER_DRAFT, 7);
    expect(body).toEqual({ config: SERVER_DRAFT, base_revision: 7 });
    expect(body.config).toBe(SERVER_DRAFT);
    expect(draftBody(SERVER_DRAFT, null)).toEqual({ config: SERVER_DRAFT });
  });

  it('the key check catches a UI-only field (the tts.voice that once made a server draft invalid)', () => {
    const leaked = putAt(SERVER_DRAFT, ['defaults', 'models', 'tts'], { provider: 'cartesia', model: 'sonic-3', voice: 'abc' });
    expect(unknownKeys(leaked)).toEqual(['defaults.models.tts.voice']);
    for (const alias of [['persona', 'recording_notice'], ['post_call', 'redact_pii'], ['observability', 'store_transcripts'], ['defaults', 'conversation', 'inactivity_timeout_s'], ['runtime', 'mode']]) {
      expect(unknownKeys(putAt(SERVER_DRAFT, alias, true))).toEqual([alias.join('.')]);
    }
  });

  it('clearing a setting removes the key, so the server’s default applies', () => {
    const set = putAt(SERVER_DRAFT, ['post_call', 'summary', 'enabled'], true);
    const cleared = putAt(set, ['post_call', 'summary', 'enabled'], undefined);
    expect(cleared.post_call?.summary).toEqual({});
    expect(JSON.stringify(draftBody(cleared))).not.toContain('enabled":undefined');
  });
});

describe('a new agent from a starter', () => {
  it.each(starters.filter((s) => s.id !== 'blank').map((s) => [s.id, s] as const))('%s adds only real config keys', (_id, starter) => {
    const config = applyStarter(SERVER_DRAFT, { company: 'Acme', starter });
    expect(unknownKeys(config)).toEqual([]);
  });

  it('keeps the server’s models, runtime and ids, and sets what the starter is about', () => {
    const starter = starters[0];
    const config = applyStarter(SERVER_DRAFT, { company: 'Acme', starter, languages: ['en-GB'] });
    expect(config.defaults?.models).toEqual(SERVER_DRAFT.defaults?.models);
    expect(config.defaults?.language).toEqual({ primary: 'en-GB', speaks: ['en'] });
    expect(config.runtime).toEqual(SERVER_DRAFT.runtime);
    expect(config.meta?.id).toBe('new-agent');
    expect(config.persona?.company).toBe('Acme');
    expect(config.channels?.[0].greeting?.say).toContain('Acme');
    expect(config.agents?.items?.[0].instructions?.role).toBe(starter.instructions);
    expect(config.post_call).toBeUndefined();
    expect(config.observability).toBeUndefined();
  });

  it('does not change the server draft it starts from', () => {
    const before = JSON.stringify(SERVER_DRAFT);
    applyStarter(SERVER_DRAFT, { company: 'Acme', starter: starters[0] });
    expect(JSON.stringify(SERVER_DRAFT)).toBe(before);
  });
});

describe('changing a provider', () => {
  const run = (key: string, provider: string) => {
    let config: AgentConfig = putAt(SERVER_DRAFT, ['defaults', 'models', 'tts'], { provider: 'old', model: 'old-model', voice_id: 'old-voice' });
    providerFollowUps[key].apply(provider, (path, value) => {
      config = putAt(config, path, value);
    });
    return config;
  };

  it('moves the voice model and voice to the new provider’s first suggestion', () => {
    const tts = run('defaults.models.tts.provider', 'elevenlabs').defaults?.models?.tts;
    expect(tts?.model).toBe('eleven_flash_v2_5');
    expect(typeof tts?.voice_id).toBe('string');
    expect(tts?.voice_id).not.toBe('old-voice');
  });

  it('clears them when the catalogue has nothing for the provider, instead of keeping the old provider’s ids', () => {
    const tts = run('defaults.models.tts.provider', 'openai').defaults?.models?.tts;
    expect(tts?.model).toBeUndefined();
    expect(tts?.voice_id).toBeUndefined();
    expect(Object.keys(tts ?? {})).not.toContain('voice');
  });
});
