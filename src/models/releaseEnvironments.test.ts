import { describe, expect, it } from 'vitest';
import type { PhoneNumber } from '../api/types';
import { deploySecretsMissing, environmentList, noteDeploySecrets, numberProblems, numbersByEnvironment, readNumbers } from './releaseEnvironments';

const number = (n: string, environment: string | null, problems: PhoneNumber['problems'] = []): PhoneNumber => ({
  number: n,
  managed: true,
  trunk: null,
  bot: 'a',
  environment,
  rule: null,
  options: { record_audio: true, krisp: false, allowed_addresses: [], max_call_duration_s: null },
  problems,
});

describe('where an agent runs', () => {
  it('uses the server’s environments, in its order', () => {
    expect(environmentList(['development', 'uat', 'production'], ['staging'])).toEqual({ names: ['development', 'uat', 'production'], fromServer: true });
  });

  it('without the server’s list, shows only the environments the deployments name, never invented ones', () => {
    expect(environmentList(null, ['production', 'development', 'production'])).toEqual({ names: ['development', 'production'], fromServer: false });
    expect(environmentList(undefined, [])).toEqual({ names: [], fromServer: false });
    expect(environmentList([], ['staging']).names).toEqual(['staging']);
  });

  it('reads the agent’s numbers in either shape and groups them by environment', () => {
    const rows = [number('+6590001', 'development'), number('+6590002', 'production'), number('+6590003', 'development'), number('+6590004', null)];
    expect(readNumbers({ numbers: rows })).toHaveLength(4);
    expect(readNumbers(rows)).toHaveLength(4);
    expect(readNumbers({ nothing: true })).toEqual([]);
    expect(numbersByEnvironment(rows)).toEqual({ development: ['+6590001', '+6590003'], production: ['+6590002'] });
    expect(numberProblems(number('+1', 'x', ['Nothing is deployed.', { problem: 'No phone channel.', fix: 'Add one.' }]))).toEqual(['Nothing is deployed.', 'No phone channel. Add one.']);
  });

  it('remembers the secrets missing at the last deploy while that version still runs there', () => {
    noteDeploySecrets('acme', 'staging', '1.2.0', ['CRM_TOKEN']);
    expect(deploySecretsMissing('acme', 'staging', '1.2.0')).toEqual(['CRM_TOKEN']);
    expect(deploySecretsMissing('acme', 'staging', '1.3.0')).toEqual([]);
    expect(deploySecretsMissing('acme', 'production', '1.2.0')).toEqual([]);
    noteDeploySecrets('acme', 'staging', '1.3.0', []);
    expect(deploySecretsMissing('acme', 'staging', '1.3.0')).toEqual([]);
  });
});
