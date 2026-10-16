// From a call to a test: the caller's words become the turns of a scenario, and what the agent did in the call becomes checks to start from. A scenario
// is part of the agent's draft (`tests`), so it is saved and versioned with it, and from then on every run checks that the same conversation still goes
// the same way. The person chooses which checks to keep, can say what should have happened instead, and can edit what the caller said before it is kept:
// a call holds real words, and a test is published with the agent.
// Pure: no network, no DOM.

import { describeExpectation, freshScenarioId, slugId } from '../scenarios/model.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ID = /^[a-z][a-z0-9_-]{0,63}$/;

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Phone numbers, e-mail addresses and other long runs of digits (card, account and order numbers) hidden behind a word, so a test does not carry them.
export function redact(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (run) =>
      run.replace(/\D/g, '').length >= 7 && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(run.trim()) ? '[number]' : run,
    );
}
export const hasPersonalData = (text) => redact(text) !== String(text || '');

const defaultsOf = (config) =>
  Object.fromEntries(
    Object.entries(isObj(config?.state?.variables) ? config.state.variables : {}).map(([name, v]) => [name, isObj(v) ? (v.default ?? null) : null]),
  );

// The checks worth offering for this call, each with why it is offered. `checked` says which start ticked: what the agent plainly did (a tool that worked,
// a hand-over, a value it ended up remembering) is ticked; its exact wording is offered but not ticked, because the same meaning can be said in other words.
export function suggestChecks(facts, config) {
  const checks = [];
  const tools = [];
  list(facts?.turns).forEach((t) =>
    t.tools.forEach((x) => {
      if (x.tool && !x.handoff) tools.push(x);
    }),
  );
  const seen = new Set();
  tools.forEach((t) => {
    if (seen.has(t.tool)) return;
    seen.add(t.tool);
    if (t.error)
      checks.push({
        id: `failed:${t.tool}`,
        expect: { tool_called: t.tool },
        label: describeExpectation({ tool_called: t.tool }),
        why: `It failed in this call (${t.error}). Tick it to keep checking that the agent still tries it.`,
        checked: false,
      });
    else
      checks.push({
        id: `tool:${t.tool}`,
        expect: { tool_called: t.tool },
        label: describeExpectation({ tool_called: t.tool }),
        why: 'The agent used it in this call.',
        checked: true,
      });
  });

  const entry = config?.agents?.entry || facts?.startAgent || '';
  if (facts?.finalAgent && (facts.handoffs > 0 || facts.finalAgent !== entry))
    checks.push({
      id: 'agent',
      expect: { agent_is: facts.finalAgent },
      label: describeExpectation({ agent_is: facts.finalAgent }),
      why: 'The call was handed over to this agent.',
      checked: true,
    });

  const defaults = defaultsOf(config);
  Object.entries(isObj(facts?.finalState) ? facts.finalState : {}).forEach(([name, value]) => {
    if (value === null || value === undefined || value === '' || same(value, defaults[name])) return;
    if (typeof value === 'object') return;
    checks.push({
      id: `state:${name}`,
      expect: { state_equals: { state: name, value } },
      label: describeExpectation({ state_equals: { state: name, value } }),
      why: 'This is what the agent remembered at the end of the call.',
      checked: true,
    });
  });

  // the last thing the agent said, as a pattern on its first few words
  const lines = list(facts?.turns)
    .flatMap((t) => t.said)
    .filter((s) => s.split(/\s+/).length >= 3);
  const last = lines[lines.length - 1];
  if (last) {
    const phrase = last
      .split(/\s+/)
      .slice(0, 5)
      .join(' ')
      .replace(/[^\p{L}\p{N}\s']/gu, '')
      .trim();
    if (phrase)
      checks.push({
        id: 'said',
        expect: { said_matches: escapeRegex(phrase) },
        label: describeExpectation({ said_matches: escapeRegex(phrase) }),
        why: 'Its last answer began this way. Wording can vary, so this is not ticked.',
        checked: false,
      });
  }
  return checks;
}

// What to start the dialog with: a name, a description, the channel, the caller's turns, the checks, and warnings about anything that will not carry over.
export function suggestTest(facts, config, { callId = '', startedAt = '' } = {}) {
  const warnings = [];
  const channels = list(config?.channels).filter((c) => isObj(c) && c.id);
  let channel = channels.find((c) => c.id === facts?.channelId);
  if (!channel) {
    channel = channels.find((c) => c.enabled !== false) || channels[0];
    if (facts?.channelId)
      warnings.push(
        channel
          ? `The call came in on “${facts.channelId}”, which this draft no longer has. The test uses “${channel.id}”.`
          : `The call came in on “${facts.channelId}”, which this draft does not have.`,
      );
  }
  if (!channel) warnings.push('This draft has no channel to run a test on yet.');
  const stamp = startedAt ? new Date(startedAt) : null;
  const base = slugId(`call_${stamp && !Number.isNaN(stamp.getTime()) ? stamp.toISOString().slice(5, 10).replace('-', '') : callId.slice(-6)}`) || 'call';
  const turns = list(facts?.turns)
    .map((t) => t.say)
    .filter(Boolean);
  if (!turns.length) warnings.push('The caller said nothing in this call, so there is nothing to replay as a test.');
  if (list(facts?.errors).length) warnings.push('Something went wrong in this call. Say below what should have happened instead.');
  if (turns.some(hasPersonalData))
    warnings.push(
      'The caller’s words include a number or an address. They are hidden below; check them before keeping the test, because a test is published with the agent.',
    );
  return {
    id: freshScenarioId(config?.tests, base),
    description: `From the call${startedAt ? ` of ${new Date(startedAt).toLocaleString()}` : ''}${callId ? ` (${callId})` : ''}`,
    channel: channel?.id || '',
    turns: turns.map(redact),
    checks: suggestChecks(facts, config),
    warnings,
  };
}

// What is wrong with a test about to be kept: [] when nothing. Only what is known to be wrong is said; the form never refuses over something it does not know.
export function testProblems({ id, channel, turns, checks, expectedText }, config) {
  const problems = [];
  if (!ID.test(String(id || ''))) problems.push('The name must start with a letter and use only lower-case letters, digits, “_” or “-”.');
  else if (list(config?.tests).some((t) => t?.id === id)) problems.push(`This agent already has a test called “${id}”.`);
  if (!channel) problems.push('Choose a channel for the test.');
  if (!list(turns).some((t) => String(t || '').trim())) problems.push('The test needs at least one thing for the caller to say.');
  const picked = list(checks).filter((c) => c.checked).length + (String(expectedText || '').trim() ? 1 : 0);
  if (!picked) problems.push('Keep at least one check, or say what should have happened.');
  return problems;
}

// The scenario to keep. `expectedText` is what a reviewer should agree happened (a `judge`, which needs a live model: a scenario with one is not free).
export function buildScenario({ id, description, channel, turns, checks, expectedText = '', toolsNeverCalled = [] }) {
  const expect = list(checks)
    .filter((c) => c.checked)
    .map((c) => c.expect);
  list(toolsNeverCalled)
    .filter(Boolean)
    .forEach((tool) => expect.push({ tool_not_called: tool }));
  if (String(expectedText).trim()) expect.push({ judge: String(expectedText).trim() });
  return {
    id,
    ...(description ? { description } : {}),
    channel,
    turns: list(turns)
      .map((t) => String(t).trim())
      .filter(Boolean)
      .map((say) => ({ say })),
    expect,
  };
}

export function addScenario(config, scenario) {
  return { ...config, tests: [...list(config?.tests), scenario] };
}
