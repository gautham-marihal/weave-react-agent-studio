import { describe, expect, it } from 'vitest';
import { isSkipped, violations } from './no-fake-rules.mjs';

const why = (path, text) => violations(path, text).map((v) => v.why);

describe('no-fake rules', () => {
  it.each([
    ['simulated replies', "export function getSimulatedReply(input) {}"],
    ['a "simulated" label', '<StatusChip>Simulated AI</StatusChip>'],
    ['fake async jobs', 'const fakeAsyncJob = () => new Promise(() => {});'],
    ['a demo data badge', "label = 'Demo Data'"],
    ['a hardcoded "has" flag', 'const hasTested = true; // In demo/seed or calls exist'],
    ['a hardcoded IP', "const target = env.AGENT_BUILDER_URL || 'http://16.79.174.151:8100'"],
    ['random values', 'dnis: `90${Math.floor(100 + Math.random() * 900)}`'],
    ['mock workers', "import { setupWorker } from 'msw/browser'"],
  ])('catches %s', (_name, text) => {
    expect(violations('src/x.tsx', text)).not.toHaveLength(0);
  });

  it('leaves ordinary code alone', () => {
    expect(why('src/x.tsx', "const hasKey = !!p.key_available;\nconst version = '0.1.0';\nmocks: number;")).toEqual([]);
  });

  it('allows Math.random only where it makes ids', () => {
    const text = 'Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16))';
    expect(why('src/utils/format.ts', text)).toEqual([]);
    expect(why('src/pages/Live.tsx', text)).toHaveLength(1);
  });

  it('keeps sample data in src/sandbox, loaded only with import()', () => {
    expect(isSkipped('src/sandbox/sandboxApi.ts')).toBe(true);
    expect(isSkipped('src/pages/Telephony.tsx')).toBe(false);
    expect(why('src/api/client.ts', "import { sandboxAnswer } from '../sandbox/sandboxApi';")).toHaveLength(1);
    expect(why('src/api/client.ts', "const { sandboxAnswer } = await import('../sandbox/sandboxApi');\nimport { isSandbox } from '../sandbox/mode';")).toEqual([]);
  });

  it('still catches other rules in an allowed file', () => {
    expect(why('src/utils/format.ts', '// simulated')).toHaveLength(1);
  });
});
