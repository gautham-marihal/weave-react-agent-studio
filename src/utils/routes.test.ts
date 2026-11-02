import { describe, expect, it } from 'vitest';
import { agentPath, callPath, leavesAgent, safeReturnPath } from './routes';

describe('safeReturnPath (where signing in sends you back to)', () => {
  it('keeps a page of this app, with its query and hash', () => {
    expect(safeReturnPath('/')).toBe('/');
    expect(safeReturnPath('/agents/gm/build?setting=a.b#x')).toBe('/agents/gm/build?setting=a.b#x');
    expect(safeReturnPath('/calls/c%201?agent=a')).toBe('/calls/c%201?agent=a');
  });

  it('sends anything that could leave the app Home', () => {
    for (const bad of [
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      ' //evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
    ]) {
      expect(safeReturnPath(bad), JSON.stringify(bad)).toBe('/');
    }
  });

  it('anything that is not an address goes to the fallback', () => {
    expect(safeReturnPath(undefined)).toBe('/');
    expect(safeReturnPath(null)).toBe('/');
    expect(safeReturnPath({ pathname: '//evil.example' })).toBe('/');
    expect(safeReturnPath('//evil.example', '/agents')).toBe('/agents');
  });
});

describe('routes', () => {
  it('builds agent and call addresses', () => {
    expect(agentPath('weave-studio-test')).toBe('/agents/weave-studio-test');
    expect(agentPath('weave-studio-test', 'release')).toBe('/agents/weave-studio-test/release');
    expect(callPath('a', 'c 1')).toBe('/calls/c%201?agent=a');
  });

  it('moving between an agent’s own pages does not leave it', () => {
    expect(leavesAgent('gm', '/agents/gm')).toBe(false);
    expect(leavesAgent('gm', '/agents/gm/test')).toBe(false);
    expect(leavesAgent('gm', '/agents/gm/build/agent')).toBe(false);
  });

  it('another agent (even one whose id starts the same) or another page leaves it', () => {
    expect(leavesAgent('gm', '/agents/gm-225/build')).toBe(true);
    expect(leavesAgent('gm', '/agents')).toBe(true);
    expect(leavesAgent('gm', '/calls')).toBe(true);
    expect(leavesAgent('gm', '/')).toBe(true);
  });
});

import { inSetup } from './setupProgress';
import { setupStepForReadiness } from '../models/setup';

describe('the guided setup opens a step while the agent is being set up', () => {
  const p = (over: Partial<{ step: ''; tried: boolean; finished: boolean; known: boolean }>) => ({ step: '' as const, tried: false, finished: false, known: false, ...over });
  it('started here and not finished, or never published: in setup', () => {
    expect(inSetup(p({ known: true }), true)).toBe(true);
    expect(inSetup(p({}), false)).toBe(true);
  });
  it('finished, or published and never set up here: its own pages', () => {
    expect(inSetup(p({ known: true, finished: true }), false)).toBe(false);
    expect(inSetup(p({}), true)).toBe(false);
  });
  it('readiness steps map to the setup step that does them', () => {
    expect(setupStepForReadiness('prompt')).toBe('purpose');
    expect(setupStepForReadiness('voice')).toBe('voice');
    expect(setupStepForReadiness('deploy')).toBe('live');
    expect(setupStepForReadiness('checks')).toBe('');
  });
});
