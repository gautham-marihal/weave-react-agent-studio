import { describe, expect, it } from 'vitest';
import type { AgentConfig, Issue } from '../types/studio';
import { SCHEMA } from '../test/schemaKeys';
import { changesSince } from './changes';
import {
  TOOL,
  askAssistant,
  compactSchema,
  explainFailure,
  keepStudioNotes,
  loadStatus,
  postToModel,
  readAnswer,
  repairMessage,
  requestMessage,
  systemPrompt } from
'./assistant';

const base = (): AgentConfig => ({
  schema_version: '1.2',
  meta: { id: 'x', name: 'X', version: '0.1.0', status: 'draft' },
  channels: [{ id: 'web-chat', type: 'web_chat', enabled: true }],
  agents: { entry: 'assistant', items: [{ id: 'assistant', name: 'Assistant', instructions: { role: 'Help.' } }] }
});
let n = 0;
const reply = (config: AgentConfig, extra: Record<string, unknown> = {}) => {
  n += 1;
  return {
    content: [{ type: 'tool_use', id: `t${n}`, name: TOOL.name, input: { config, summary: 'Done.', ...extra } }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 }
  };
};
type Body = {model: string;tool_choice: unknown;tools: {name: string;}[];system: {cache_control: {type: string;};}[];messages: {role: string;content: unknown;}[];temperature?: number;};

describe('what the model is told', () => {
  it('the schema sent is shorter, without the studio-only hints, and the system prompt carries the rules', () => {
    const compact = JSON.stringify(compactSchema(SCHEMA));
    expect(compact.length).toBeLessThan(JSON.stringify(SCHEMA).length);
    expect(compact).not.toContain('"x-ui"');
    const prompt = systemPrompt(SCHEMA);
    expect(prompt).toMatch(/submit_config/);
    expect(prompt).toMatch(/NEVER invent secrets/);
    expect(prompt).toContain('"properties"');
  });

  it('the request carries the current draft, the wish, and what was asked earlier; a repair lists what the checks found', () => {
    const msg = requestMessage({ request: ' add a Spanish greeting ', config: { meta: { name: 'A' } }, earlier: ['one', 'two'] });
    expect(msg).toMatch(/CURRENT DRAFT/);
    expect(msg).toMatch(/REQUEST:\nadd a Spanish greeting$/);
    expect(msg).toMatch(/1\. one/);
    const fix = repairMessage([{ path: ['agents', 'items', 0, 'tools'], message: 'must be a list' }, { path: [], message: 'bad' }]);
    expect(fix).toMatch(/agents\.items\.0\.tools: must be a list/);
    expect(fix).toMatch(/\(whole document\): bad/);
  });
});

describe('reading the answer', () => {
  it('reads the tool call, and every way it can go wrong is a sentence a person can read', () => {
    const ok = readAnswer({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: TOOL.name, input: { config: { meta: {} }, summary: ' Built. ', assumptions: ['a', '', 3], questions: 'nope' } }]
    });
    expect([ok.config, ok.summary, ok.assumptions, ok.questions, ok.toolUseId]).toEqual([{ meta: {} }, 'Built.', ['a'], [], 't1']);
    expect(() => readAnswer(null)).toThrow(/does not understand/);
    expect(() => readAnswer({ content: [], stop_reason: 'max_tokens' })).toThrow(/cut off/);
    expect(() => readAnswer({ content: [], stop_reason: 'refusal' })).toThrow(/declined/);
    expect(() => readAnswer({ content: [{ type: 'text', text: 'I cannot' }] })).toThrow(/instead of a configuration: “I cannot”/);
    expect(() => readAnswer({ content: [{ type: 'tool_use', id: 'x', name: TOOL.name, input: { config: 5 } }] })).toThrow(/not a configuration/);
  });
});

