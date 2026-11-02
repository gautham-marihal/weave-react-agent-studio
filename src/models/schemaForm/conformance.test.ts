import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AgentConfig } from '../../types/studio';
import { starters } from '../../data/starters';
import { applyStarter, buildChannel } from '../setup';
import { collectRefOptions, createEngine, isObj, type Json, type RawSchema } from './engine';
import { COLLECTIONS, allReferences, findUsage, renameEverywhere } from './references';
import { isComplex } from './cardLogic';

// Ported from Weave React's conformance tests: the checks that keep the settings form generic as it grows. Over a corpus
// of configs (the API's example, every starter Studio offers, a big one and one with every kind of tool and channel),
// renaming every id and map key must leave nothing pointing at the old name, and every value must have a place in the
// form. The server's own word on validity is the stand-in API's job (e2e), not this file's.
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8'));
const schema = read('agent-config.schema.json') as RawSchema;
const engine = createEngine(schema);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const fresh = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'corpus', name: 'Corpus', version: '0.1.0', status: 'draft' },
  runtime: { engine: 'livekit-agents', provider_mode: 'plugins' },
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' } } }, conversation: {} },
  persona: { name: 'Corpus' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true, entry: { widget_id: 'corpus-widget' }, modalities: { input: ['text'], output: ['text'] } }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Corpus', kind: 'standalone', instructions: { role: 'Help.' }, tools: [] }] },
});

// A real starter with many tools and agents added, built only from valid parts.
function scaledConfig(tools = 30, agents = 6): Json {
  const config = applyStarter(fresh(), { company: 'Scaled', starter: starters[0] }) as unknown as Json;
  config.connections = { ...(isObj(config.connections) ? config.connections : {}), api: { type: 'http', base_url: 'https://api.example.com' } };
  const more = Array.from({ length: tools }, (_, i) => ({
    id: `lookup_${i}`,
    type: 'http',
    connection: 'api',
    description: `Looks up record number ${i} when the caller asks about it`,
    request: { method: 'GET', path: `/records/${i}/{{args.record_id}}` },
    parameters: { type: 'object', required: ['record_id'], properties: { record_id: { type: 'string', description: 'The id of the record' } } },
    timeout_s: 6,
  }));
  config.tools = [...(Array.isArray(config.tools) ? config.tools : []), ...more];
  const agentsSection = config.agents as Json;
  const extra = Array.from({ length: agents }, (_, i) => ({
    id: `helper_${i}`,
    name: `Helper ${i}`,
    kind: 'specialist',
    instructions: { role: `Help with topic ${i}.` },
    tools: more.slice(i * 3, i * 3 + 3).map((t) => t.id),
  }));
  config.agents = { ...agentsSection, items: [...(agentsSection.items as unknown[]), ...extra] };
  return config;
}

// Every kind of channel, and the defaults of every kind of tool, in one config. Not claimed valid: it is drawn and renamed.
function stressConfig(): Json {
  const config = scaledConfig(8, 4);
  const channels: Json[] = [];
  (['sip_voice', 'web_chat', 'web_voice'] as const).forEach((type) => channels.push(buildChannel(type, { taken: channels.map((c) => String(c.id)), botId: 'stress' }) as unknown as Json));
  ['whatsapp', 'sms', 'email', 'custom'].forEach((type) => channels.push({ id: type, type, enabled: false, modalities: { input: ['text'], output: ['text'] } }));
  config.channels = channels;
  const branches = engine.branchesOf(engine.flatten((schema.properties as Record<string, RawSchema>).tools.items));
  branches.forEach((branch, i) => {
    const made = engine.defaultFor(branch);
    if (isObj(made)) (config.tools as Json[]).push({ ...made, id: `kind_${i}` });
  });
  return config;
}

