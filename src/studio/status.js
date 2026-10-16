// One vocabulary for where an agent is, used by the Agents list, the agent's header, the Deploy tab and the Home page, so the same agent never
// wears three different names for the same state. In the order of the journey: Draft, Tested, Live in Development, Live in Staging, Live in
// Production; and Needs attention, which outranks them all, because a customer should hear about a problem before a milestone.
// Pure: no React, no DOM.

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

// `deployed`: { development: '0.1.0', production: null… } as the API gives it. `tests`: 'passed' | 'failed' | 'none' | 'unknown'. `problems`: the number
// of things wrong (errors, failing tests counted separately by `tests`).
export function agentState({ deployed = {}, tests = 'unknown', problems = 0 } = {}) {
  const live = (env) => !!(deployed && deployed[env]);
  if (problems > 0 || tests === 'failed') return STATES.attention;
  if (live('production')) return STATES.production;
  if (live('staging')) return STATES.staging;
  if (live('development')) return STATES.development;
  if (tests === 'passed') return STATES.tested;
  return STATES.draft;
}

// The line under an agent's name: the parts worth saying, each with a tone. A part with nothing to say is left out (the number of calls is unknown
// until it has been read, and nothing is claimed about it before then).
export function statusLine({ dirty = false, savedAt = '', scenarioCount = 0, run = null, deployed = {}, callsToday = null } = {}) {
  const parts = [];
  parts.push(
    dirty ? { id: 'draft', text: 'Unsaved changes', tone: 'warn' } : { id: 'draft', text: savedAt ? `Draft saved ${savedAt}` : 'Draft saved', tone: 'ok' },
  );
  if (scenarioCount === 0) parts.push({ id: 'tests', text: 'No tests written', tone: 'idle' });
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

// The state of an agent in the list, from what the list knows: where it is deployed and, when it has been read, its health (see health/health.js).
export function stateFromHealth(bot, health) {
  const parts = Array.isArray(health?.parts) ? health.parts : [];
  const failing = parts.some((p) => p.id === 'tests_failing');
  const invalid = parts.some((p) => p.id === 'invalid' || p.id === 'security');
  const passed = !!health?.checked?.includes('tests') && !failing && !parts.some((p) => p.id === 'tests_not_run');
  return agentState({ deployed: bot?.deployed || {}, tests: failing ? 'failed' : passed ? 'passed' : 'unknown', problems: invalid ? 1 : 0 });
}
