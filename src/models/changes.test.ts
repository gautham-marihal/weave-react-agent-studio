import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { changesSince, describeChange, plainChanges, restoreAsDraft, revertSection } from './changes';

const published: AgentConfig = {
  meta: { id: 'a', name: 'A', version: '0.1.0', status: 'published' },
  persona: { name: 'Ada', tone: 'warm' },
  channels: [{ id: 'web', type: 'web_chat', enabled: true, greeting: { say: 'Hi' } }],
  tools: [{ id: 'end_call', type: 'builtin', description: 'Ends it' } as never],
  builder: { ui: { graph_positions: { x: 1 } } },
};
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const texts = (s: ReturnType<typeof plainChanges>) => s.groups.flatMap((g) => g.items.map((i) => i.text));

describe('changesSince', () => {
  it('no changes: nothing to review', () => {
    expect(changesSince(published, copy(published))).toEqual({ total: 0, groups: [] });
  });

  it('server bookkeeping and the studio’s layout notes are not changes', () => {
    const draft = copy(published);
    draft.meta = { ...draft.meta, version: '0.1.1', status: 'draft', updated_at: '2026-10-26T10:00:00Z' };
    (draft.builder as { ui: { graph_positions: { x: number } } }).ui.graph_positions.x = 99;
    expect(changesSince(published, draft).total).toBe(0);
  });

  it('changes are grouped by part, in plain words', () => {
    const draft = copy(published);
    draft.persona = { ...draft.persona, tone: 'brisk' };
    draft.meta = { ...draft.meta, name: 'B' };
    const r = changesSince(published, draft);
    expect(r.total).toBe(2);
    expect(r.groups.map((g) => g.key).sort()).toEqual(['meta', 'persona']);
    expect(texts(r)).toContain('Changed the tone from “warm” to “brisk”');
    expect(texts(r)).toContain('Changed the name from “A” to “B”');
    expect(r.groups.find((g) => g.key === 'persona')?.title).toBe('Personality');
  });

  it('a greeting change and a tool added read as sentences', () => {
    const draft = copy(published);
    draft.channels = (draft.channels ?? []).map((c) => ({ ...c, greeting: { say: 'Hello' } }));
    draft.tools = [...(draft.tools ?? []), { id: 'transfer', type: 'http', description: 'Pass to a person' } as never];
    expect(texts(changesSince(published, draft))).toEqual(['Changed the greeting of the channel “web” from “Hi” to “Hello”', 'Added the tool “transfer”']);
  });

  it('a missing published version (or draft) yields no changes', () => {
    expect(changesSince(null, published).total).toBe(0);
    expect(changesSince(published, undefined).total).toBe(0);
  });
});

