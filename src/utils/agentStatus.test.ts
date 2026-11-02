import { describe, expect, it } from 'vitest';
import type { Agent, Deployment } from '../types/studio';
import { currentDeployments, newestFirst } from './agentStatus';

const d = (id: string, environment: Deployment['environment'], version: string, at: string, status: Deployment['status'] = 'active'): Deployment => ({
  id,
  status,
  environment,
  version,
  previous_version: null,
  deployed_at: at,
  deployed_by: 'x',
  note: '',
});
const agent = (deployments: Deployment[]) => ({ deployments }) as unknown as Agent;

describe('what runs where', () => {
  it('is the newest active deployment per environment, whatever order the server lists them in', () => {
    const oldestFirst = [d('a', 'development', '0.1.0', '2026-10-01T10:00:00Z'), d('b', 'staging', '0.1.0', '2026-10-01T10:00:00Z'), d('c', 'development', '0.1.1', '2026-10-02T10:00:00Z')];
    expect(currentDeployments(agent(oldestFirst)).development?.version).toBe('0.1.1');
    expect(currentDeployments(agent([...oldestFirst].reverse())).development?.version).toBe('0.1.1');
    expect(currentDeployments(agent(oldestFirst)).staging?.version).toBe('0.1.0');
  });

  it('a failed or pending deployment does not replace what runs', () => {
    const list = [d('a', 'production', '1.0.0', '2026-10-01T10:00:00Z'), d('b', 'production', '1.1.0', '2026-10-02T10:00:00Z', 'failed')];
    expect(currentDeployments(agent(list)).production?.version).toBe('1.0.0');
  });

  it('two deployments at the same moment: the one listed later is newer', () => {
    const same = [d('a', 'development', '0.1.0', '2026-10-01T10:00:00Z'), d('b', 'development', '0.1.1', '2026-10-01T10:00:00Z')];
    expect(newestFirst(same).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
