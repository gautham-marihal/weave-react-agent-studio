// From a call to a test: the caller's words become a scenario's turns, and what the agent did becomes starting checks.
// Scenarios live in the draft (`tests`), so each run checks the conversation still goes the same way. The caller's words
// can be edited first: a call holds real words, and tests are published with the agent. Pure: no network, no DOM.
import type { AgentConfig } from '../types/studio';
import { isObj, type CallFacts } from './replayFacts';
import { freshScenarioId, type TestScenario } from './replayRun';

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const slugId = (text: string): string =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 64);

/** Phone numbers, e-mail addresses and other long runs of digits (card, account and order numbers) hidden behind a word,
 *  so a test does not carry them. A date is left alone. */
export function redact(text: string): string {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (run) => (run.replace(/\D/g, '').length >= 7 && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(run.trim()) ? '[number]' : run));
}
export const hasPersonalData = (text: string): boolean => redact(text) !== String(text || '');

/** One expectation in words. */
export function describeExpectation(e: Record<string, unknown>): string {
  if ('tool_called' in e) return `the tool “${String(e.tool_called)}” is called`;
  if ('tool_not_called' in e) return `the tool “${String(e.tool_not_called)}” is not called`;
  if ('agent_is' in e) return `the conversation ends with the agent “${String(e.agent_is)}”`;
  if ('state_equals' in e && isObj(e.state_equals)) return `${String(e.state_equals.state || 'a value')} ends up as ${JSON.stringify(e.state_equals.value)}`;
  if ('said_matches' in e) return `the agent says something matching /${String(e.said_matches)}/`;
  if ('judge' in e) return `a reviewer model agrees: ${String(e.judge)}`;
  return Object.keys(e)[0]?.replace(/_/g, ' ') ?? 'a check';
}

/** The tool names a `tool_called` can use: each tool's name (or id) and the agents' hand-over tools. */
export function toolNamesOf(config: AgentConfig | null | undefined): string[] {
  const tools = list(config?.tools).map((t) => (isObj(t) ? String(t.name || t.id || '') : ''));
  const handoffs = list(config?.agents?.items).flatMap((a) => (isObj(a) ? list(a.handoffs).map((h) => (isObj(h) ? String(h.tool ?? '') : '')) : []));
  return Array.from(new Set([...tools, ...handoffs].filter(Boolean)));
}

export interface SuggestedCheck {
  id: string;
  expect: Record<string, unknown>;
  label: string;
  why: string;
  /** Ticked to start with: what the agent plainly did. Its exact wording is offered unticked. */
  checked: boolean;
}

const defaultsOf = (config: AgentConfig | null | undefined): Record<string, unknown> => {
  const vars = isObj(config?.state) && isObj(config.state.variables) ? config.state.variables : {};
  return Object.fromEntries(Object.entries(vars).map(([name, v]) => [name, isObj(v) ? (v.default ?? null) : null]));
};

