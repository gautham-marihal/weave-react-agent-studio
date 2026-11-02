import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import { READINESS_CHECKS, checkRunOf, hasHumanHandoff, keepRuns, runReadinessChecks } from './checks';

const bare = (): AgentConfig => ({ meta: { id: 'b', name: 'B' }, channels: [], tools: [] });

const ready = (): AgentConfig => ({
  meta: { id: 'r', name: 'R' },
  channels: [
    { id: 'web-chat', type: 'web_chat', enabled: true, greeting: { say: 'Hello!' } },
    { id: 'web-voice', type: 'web_voice', enabled: true, modalities: { input: ['audio'], output: ['audio'] } },
  ],
  agents: { entry: 'main', items: [{ id: 'main', name: 'Main', instructions: { role: 'Help with orders.' } }] },
  tools: [
    { id: 'end_call', type: 'builtin', builtin: 'end_call' },
    { id: 'person', type: 'builtin', builtin: 'transfer_or_callback' },
    { id: 'lookup', type: 'http' },
  ],
  defaults: {
    conversation: { inactivity: { enabled: true, nudges: ['Are you there?'] } },
    models: { stt: { provider: 'deepgram' }, tts: { provider: 'elevenlabs', voice_id: 'abc' } },
  },
  guardrails: { input: [{ id: 'no_tricks', type: 'prompt_injection' }] },
  post_call: { recording: { transcript: true } },
});

describe('readiness checks', () => {
  it('read a well set up agent as ready for every everyday situation', () => {
    const results = runReadinessChecks(ready());
    expect(results).toHaveLength(READINESS_CHECKS.length);
    expect(results.filter((r) => !r.passed).map((r) => r.id)).toEqual([]);
    expect(results.every((r) => r.detail)).toBe(true);
  });

  it('say what is missing on a bare agent, and never throw', () => {
    const results = runReadinessChecks(bare());
    expect(results.every((r) => !r.passed)).toBe(true);
    expect(results.find((r) => r.id === 'greet')?.detail).toBe('No channel has a greeting.');
    expect(runReadinessChecks(null).every((r) => r.detail === 'The configuration couldn’t be read.')).toBe(true);
    expect(() => runReadinessChecks({ channels: 'x', tools: 7, agents: { items: 'no' } } as unknown as AgentConfig)).not.toThrow();
  });

  it('count a transfer, a callback tool or an escalation rule as a way to reach a person', () => {
    expect(hasHumanHandoff(bare())).toBe(false);
    expect(hasHumanHandoff({ ...bare(), telephony: { transfers: [{ id: 't' }] } })).toBe(true);
    expect(hasHumanHandoff({ ...bare(), guardrails: { escalation: [{ action: 'handoff' }] } })).toBe(true);
  });

  it('keep a run with its counts, and keep runs newest first without anything that is not a run', () => {
    const results = runReadinessChecks(ready());
    const run = checkRunOf('acme', 'draft', 'The saved draft', results, '2026-10-30T10:00:00Z', 'check_1');
    expect([run.passed, run.total, run.id]).toEqual([results.length, results.length, 'check_1']);
    expect(run.id).not.toMatch(/^SIM_/);
    const older = { ...run, id: 'check_0', ranAt: '2026-10-29T10:00:00Z' };
    expect(keepRuns([older, 'junk', null, run]).map((r) => r.id)).toEqual(['check_1', 'check_0']);
    expect(keepRuns([run, older], 1)).toHaveLength(1);
    expect(keepRuns('not a list')).toEqual([]);
  });
});
