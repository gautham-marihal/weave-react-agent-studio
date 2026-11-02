import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { emptyFacts, type CallFacts, type CallTurn } from './replayFacts';
import { diagnoseCall, headline, type Finding } from './fixcallDiagnose';
import { applyFixes, fasterModel, fixApplied, fixesFor } from './fixcallFixes';
import { diffConfigs } from '../utils/diff';
import { plainChanges } from './changes';

// "Fix this call": what a call's records show went wrong, and the small changes suggested for it.
const turn = (say: string, said: string | string[], extra: Partial<CallTurn> = {}): CallTurn => ({ say, said: Array.isArray(said) ? said : said ? [said] : [], tools: [], waitMs: null, ...extra });
const facts = (turns: CallTurn[], channelId = ''): CallFacts => ({ ...emptyFacts(), channelId, turns });
const config = (): AgentConfig => ({
  meta: { id: 'a', name: 'A' },
  persona: { style_rules: ['Be kind.'] },
  channels: [{ id: 'phone', type: 'sip_voice', enabled: true }],
  defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1' } } },
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main' }] },
});
const kinds = (findings: Finding[]) => findings.map((f) => f.kind);
const tool = (name: string, extra: Record<string, string> = {}) => ({ tool: name, args: {}, error: '', handoff: '', ...extra });

describe('what went wrong in a call', () => {
  it('a call that went well has nothing found, and says so', () => {
    const found = diagnoseCall(facts([turn('Hi, I need my balance', 'Sure, one moment.'), turn('Thanks', 'You are welcome.')], 'phone'), { config: config() });
    expect(found).toEqual([]);
    expect(headline(found)).toBe('Nothing obviously wrong was found in this call.');
  });

  it('a tool that failed is found once, with its error as the evidence, however many times it failed', () => {
    const failing = tool('lookup_order', { error: 'HTTP 500' });
    const found = diagnoseCall(facts([turn('Where is my order?', 'Let me check.', { tools: [failing] }), turn('Well?', 'One moment.', { tools: [failing] })]), { config: config() });
    const f = found.filter((x) => x.kind === 'tool_failed');
    expect(f).toHaveLength(1);
    expect([f[0].turn, f[0].severity, f[0].evidence]).toEqual([1, 'high', ['HTTP 500']]);
    expect(f[0].title).toMatch(/“lookup_order” failed \(2 times\)/);
  });

  it('a long wait, silence, a call cut off, and an answer too long to listen to', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const found = diagnoseCall(facts([turn('Hello', 'Hi.', { waitMs: 6200 }), turn('Are you there?', ''), turn('Tell me everything', long)], 'phone'), {
      call: { status: 'unfinished', duration_s: 41 },
      config: config(),
    });
    expect(kinds(found).sort()).toEqual(['cut_off', 'long_reply', 'no_answer', 'slow_answer']);
    expect(found.find((f) => f.kind === 'slow_answer')?.severity).toBe('medium');
    expect(found[0].severity).toBe('high');
    expect(found.find((f) => f.kind === 'no_answer')?.evidence[0]).toMatch(/Are you there\?/);
    expect(headline(found)).toBe('4 things found, 2 serious.');
  });

  it('a long answer is only a problem when it is spoken', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const chat = { ...config(), channels: [{ id: 'web', type: 'web_chat' as const, enabled: true }] };
    expect(kinds(diagnoseCall(facts([turn('Tell me everything', long)], 'web'), { config: chat }))).toEqual([]);
    expect(kinds(diagnoseCall(facts([turn('Tell me everything', long)], 'phone'), { config: config() }))).toEqual(['long_reply']);
  });

  it('the agent repeating itself and the caller having to repeat themselves are found', () => {
    const found = diagnoseCall(
      facts([
        turn('What are your hours?', 'We are open from nine to five on weekdays.'),
        turn('What are your hours', 'We are open from nine to five on weekdays.'),
        turn('I already said I want the hours', 'Let me help with something else.'),
      ]),
      { config: config() },
    );
    expect(kinds(found).sort()).toEqual(['caller_repeated', 'caller_repeated', 'repeated_answer']);
    expect(found.filter((f) => f.kind === 'caller_repeated').map((f) => f.turn)).toEqual([2, 3]);
  });

  it('a hand-over is noted as worth knowing, not as a failure', () => {
    const found = diagnoseCall(facts([turn('Give me a person', 'Connecting you.', { tools: [tool('transfer', { handoff: 'billing' })] })]), { config: config() });
    expect(found.map((x) => [x.kind, x.severity])).toEqual([['handed_over', 'low']]);
  });
});

describe('the suggested changes', () => {
  it('each kind of finding has a suggestion, shown as a sentence, that changes only what it says', () => {
    const base = config();
    const [failed] = fixesFor({ kind: 'tool_failed', tool: 'lookup_order' }, base);
    expect(failed.change).toMatch(/^Add this rule under How it speaks: “If the “lookup_order” tool fails/);
    const next = applyFixes(base, [failed]);
    expect(next.persona?.style_rules).toHaveLength(2);
    expect(fixApplied(next, failed)).toBe(true);
    expect(applyFixes(next, [failed])).toBe(next);
    expect(next.defaults).toEqual(base.defaults);
    (['cut_off', 'no_answer', 'long_reply', 'repeated_answer', 'caller_repeated', 'handed_over'] as const).forEach((kind) => expect(fixesFor({ kind }, base).length).toBeGreaterThanOrEqual(1));
    expect(fixesFor({ kind: 'nothing' as never }, base)).toEqual([]);
  });

  it('a slow answer can be met with a faster model, offered only when there is one and the model is not already fast', () => {
    const base = config();
    const fixes = fixesFor({ kind: 'slow_answer' }, base);
    const model = fixes.find((f) => f.kind === 'setting');
    if (!model) throw new Error('no faster model offered');
    expect(model.change).toMatch(/Change the language model from “GPT-4.1” to “GPT-4.1 mini”/);
    const next = applyFixes(base, [model]);
    expect(next.defaults?.models?.llm).toEqual({ provider: 'openai', model: 'gpt-4.1-mini' });
    expect(fixesFor({ kind: 'slow_answer' }, next).some((f) => f.kind === 'setting')).toBe(false);
    expect(fixes.some((f) => f.kind === 'wording')).toBe(true);
    expect(fasterModel({})).toBeNull();
  });

  it('the suggestions read as plain sentences when compared, and several can be applied together', () => {
    const base = config();
    const fixes = [...fixesFor({ kind: 'long_reply' }, base), ...fixesFor({ kind: 'caller_repeated' }, base)];
    const next = applyFixes(base, fixes);
    expect(next.persona?.style_rules).toHaveLength(3);
    const plain = plainChanges(diffConfigs(base, next, [], { listsByPosition: true }));
    expect(plain.groups.flatMap((g) => g.items).map((i) => i.text)).toEqual([expect.stringMatching(/^Added the style rule “Keep each answer/), expect.stringMatching(/^Added the style rule “If the caller repeats/)]);
    expect(plain.total).toBeGreaterThanOrEqual(1);
    expect(plain.groups.flatMap((g) => g.items).every((i) => !/persona\.style_rules/.test(i.text))).toBe(true);
  });
});