/** The checks worth offering for this call, each with why. */
export function suggestChecks(facts: CallFacts, config: AgentConfig | null | undefined): SuggestedCheck[] {
  const checks: SuggestedCheck[] = [];
  const check = (id: string, expect: Record<string, unknown>, why: string, checked: boolean) => checks.push({ id, expect, label: describeExpectation(expect), why, checked });

  const seen = new Set<string>();
  facts.turns.forEach((t) =>
    t.tools.forEach((x) => {
      if (!x.tool || x.handoff || seen.has(x.tool)) return;
      seen.add(x.tool);
      if (x.error) check(`failed:${x.tool}`, { tool_called: x.tool }, `It failed in this call (${x.error}). Tick it to keep checking that the agent still tries it.`, false);
      else check(`tool:${x.tool}`, { tool_called: x.tool }, 'The agent used it in this call.', true);
    }),
  );

  const entry = config?.agents?.entry || facts.startAgent;
  if (facts.finalAgent && (facts.handoffs > 0 || facts.finalAgent !== entry)) check('agent', { agent_is: facts.finalAgent }, 'The call was handed over to this agent.', true);

  const defaults = defaultsOf(config);
  Object.entries(facts.finalState).forEach(([name, value]) => {
    if (value === null || value === undefined || value === '' || typeof value === 'object' || same(value, defaults[name])) return;
    check(`state:${name}`, { state_equals: { state: name, value } }, 'This is what the agent remembered at the end of the call.', true);
  });

  // the last thing the agent said, as a pattern on its first few words
  const lines = facts.turns.flatMap((t) => t.said).filter((s) => s.split(/\s+/).length >= 3);
  const last = lines[lines.length - 1];
  if (last) {
    const phrase = last
      .split(/\s+/)
      .slice(0, 5)
      .join(' ')
      .replace(/[^\p{L}\p{N}\s']/gu, '')
      .trim();
    if (phrase) check('said', { said_matches: escapeRegex(phrase) }, 'Its last answer began this way. Wording can vary, so this is not ticked.', false);
  }
  return checks;
}

export interface TestDraft {
  id: string;
  description: string;
  channel: string;
  turns: string[];
  checks: SuggestedCheck[];
  /** What a reviewer should agree happened (a `judge`: needs a live model, so the test is not free). */
  expectedText?: string;
  toolsNeverCalled?: string[];
}

/** What to start the "Keep as a test" dialog with, and warnings about anything that will not carry over. */
export function suggestTest(facts: CallFacts, config: AgentConfig | null | undefined, { callId = '', startedAt = '' } = {}): TestDraft & { warnings: string[] } {
  const warnings: string[] = [];
  const channels = list(config?.channels).filter((c): c is Record<string, unknown> => isObj(c) && typeof c.id === 'string');
  let channel = channels.find((c) => c.id === facts.channelId);
  if (!channel) {
    channel = channels.find((c) => c.enabled !== false) ?? channels[0];
    if (facts.channelId)
      warnings.push(channel ? `The call came in on “${facts.channelId}”, which this draft no longer has. The test uses “${String(channel.id)}”.` : `The call came in on “${facts.channelId}”, which this draft does not have.`);
  }
  if (!channel) warnings.push('This draft has no channel to run a test on yet.');
  const stamp = startedAt ? new Date(startedAt) : null;
  const base = slugId(`call_${stamp && !Number.isNaN(stamp.getTime()) ? stamp.toISOString().slice(5, 10).replace('-', '') : callId.slice(-6)}`) || 'call';
  const turns = facts.turns.map((t) => t.say).filter(Boolean);
  if (!turns.length) warnings.push('The caller said nothing in this call, so there is nothing to replay as a test.');
  if (facts.errors.length) warnings.push('Something went wrong in this call. Say below what should have happened instead.');
  if (turns.some(hasPersonalData)) warnings.push('The caller’s words include a number or an address. They are hidden below; check them before keeping the test, because a test is published with the agent.');
  return {
    id: freshScenarioId(config?.tests, base),
    description: `From the call${startedAt ? ` of ${new Date(startedAt).toLocaleString()}` : ''}${callId ? ` (${callId})` : ''}`,
    channel: typeof channel?.id === 'string' ? channel.id : '',
    turns: turns.map(redact),
    checks: suggestChecks(facts, config),
    warnings,
  };
}

/** What is wrong with a test about to be kept: [] when nothing. Only what is known to be wrong is said. */
export function testProblems({ id, channel, turns, checks, expectedText }: TestDraft, config: AgentConfig | null | undefined): string[] {
  const problems: string[] = [];
  if (!ID.test(String(id || ''))) problems.push('The name must start with a letter and use only lower-case letters, digits, “_” or “-”.');
  else if (list(config?.tests).some((t) => isObj(t) && t.id === id)) problems.push(`This agent already has a test called “${id}”.`);
  if (!channel) problems.push('Choose a channel for the test.');
  if (!turns.some((t) => String(t || '').trim())) problems.push('The test needs at least one thing for the caller to say.');
  const picked = checks.filter((c) => c.checked).length + (String(expectedText || '').trim() ? 1 : 0);
  if (!picked) problems.push('Keep at least one check, or say what should have happened.');
  return problems;
}

/** The scenario to keep. */
export function buildScenario({ id, description, channel, turns, checks, expectedText = '', toolsNeverCalled = [] }: TestDraft): TestScenario {
  const expect = checks.filter((c) => c.checked).map((c) => c.expect);
  toolsNeverCalled.filter(Boolean).forEach((tool) => expect.push({ tool_not_called: tool }));
  if (expectedText.trim()) expect.push({ judge: expectedText.trim() });
  return {
    id,
    ...(description ? { description } : {}),
    channel,
    turns: turns
      .map((t) => String(t).trim())
      .filter(Boolean)
      .map((say) => ({ say })),
    expect,
  };
}

export function addScenario(config: AgentConfig, scenario: TestScenario): AgentConfig {
  return { ...config, tests: [...list(config?.tests), scenario] };
}