describe('asking, checking, repairing', () => {
  it('checks a good answer once and returns it with what it assumed and what is still open', async () => {
    const next = { ...base(), persona: { name: 'X', tone: 'warm' } };
    const calls: Body[] = [];
    const steps: string[] = [];
    const result = await askAssistant({
      request: 'be warm',
      config: base(),
      schema: SCHEMA,
      model: 'claude-opus-5-5',
      onStep: (s) => steps.push(s),
      post: async (body) => {
        calls.push(body as unknown as Body);
        return reply(next, { assumptions: ['Assumed English.'], questions: ['What is the opening time?'] });
      },
      validate: async () => ({ errors: [], warnings: [{ path: null, message: 'w' }] })
    });
    expect(result.config).toEqual(next);
    expect([result.assumptions, result.questions, result.repairs, result.issues.errors.length, result.issues.warnings.length]).toEqual([['Assumed English.'], ['What is the opening time?'], 0, 0, 1]);
    expect(result.usage).toEqual({ input: 10, output: 5, cached: 7 });
    expect(steps).toEqual(['thinking', 'checking']);
    expect(calls).toHaveLength(1);
    // current models refuse a forced tool choice and sampling settings: the prompt asks for the tool instead
    expect([calls[0].model, calls[0].tool_choice, calls[0].tools[0].name, calls[0].temperature]).toEqual(['claude-opus-5-5', { type: 'auto' }, 'submit_config', undefined]);
    expect(calls[0].system[0].cache_control.type).toBe('ephemeral');
    expect(String(calls[0].messages[0].content)).toMatch(/be warm/);
  });

  it('hands errors back to the model, up to twice, and keeps the answer that finally passes', async () => {
    const bad = { ...base(), agents: { entry: 'nobody', items: base().agents?.items } };
    let round = 0;
    const seen: Body['messages'][] = [];
    const result = await askAssistant({
      request: 'r',
      config: base(),
      schema: SCHEMA,
      model: 'm',
      post: async (body) => {
        seen.push(JSON.parse(JSON.stringify((body as unknown as Body).messages)) as Body['messages']);
        round += 1;
        return reply(round < 3 ? bad : base());
      },
      validate: async (c) => ({ errors: c.agents?.entry === 'nobody' ? [{ path: ['agents', 'entry'], message: 'unknown agent' }] as Issue[] : [], warnings: [] })
    });
    expect(round).toBe(3);
    expect(result.repairs).toBe(2);
    expect(result.issues.errors).toHaveLength(0);
    const last = seen[2];
    expect(last.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    const repair = (last[4].content as {type: string;is_error: boolean;content: string;}[])[0];
    expect([repair.type, repair.is_error]).toEqual(['tool_result', true]);
    expect(repair.content).toMatch(/agents\.entry: unknown agent/);
  });

  it('reports what remains after the last repair, and keeps the studio’s own notes an answer dropped', async () => {
    const withNotes = { ...base(), builder: { ui: { graph_positions: { assistant: { x: 1, y: 2 } } } } };
    let calls = 0;
    const result = await askAssistant({
      request: 'r',
      config: withNotes,
      schema: SCHEMA,
      model: 'm',
      maxRepairs: 1,
      post: async () => {
        calls += 1;
        return reply(base());
      },
      validate: async () => ({ errors: [{ path: ['a'], message: 'still wrong' }], warnings: [] })
    });
    expect(calls).toBe(2);
    expect(result.issues.errors).toHaveLength(1);
    expect(result.config.builder).toEqual(withNotes.builder);
    expect(keepStudioNotes(withNotes, { builder: { x: 1 } }).builder?.x).toBe(1);
    await expect(askAssistant({ request: '  ', config: base(), schema: SCHEMA, model: 'm', post: async () => reply(base()), validate: async () => ({}) })).rejects.toThrow(/Say what you need/);
  });

  it('drops saved places for blocks that are gone, so the Workflow is drawn from what the agent is now', () => {
    const before = { ...base(), builder: { ui: { graph_positions: { assistant: { x: 1, y: 2 }, 'tool::old': { x: 3, y: 4 }, 'channel::web-chat': { x: 0, y: 0 } } } } };
    const after = { ...base(), builder: before.builder };
    expect(Object.keys(keepStudioNotes(before, after).builder?.ui?.graph_positions ?? {})).toEqual(['assistant', 'channel::web-chat']);
    const none = { ...base(), agents: { entry: 'a', items: [{ id: 'a', name: 'A' }] }, channels: [], builder: { ui: { graph_positions: { assistant: { x: 1, y: 1 } } } } };
    expect(keepStudioNotes(before, none).builder).toBeUndefined();
  });
});

describe('the call to the model', () => {
  it('explains failures, tells a missing server apart, and the status never throws', async () => {
    expect(explainFailure(503, { error: 'x' })).toMatch(/ANTHROPIC_API_KEY/);
    expect(explainFailure(401, null)).toMatch(/did not accept the key/);
    expect(explainFailure(429, null)).toMatch(/busy/);
    expect(explainFailure(529, { error: { message: 'overloaded' } })).toMatch(/overloaded/);
    expect(explainFailure(400, { error: { message: 'bad thing' } })).toBe('bad thing');
    const res = (ok: boolean, status: number, text: string) => async () => ({ ok, status, text: async () => text, json: async () => JSON.parse(text) as unknown });
    await expect(postToModel({}, undefined, async () => {
      throw new Error('down');
    })).rejects.toThrow(/could not reach/);
    await expect(postToModel({}, undefined, res(false, 503, '{"error":"No AI"}'))).rejects.toThrow(/No AI model is set up/);
    await expect(postToModel({}, undefined, res(true, 200, 'html'))).rejects.toThrow(/not JSON/);
    expect(await postToModel({}, undefined, res(true, 200, '{"a":1}'))).toEqual({ a: 1 });
    expect(await loadStatus(async () => {
      throw new Error('x');
    })).toEqual({ configured: false });
    expect(await loadStatus(res(true, 200, '{"configured":true,"model":"m"}'))).toEqual({ configured: true, model: 'm' });
    expect(await loadStatus(res(true, 200, '"<html>"'))).toEqual({ configured: false });
    expect(await loadStatus(res(false, 404, '{}'))).toEqual({ configured: false });
  });
});

describe('what a proposal changes, in words', () => {
  it('is found by place, matching list items by id, without the studio notes', () => {
    const before = base();
    const after: AgentConfig = {
      ...base(),
      persona: { tone: 'formal' },
      agents: { entry: 'assistant', items: [...(base().agents?.items ?? []), { id: 'billing', name: 'Billing' }] },
      builder: { ui: { graph_positions: { billing: { x: 1, y: 1 } } } }
    };
    const summary = changesSince(before, after);
    const texts = summary.groups.flatMap((g) => g.items.map((i) => i.text));
    expect(texts).toContain('Added the agent “Billing”');
    expect(summary.groups.map((g) => g.key).sort()).toEqual(['agents', 'persona']);
    expect(summary.groups.some((g) => g.key === 'builder')).toBe(false);
  });
});