const corpus: { name: string; config: Json }[] = [
  { name: 'example', config: read('agent-config.example.json') as Json },
  ...starters.map((starter) => ({ name: `starter ${starter.id}`, config: applyStarter(fresh(), { company: 'Acme', starter }) as unknown as Json })),
  { name: 'scaled', config: scaledConfig() },
  { name: 'stress', config: stressConfig() },
];

const idsOf = (config: Json, collection: string): string[] => {
  const info = COLLECTIONS[collection];
  const holder = info.path.reduce<unknown>((node, key) => (isObj(node) ? node[key] : undefined), config);
  if (info.kind === 'list') return Array.isArray(holder) ? holder.map((item) => (isObj(item) ? item.id : undefined)).filter((id): id is string => typeof id === 'string' && !!id) : [];
  return isObj(holder) ? Object.keys(holder) : [];
};

// pointers whose value is not an id that exists (a "dangling" pointer)
function dangling(config: Json): string[] {
  const options = collectRefOptions(config);
  return allReferences(engine, config)
    .filter((hit) => hit.type === 'value' && typeof hit.value === 'string' && hit.value && !(options[hit.collection ?? ''] || []).includes(hit.value))
    .map((hit) => `${hit.path.join('.')} -> ${hit.value}`);
}

describe('conformance over a corpus of configs', () => {
  it('has the shapes that cause trouble: HTTP tools, many tools, several agents, every kind of channel', () => {
    const all = corpus.map((e) => e.config);
    const kinds = new Set(all.flatMap((c) => (Array.isArray(c.tools) ? c.tools : []).map((t) => (isObj(t) ? t.type : undefined))));
    ['http', 'builtin'].forEach((k) => expect(kinds.has(k)).toBe(true));
    expect(all.some((c) => Array.isArray(c.tools) && c.tools.length >= 30)).toBe(true);
    expect(all.some((c) => isObj(c.agents) && Array.isArray(c.agents.items) && c.agents.items.length >= 6)).toBe(true);
    expect(all.some((c) => Array.isArray(c.channels) && c.channels.length >= 5)).toBe(true);
    expect(corpus.length).toBeGreaterThanOrEqual(10);
  });

  corpus.forEach((entry) => {
    it(`${entry.name}: renaming every id and key leaves nothing pointing at the old name, and renaming back restores it`, () => {
      const before = dangling(entry.config);
      let renamed = 0;
      for (const collection of Object.keys(COLLECTIONS)) {
        for (const id of idsOf(entry.config, collection)) {
          const to = `${id}_renamed`.slice(0, 64);
          const usesBefore = findUsage(engine, entry.config, collection, id).length;
          const next = renameEverywhere(engine, clone(entry.config), collection, id, to);
          expect(findUsage(engine, next, collection, id).length, `${collection} “${id}”: something still points at the old name`).toBe(0);
          expect(findUsage(engine, next, collection, to).length, `${collection} “${id}”: every pointer moved`).toBe(usesBefore);
          expect(idsOf(next, collection).includes(to) && !idsOf(next, collection).includes(id)).toBe(true);
          const worse = dangling(next).filter((d) => !before.includes(d.replace(to, id)) && !before.includes(d));
          expect(worse, `${collection} “${id}”: renaming left a pointer to nothing`).toEqual([]);
          expect(renameEverywhere(engine, clone(next), collection, to, id)).toEqual(entry.config);
          renamed += 1;
        }
      }
      expect(renamed > 0 || Object.keys(entry.config).length < 6).toBe(true);
    });

    it(`${entry.name}: every section has a kind of control the form can draw`, () => {
      const props = schema.properties as Record<string, RawSchema>;
      Object.keys(entry.config).forEach((key) => {
        if (key === 'schema_version') return;
        expect(key in props, `${key} is a section of the schema`).toBe(true);
        const kind = engine.kindOf(engine.resolveShape(props[key], entry.config[key]));
        expect(['object', 'array', 'map'].includes(kind) || !isComplex(engine, props[key]), `${key} draws as ${kind}`).toBe(true);
      });
    });
  });
});
