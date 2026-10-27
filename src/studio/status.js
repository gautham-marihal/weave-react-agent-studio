// One vocabulary for an agent's state on every page: Draft, Tested, Live in … (journey order), and Needs attention,
// which outranks them all because a problem matters more than a milestone. Pure: no React, no DOM.

export const STATES = {
  attention: {
    id: 'attention',
    label: 'Needs attention',
    tone: 'bad',
    hint: 'Something is wrong: the configuration is invalid, tests are failing, or a check found a problem.',
  },
  production: { id: 'production', label: 'Live in Production', tone: 'live', hint: 'Serving real callers.' },
  staging: { id: 'staging', label: 'Live in Staging', tone: 'review', hint: 'Being checked before it goes live.' },
  development: { id: 'development', label: 'Live in Development', tone: 'dev', hint: 'Running for testing only.' },
  tested: { id: 'tested', label: 'Tested', tone: 'good', hint: 'Its tests pass. It is not live anywhere yet.' },
  draft: { id: 'draft', label: 'Draft', tone: 'draft', hint: 'Still being built.' },
};

// `deployed`: { development: '0.1.0', production: null… } as the API gives it. `tests`: 'passed' | 'failed' | 'none' |
// 'unknown'. `problems`: the number of things wrong (errors, failing tests counted separately by `tests`).
export function agentState({ deployed = {}, tests = 'unknown', problems = 0 } = {}) {
  const live = (env) => !!(deployed && deployed[env]);
  if (problems > 0 || tests === 'failed') return STATES.attention;
  if (live('production')) return STATES.production;
  if (live('staging')) return STATES.staging;
  if (live('development')) return STATES.development;
  if (tests === 'passed') return STATES.tested;
  return STATES.draft;
}

// The line under an agent's name: parts with a tone; one with nothing to say (e.g. calls not read yet) is left out.
// Tests: each scenario counts by its latest result, so "4 of 7 passing" can't hide that three have not run.
export function testsPart(s) {
  if (!s || !s.total) return { id: 'tests', text: 'No tests written', tone: 'idle' };
  const said = (n, what) => (n ? `${n} ${what}` : '');
  const notRun = [said(s.liveNotRun, 'live, not run'), said(s.scriptedNotRun, 'not run')].filter(Boolean).join(' · ');
  if (s.failed > 0) return { id: 'tests', text: [`${s.failed} failing`, said(s.passed, 'passing'), notRun].filter(Boolean).join(' · '), tone: 'bad' };
  if (s.passed === 0) return { id: 'tests', text: `${s.total} test${s.total === 1 ? '' : 's'}, not run yet`, tone: 'idle' };
  if (s.notRun === 0) return { id: 'tests', text: s.total === 1 ? '1 test passing' : `All ${s.total} tests passing`, tone: 'ok' };
  // only live ones are left, so it's fine to say so; an unrun scripted scenario means the story is half told
  return { id: 'tests', text: [`${s.passed} passed`, notRun].filter(Boolean).join(' · '), tone: s.scriptedNotRun ? 'idle' : 'ok' };
}

export function statusLine({ dirty = false, savedAt = '', scenarioCount = 0, run = null, scenarios = null, deployed = {}, callsToday = null } = {}) {
  const parts = [];
  parts.push(
    dirty ? { id: 'draft', text: 'Unsaved changes', tone: 'warn' } : { id: 'draft', text: savedAt ? `Draft saved ${savedAt}` : 'Draft saved', tone: 'ok' },
  );
  if (scenarioCount === 0) parts.push({ id: 'tests', text: 'No tests written', tone: 'idle' });
  else if (scenarios && scenarios.total > 0) parts.push(testsPart(scenarios));
  else if (!run) parts.push({ id: 'tests', text: `${scenarioCount} test${scenarioCount === 1 ? '' : 's'}, not run yet`, tone: 'idle' });
  else if (run.status === 'passed') parts.push({ id: 'tests', text: `Tests ${run.passed ?? run.total} of ${run.total} passing`, tone: 'ok' });
  else if (run.status === 'skipped') parts.push({ id: 'tests', text: 'Tests skipped in the last run', tone: 'warn' });
  else parts.push({ id: 'tests', text: `Tests ${run.passed ?? 0} of ${run.total} passing`, tone: 'bad' });
  const where = ['production', 'staging', 'development'].filter((env) => deployed && deployed[env]);
  if (where.length) parts.push({ id: 'live', text: `Live in ${where.map((env) => env[0].toUpperCase() + env.slice(1)).join(' and ')}`, tone: 'ok' });
  else parts.push({ id: 'live', text: 'Not live anywhere yet', tone: 'idle' });
  if (typeof callsToday === 'number')
    parts.push({ id: 'calls', text: callsToday === 0 ? 'No calls today' : `${callsToday} call${callsToday === 1 ? '' : 's'} today`, tone: 'idle' });
  return parts;
}

// An agent's state in the list: where it is deployed and, once read, its health (see health/health.js).
export function stateFromHealth(bot, health) {
  const parts = Array.isArray(health?.parts) ? health.parts : [];
  const failing = parts.some((p) => p.id === 'tests_failing');
  const invalid = parts.some((p) => p.id === 'invalid' || p.id === 'security');
  const passed = !!health?.checked?.includes('tests') && !failing && !parts.some((p) => p.id === 'tests_not_run');
  return agentState({ deployed: bot?.deployed || {}, tests: failing ? 'failed' : passed ? 'passed' : 'unknown', problems: invalid ? 1 : 0 });
}