describe('plainChanges: the server’s GET /diff in words', () => {
  it('model, voice and language changes say what changed without code words', () => {
    const r = plainChanges([
      { op: 'change', path: ['defaults', 'models', 'llm', 'model'], before: 'gpt-4.1-mini', after: 'gpt-4.1' },
      { op: 'change', path: ['defaults', 'language', 'primary'], before: 'en-US', after: 'es-MX' },
      { op: 'change', path: ['defaults', 'language', 'speaks'], before: ['en'], after: ['en', 'fr'] },
    ]);
    expect(r.groups.map((g) => g.title)).toEqual(['Language, voice and AI model']);
    expect(texts(r)).toEqual([
      'Changed the AI model from “gpt-4.1-mini” to “gpt-4.1”',
      'Changed the main language from “English (United States)” to “Spanish (Mexico)”',
      'Changed the languages it answers in from “English” to “English, French”',
    ]);
  });

  it('items of a list are named by their id; settings by the names the forms use', () => {
    const t = texts(plainChanges([
      { op: 'add', path: ['tools', 'id=lookup_order'], after: { id: 'lookup_order', name: 'Look up an order' } },
      { op: 'remove', path: ['agents', 'items', 'id=billing'], before: { id: 'billing' } },
      { op: 'change', path: ['post_call', 'recording', 'audio'], before: false, after: true },
    ]));
    expect(t).toEqual(['Added the tool “Look up an order”', 'Removed the agent “billing”', 'Changed “Record audio” from “off” to “on”']);
  });

  it('a rule in a list of rules is named by what it says, not its place', () => {
    expect(texts(plainChanges([{ op: 'add', path: ['persona', 'style_rules', 1], after: 'Keep answers short.' }]))).toEqual(['Added the style rule “Keep answers short.”']);
    expect(texts(plainChanges([{ op: 'remove', path: ['persona', 'shared_rules', 0], before: 'Be kind.' }]))).toEqual(['Removed the shared rule “Be kind.”']);
    expect(texts(plainChanges([{ op: 'change', path: ['persona', 'style_rules', 0], before: 'Be kind.', after: 'Be brief.' }]))).toEqual(['Changed the style rule from “Be kind.” to “Be brief.”']);
  });

  it('a long text keeps its full wording; a short one does not', () => {
    const long = 'You are a helpful agent. '.repeat(10);
    const c = describeChange({ op: 'change', path: ['agents', 'items', 'id=main', 'instructions', 'role'], before: long, after: `${long}Be kind.` });
    expect(c.text).toBe('Changed the instructions of the agent “main”');
    expect(c.full?.after.endsWith('Be kind.')).toBe(true);
    expect(describeChange({ op: 'change', path: ['persona', 'tone'], before: 'warm', after: 'formal' }).full).toBeNull();
  });

  it('the server’s bookkeeping and the studio’s notes are not counted', () => {
    const r = plainChanges([
      { op: 'change', path: ['meta', 'version'], before: '1.0.0', after: '1.0.1' },
      { op: 'change', path: ['meta', 'updated_at'], before: 'a', after: 'b' },
      { op: 'change', path: ['builder', 'ui'], before: 1, after: 2 },
      { op: 'change', path: ['persona', 'tone'], before: 'warm', after: 'formal' },
    ]);
    expect(r.total).toBe(1);
    expect(plainChanges([])).toEqual({ total: 0, groups: [] });
  });
});

describe('revertSection: put a part back as published', () => {
  it('restores that part and leaves the rest alone, without changing the draft', () => {
    const draft = copy(published);
    draft.persona = { ...draft.persona, tone: 'brisk' };
    draft.meta = { ...draft.meta, name: 'B' };
    const next = revertSection(draft, published, 'persona');
    expect(next.persona?.tone).toBe('warm');
    expect(next.meta?.name).toBe('B');
    expect(draft.persona?.tone).toBe('brisk');
  });

  it('a part that did not exist at publish time is removed', () => {
    const draft = { ...copy(published), guardrails: { topics: { allowed: ['orders'] } } };
    const next = revertSection(draft, published, 'guardrails');
    expect('guardrails' in next).toBe(false);
  });

  it('putting back the details keeps the draft’s own version, status and dates', () => {
    const draft = copy(published);
    draft.meta = { id: 'a', name: 'Renamed', version: '0.1.1', status: 'draft', updated_at: 'now' };
    const next = revertSection(draft, published, 'meta');
    expect(next.meta).toEqual({ id: 'a', name: 'A', version: '0.1.1', status: 'draft', updated_at: 'now' });
  });

  it('put back, then undo (the draft as it was) round-trips exactly', () => {
    const draft = copy(published);
    draft.persona = { ...draft.persona, tone: 'brisk', company: 'Acme' };
    draft.tools = [];
    const before = copy(draft);
    const reverted = revertSection(draft, published, 'tools');
    expect(reverted.tools).toEqual(published.tools);
    // Undo restores the editor's previous config object; it must equal the draft exactly.
    expect(draft).toEqual(before);
    expect(changesSince(published, revertSection(reverted, published, 'persona')).total).toBe(0);
  });
});

describe('restoreAsDraft: a version as the draft (an ordinary edit)', () => {
  it('takes everything from the version but keeps the draft’s bookkeeping', () => {
    const draft = { ...copy(published), meta: { id: 'a', name: 'Now', version: '0.2.3', status: 'draft' as const }, persona: { name: 'Zed' } };
    const restored = restoreAsDraft(draft, published);
    expect(restored.persona).toEqual(published.persona);
    expect(restored.meta).toEqual({ id: 'a', name: 'A', version: '0.2.3', status: 'draft' });
    expect(changesSince(published, restored).total).toBe(0);
  });
});
