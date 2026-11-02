import { describe, expect, it } from 'vitest';
import type { Agent, Deployment } from '../../types/studio';
import {
  addCall,
  areaCodeError,
  CALLS_KEPT,
  callsInRange,
  COUNTRIES,
  deleteRule,
  deleteTrunk,
  describeRuleHours,
  describeRuleRouting,
  formatDuration,
  generateTestNumber,
  hasErrors,
  hasHumanHandoff,
  matchingRules,
  normalizeTelephony,
  previewWords,
  releaseNumber,
  routingLabel,
  ruleAppliesAt,
  ruleCallStats,
  ruleErrors,
  ruleForm,
  ruleForNumber,
  ruleFromForm,
  ruleHoursParts,
  rulesNotLive,
  saveRule,
  simulateCall,
  summarizeCalls,
  telAgent,
  trunkErrors,
  trunkFromForm,
  RULE_DEFAULTS,
  type DispatchRule,
  type SimulatedCall,
  type TelAgent,
  type TelephonyData,
} from './model';
import { sampleTelephony } from './store';
import { telephonyResults } from './palette';
import { SANDBOX_SAMPLE_IDS } from '../mode';

// Weave React's Telephony page had no unit tests of its own (only its addresses, in workspaceRoutes.test.js, ported to
// src/models/telephony.test.ts); these pin the rules, the call simulation and the forms it ported.

const T0 = '2026-01-01T00:00:00.000Z';
const rule = (fields: Partial<DispatchRule> & Pick<DispatchRule, 'id'>): DispatchRule => ({
  name: fields.id,
  type: 'individual',
  routing: 'all',
  agentId: 'a1',
  roomPrefix: 'call-',
  ...RULE_DEFAULTS,
  createdAt: T0,
  updatedAt: T0,
  ...fields,
});
const agent = (id: string, over: Partial<TelAgent> = {}): TelAgent => ({ id, name: id.toUpperCase(), version: '1.0.0', live: true, where: 'Live in Production', canHandOff: true, ...over });
const data = (over: Partial<TelephonyData> = {}): TelephonyData => ({
  numbers: [{ id: 'PN1', number: '+1 415 555 0142', country: 'US', label: 'Main', createdAt: T0 }],
  rules: [],
  trunks: [],
  calls: [],
  ...over,
});
// Monday 2 November 2026, 10:30 local time; Saturday the 7th
const monday = new Date(2026, 10, 2, 10, 30);
const saturday = new Date(2026, 10, 7, 10, 30);
const always = (value: number) => () => value;
const stageKeys = (call: SimulatedCall) => call.stages.map((s) => s.key);

describe('when a rule applies', () => {
  it('any time, business hours, or outside them, in this browser’s time zone', () => {
    expect(ruleAppliesAt(rule({ id: 'r' }), saturday)).toBe(true);
    const business = rule({ id: 'b', hours: 'business' });
    expect(ruleAppliesAt(business, monday)).toBe(true);
    expect(ruleAppliesAt(business, saturday)).toBe(false);
    expect(ruleAppliesAt(business, new Date(2026, 10, 2, 17, 0))).toBe(false); // closing time is outside
    expect(ruleAppliesAt(business, new Date(2026, 10, 2, 9, 0))).toBe(true);
    const after = rule({ id: 'a', hours: 'after' });
    expect(ruleAppliesAt(after, monday)).toBe(false);
    expect(ruleAppliesAt(after, saturday)).toBe(true);
  });

  it('is said in words, split for a table', () => {
    expect(describeRuleHours(rule({ id: 'r' }))).toBe('Any time');
    expect(describeRuleHours(rule({ id: 'r', hours: 'business' }))).toBe('Mon–Fri 09:00–17:00');
    expect(describeRuleHours(rule({ id: 'r', hours: 'after' }))).toBe('Outside Mon–Fri 09:00–17:00');
    expect(describeRuleHours(rule({ id: 'r', hours: 'business', days: [6, 0, 1, 2, 3, 4, 5] }))).toBe('Every day 09:00–17:00');
    expect(describeRuleHours(rule({ id: 'r', hours: 'business', days: [6, 0], openTime: '10:00', closeTime: '14:00' }))).toBe('Sun, Sat 10:00–14:00');
    expect(ruleHoursParts(rule({ id: 'r', hours: 'business' }))).toEqual({ days: 'Mon–Fri', hours: '09:00–17:00' });
    expect(ruleHoursParts(rule({ id: 'r' }))).toEqual({ days: 'Any time', hours: '' });
  });
});

describe('which rule takes a call', () => {
  it('only rules for this number (or all numbers), at this time, for this caller', () => {
    const d = data({
      rules: [
        rule({ id: 'other', routing: 'PN2' }),
        rule({ id: 'closed', routing: 'PN1', hours: 'business' }),
        rule({ id: 'india', routing: 'all', callerPrefix: '+91' }),
        rule({ id: 'mine', routing: 'PN1' }),
      ],
    });
    expect(matchingRules(d, 'PN1', '+1 415 555 0100', saturday).map((r) => r.id)).toEqual(['mine']);
    expect(matchingRules(d, 'PN1', '+91 22 1234 5678', monday).map((r) => r.id).sort()).toEqual(['closed', 'india', 'mine']);
  });

  it('the lowest priority number first, then the oldest rule', () => {
    const d = data({
      rules: [
        rule({ id: 'new5', createdAt: '2026-02-01T00:00:00Z' }),
        rule({ id: 'old5', createdAt: '2026-01-01T00:00:00Z' }),
        rule({ id: 'first', priority: 1, createdAt: '2026-03-01T00:00:00Z' }),
      ],
    });
    expect(matchingRules(d, 'PN1', '+1 415', monday).map((r) => r.id)).toEqual(['first', 'old5', 'new5']);
  });

  it('says what a number, trunk or "all" routes from, and which rule a number goes to', () => {
    const d = data({ trunks: [{ id: 'ST1', direction: 'inbound', name: 'Carrier', numbers: [], address: '', username: '', createdAt: T0 }] });
    expect(routingLabel(d, rule({ id: 'r', routing: 'all' }))).toBe('All inbound numbers');
    expect(routingLabel(d, rule({ id: 'r', routing: 'PN1' }))).toBe('+1 415 555 0142');
    expect(routingLabel(d, rule({ id: 'r', routing: 'ST1' }))).toBe('Trunk: Carrier');
    expect(routingLabel(d, rule({ id: 'r', routing: '' }))).toBe('Unassigned');
    expect(describeRuleRouting(d, rule({ id: 'r', routing: 'ST1' }))).toBe('the Carrier trunk');
    expect(describeRuleRouting(d, rule({ id: 'r', routing: '' }))).toBe('no number');
    const withRules = data({ rules: [rule({ id: 'all' }), rule({ id: 'own', routing: 'PN1' })] });
    expect(ruleForNumber(withRules, 'PN1')?.id).toBe('own');
    expect(ruleForNumber(withRules, 'PN9')?.id).toBe('all');
  });

  it('flags rules whose agent is missing or not live in Production', () => {
    const d = data({ rules: [rule({ id: 'ok', agentId: 'a1' }), rule({ id: 'draft', agentId: 'a2' }), rule({ id: 'gone', agentId: 'zz' })] });
    expect(rulesNotLive(d, [agent('a1'), agent('a2', { live: false })]).map((r) => r.id)).toEqual(['draft', 'gone']);
  });
});

describe('a simulated call', () => {
  const agents = [agent('a1'), agent('a2')];

  it('with no rule is not answered', () => {
    const call = simulateCall({ data: data(), agents, numberId: 'PN1', caller: '+1 415 555 0100', when: monday, random: always(0) });
    expect(call.status).toBe('No match');
    expect(stageKeys(call)).toEqual(['incoming', 'nomatch', 'ended']);
    expect(call.issues).toEqual(['No dispatch rule matched this call.']);
    expect(call.answeredBy).toBeNull();
    expect(call.simulated).toBe(true);
    expect(call.to).toBe('+1 415 555 0142');
  });

  it('on a quiet line is answered at once by the rule’s agent, and its times add up', () => {
    const call = simulateCall({ data: data({ rules: [rule({ id: 'r1', name: 'Main' })] }), agents, numberId: 'PN1', caller: '+1 415 555 0100', when: monday, random: always(0) });
    expect(call.status).toBe('Completed');
    expect(stageKeys(call)).toEqual(['incoming', 'matched', 'answered', 'ended']);
    expect(call.answeredBy).toEqual({ id: 'a1', name: 'A1', version: '1.0.0' });
    expect(call.holdSec).toBe(0);
    expect(call.issues).toEqual([]);
    expect(call.durationSec).toBe(call.stages.reduce((s, st) => s + st.durationSec, 0));
    expect(call.connectedSec).toBe(call.durationSec - call.holdSec);
    expect(call.stages[1].label).toBe('Matched “Main”');
    expect(Date.parse(call.endedAt) - Date.parse(call.startedAt)).toBe(call.durationSec * 1000);
  });

  it('says when other matching rules lost on priority', () => {
    const d = data({ rules: [rule({ id: 'r1', priority: 2 }), rule({ id: 'r2', priority: 4 }), rule({ id: 'r3', priority: 6 })] });
    const call = simulateCall({ data: d, agents, numberId: 'PN1', caller: '+1', when: monday, random: always(0) });
    expect(call.ruleId).toBe('r1');
    expect(call.stages[1].detail).toMatch(/Chosen over 2 other matching rules by priority 2\./);
  });

  it('notes an agent that isn’t live in Production', () => {
    const call = simulateCall({ data: data({ rules: [rule({ id: 'r1' })] }), agents: [agent('a1', { live: false, where: 'Draft only', version: 'draft' })], numberId: 'PN1', caller: '+1', when: monday, random: always(0) });
    expect(call.status).toBe('Completed');
    expect(call.issues).toEqual(['A1 isn’t live in Production (draft only).']);
    expect(call.stages[2].detail).toMatch(/^The draft\./);
  });

  it('past the hold limit goes to a person, another agent, or ends, as the rule says', () => {
    const busy = { agents, numberId: 'PN1', caller: '+1', when: monday, busy: 'overloaded' as const, random: always(1) };
    const person = simulateCall({ ...busy, data: data({ rules: [rule({ id: 'r', maxHold: 30, overflow: 'person' })] }) });
    expect(person.status).toBe('Handed to a person');
    expect(stageKeys(person)).toEqual(['incoming', 'matched', 'hold', 'hold', 'handoff', 'ended']);
    expect(person.agentWaitSec).toBe(30);
    expect(person.overLimit).toBe(false);
    expect(person.answeredBy).toBeNull();

    const other = simulateCall({ ...busy, data: data({ rules: [rule({ id: 'r', overflow: 'agent', overflowAgentId: 'a2' })] }) });
    expect(other.status).toBe('Overflowed');
    expect(other.answeredBy?.id).toBe('a2');
    expect(stageKeys(other)).toEqual(['incoming', 'matched', 'hold', 'overflow', 'hold', 'answered', 'ended']);
    expect(other.holdSec).toBeGreaterThan(other.agentWaitSec);

    const gone = simulateCall({ ...busy, data: data({ rules: [rule({ id: 'r', overflow: 'agent', overflowAgentId: 'zz' })] }) });
    expect(gone.status).toBe('Failed');
    expect(gone.issues).toContain('The fallback agent was deleted.');

    const end = simulateCall({ ...busy, data: data({ rules: [rule({ id: 'r', maxHold: 20, overflow: 'end' })] }) });
    expect(end.status).toBe('Ended early');
    expect(end.issues).toEqual(['No one answered within 20 seconds.']);
  });

  it('kept waiting past two minutes, the caller hangs up; under two minutes the agent answers late', () => {
    const wait = data({ rules: [rule({ id: 'r', maxHold: 30, overflow: 'wait', holdMessage: 'Please hold.' })] });
    const hungUp = simulateCall({ data: wait, agents, numberId: 'PN1', caller: '+1', when: monday, busy: 'overloaded', random: always(1) });
    expect(hungUp.status).toBe('Abandoned');
    expect(hungUp.overLimit).toBe(true);
    expect(hungUp.issues[0]).toBe('The caller hung up while on hold.');
    expect(hungUp.issues[1]).toMatch(/waited 2 min for A1, over the rule’s 30-second limit/);
    expect(hungUp.stages[2].detail).toMatch(/They heard: “Please hold\.”/);

    const late = simulateCall({ data: wait, agents, numberId: 'PN1', caller: '+1', when: monday, busy: 'busy', random: always(1) });
    expect(late.status).toBe('Completed');
    expect(late.agentWaitSec).toBe(45);
    expect(late.overLimit).toBe(true);
  });

  it('whose rule points at a deleted agent fails', () => {
    const call = simulateCall({ data: data({ rules: [rule({ id: 'r', agentId: 'zz' })] }), agents, numberId: 'PN1', caller: '+1', when: monday, random: always(0) });
    expect(call.status).toBe('Failed');
    expect(call.agentName).toBe('Deleted agent');
  });

  it('asking for a person is handed off only by an agent that can', () => {
    const d = data({ rules: [rule({ id: 'r' })] });
    const go = (canHandOff: boolean | null) => simulateCall({ data: d, agents: [agent('a1', { canHandOff })], numberId: 'PN1', caller: '+1', when: monday, wantsPerson: true, random: always(0) });
    expect(go(true).status).toBe('Handed to a person');
    expect(go(false).issues[0]).toMatch(/has no transfer, callback tool or escalation rule/);
    expect(go(null).issues[0]).toMatch(/configuration couldn’t be read/);
  });

  it('is previewed before it is run', () => {
    const d = data({ rules: [rule({ id: 'r', name: 'Main', maxHold: 25 })] });
    expect(previewWords(d, agents, 'PN1', '+1', monday)).toBe('This call would match “Main” and go to A1 (hold limit 25 s).');
    expect(previewWords(data(), agents, 'PN1', '+1', monday)).toMatch(/won’t be answered/);
  });
});

describe('the calls’ numbers', () => {
  const agents = [agent('a1')];
  const make = (when: Date, over: Partial<DispatchRule> = {}, busy: 'quiet' | 'overloaded' = 'quiet') =>
    simulateCall({ data: data({ rules: [rule({ id: 'r1', ...over })] }), agents, numberId: 'PN1', caller: '+1', when, busy, random: always(busy === 'quiet' ? 0 : 1) });

  it('are counted in the chosen range', () => {
    const now = monday.getTime();
    const calls = [make(new Date(now - 3600_000)), make(new Date(now - 3 * 86_400_000))];
    expect(callsInRange(calls, 'Past 24 hours', now)).toHaveLength(1);
    expect(callsInRange(calls, 'Past 7 days', now)).toHaveLength(2);
  });

  it('sum talk, hold, answers and issues', () => {
    const calls = [make(monday), make(monday, { overflow: 'wait' }, 'overloaded')];
    const sum = summarizeCalls(calls);
    expect(sum.count).toBe(2);
    expect(sum.answered).toBe(1);
    expect(sum.answeredShare).toBe(50);
    expect(sum.overLimit).toBe(1);
    expect(sum.withIssues).toBe(1);
    expect(sum.longestHoldSec).toBe(120);
    expect(sum.avgHoldSec).toBe(60);
    expect(summarizeCalls([]).longestHoldSec).toBeNull();
    expect(ruleCallStats(calls, 'r1')).toEqual({ count: 2, avgHoldSec: 60, over: 1 });
  });

  it('keep at most the newest calls', () => {
    let d = data();
    const call = make(monday);
    for (let i = 0; i < CALLS_KEPT + 3; i += 1) d = addCall(d, { ...call, id: `CA_${i}` });
    expect(d.calls).toHaveLength(CALLS_KEPT);
    expect(d.calls[0].id).toBe(`CA_${CALLS_KEPT + 2}`);
  });

  it('format durations the same way everywhere', () => {
    expect(formatDuration(8)).toBe('8 s');
    expect(formatDuration(68)).toBe('1 min 8 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
    expect(formatDuration(-3)).toBe('0 s');
  });
});

describe('test numbers', () => {
  const [US, GB, SG, AU, IN] = COUNTRIES;
  it('come from ranges kept for fictional use, and never repeat one already there', () => {
    expect(generateTestNumber(US, '212', [], always(0.42))).toBe('+1 212 555 0144');
    expect(generateTestNumber(US, '', [], always(0))).toBe('+1 415 555 0100');
    expect(generateTestNumber(GB, '', [], always(0))).toBe('+44 20 7946 0000');
    expect(generateTestNumber(SG, '', [], always(0))).toMatch(/^\+65 6\d{3} \d{4}$/);
    expect(generateTestNumber(AU, '3', [], always(0))).toBe('+61 3 5550 0000');
    expect(generateTestNumber(IN, '', [], always(0))).toBe('+91 22 0000 0000');
    let n = 0;
    const counting = () => ((n += 1) <= 2 ? 0 : 0.5);
    expect(generateTestNumber(US, '', ['+1 415 555 0100'], counting)).toBe('+1 415 555 0155');
  });

  it('check the area code against the country', () => {
    expect(areaCodeError(US, '')).toBe('');
    expect(areaCodeError(US, '415')).toBe('');
    expect(areaCodeError(US, '123')).toMatch(/3-digit US area code/);
    expect(areaCodeError(AU, '5')).toMatch(/2, 3, 7 or 8/);
    expect(areaCodeError(SG, '99')).toBe('');
  });

  it('released, leave the rules that used them unassigned', () => {
    const d = data({ rules: [rule({ id: 'r1', routing: 'PN1' }), rule({ id: 'r2', routing: 'all' })] });
    const after = releaseNumber(d, 'PN1', monday);
    expect(after.numbers).toEqual([]);
    expect(after.rules.map((r) => r.routing)).toEqual(['', 'all']);
    expect(after.rules[0].updatedAt).toBe(monday.toISOString());
  });
});

describe('the dispatch-rule form', () => {
  const agents = [agent('a1'), agent('a2')];
  const d = data({ rules: [rule({ id: 'r1', name: 'Main line' })] });
  const form = { ...ruleForm(d, agents), name: 'Night' };

  it('starts on the first number and agent, with the defaults', () => {
    const f = ruleForm(d, agents);
    expect(f).toMatchObject({ routing: 'PN1', agentId: 'a1', overflowAgentId: 'a2', priority: '5', maxHold: '30', hours: 'any', roomPrefix: 'call-' });
    expect(ruleForm(data({ numbers: [] }), [], null).routing).toBe('all');
    expect(ruleForm(d, agents, rule({ id: 'x', routing: '' })).routing).toBe('all');
  });

  it('says what is wrong, field by field', () => {
    expect(hasErrors(ruleErrors(form, d))).toBe(false);
    expect(ruleErrors({ ...form, name: ' ' }, d).name).toBe('Give the rule a name.');
    expect(ruleErrors({ ...form, name: 'main LINE' }, d).name).toBe('A rule with this name already exists.');
    expect(ruleErrors({ ...form, name: 'Main line' }, d, 'r1').name).toBe('');
    expect(ruleErrors({ ...form, agentId: '' }, d).agent).toMatch(/Choose the agent/);
    expect(ruleErrors({ ...form, roomPrefix: 'call 1' }, d).prefix).toMatch(/letters, numbers/);
    expect(ruleErrors({ ...form, hours: 'business', days: [] }, d).days).toBe('Pick at least one day.');
    expect(ruleErrors({ ...form, hours: 'business', openTime: '18:00', closeTime: '09:00' }, d).times).toMatch(/after the opening time/);
    expect(ruleErrors({ ...form, hours: 'any', days: [] }, d).days).toBe('');
    expect(ruleErrors({ ...form, callerPrefix: '+91' }, d).callerPrefix).toBe('');
    expect(ruleErrors({ ...form, callerPrefix: 'abc' }, d).callerPrefix).toMatch(/up to 6 digits/);
    expect(ruleErrors({ ...form, priority: '0' }, d).priority).toMatch(/1 to 10/);
    expect(ruleErrors({ ...form, priority: '2.5' }, d).priority).toMatch(/1 to 10/);
    expect(ruleErrors({ ...form, priority: '' }, d).priority).toMatch(/1 to 10/);
    expect(ruleErrors({ ...form, maxHold: '4' }, d).maxHold).toMatch(/5 to 600/);
    expect(ruleErrors({ ...form, maxHold: '' }, d).maxHold).toMatch(/5 to 600/);
    expect(ruleErrors({ ...form, overflow: 'agent', overflowAgentId: 'a1' }, d).overflowAgent).toMatch(/different agent/);
  });

  it('makes a tidy rule, and keeps the id and creation time of one edited', () => {
    const made = ruleFromForm({ ...form, name: '  Night ', days: [5, 1, 3], callerPrefix: '+9 1', holdMessage: ' Hi ', roomPrefix: '', overflowAgentId: 'a2' }, null, monday, always(0));
    expect(made).toMatchObject({ name: 'Night', days: [1, 3, 5], callerPrefix: '+91', holdMessage: 'Hi', roomPrefix: 'call-', priority: 5, maxHold: 30, overflowAgentId: '' });
    expect(made.id).toMatch(/^SDR_/);
    expect(made.createdAt).toBe(monday.toISOString());
    const edited = ruleFromForm({ ...form, overflow: 'agent', overflowAgentId: 'a2' }, rule({ id: 'r1' }), saturday);
    expect(edited.id).toBe('r1');
    expect(edited.createdAt).toBe(T0);
    expect(edited.updatedAt).toBe(saturday.toISOString());
    expect(edited.overflowAgentId).toBe('a2');
  });

  it('a saved rule is added or replaces itself; a deleted one is gone', () => {
    const added = saveRule(d, rule({ id: 'r2' }));
    expect(added.rules.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(saveRule(added, rule({ id: 'r1', name: 'Renamed' })).rules[0].name).toBe('Renamed');
    expect(deleteRule(added, 'r1').rules.map((r) => r.id)).toEqual(['r2']);
  });
});

describe('SIP trunks', () => {
  const d = data({ trunks: [{ id: 'ST1', direction: 'inbound', name: 'Carrier', numbers: [], address: '', username: '', createdAt: T0 }], rules: [rule({ id: 'r', routing: 'ST1' })] });
  const blank = { direction: 'inbound' as const, name: 'New', numbers: '', address: '', username: '' };

  it('check their name, numbers and address', () => {
    expect(hasErrors(trunkErrors(blank, d))).toBe(false);
    expect(trunkErrors({ ...blank, name: '' }, d).name).toMatch(/Give the trunk a name/);
    expect(trunkErrors({ ...blank, name: 'carrier' }, d).name).toMatch(/already exists/);
    expect(trunkErrors({ ...blank, numbers: '+1 415 555 0100, nope' }, d).numbers).toBe('“nope” isn’t a valid phone number.');
    expect(trunkErrors({ ...blank, address: 'not a host!' }, d).address).toMatch(/host name/);
    const out = { ...blank, direction: 'outbound' as const };
    expect(trunkErrors(out, d).numbers).toMatch(/at least one number/);
    expect(trunkErrors(out, d).address).toMatch(/SIP address/);
    expect(hasErrors(trunkErrors({ ...out, numbers: '+1 415 555 0100', address: 'sips:sip.carrier.com:5061' }, d))).toBe(false);
  });

  it('are made from the form, and deleting one unassigns its rules', () => {
    const t = trunkFromForm({ ...blank, numbers: '+1 415 555 0100,\n+1 415 555 0101', address: ' sip.x.com ' }, monday);
    expect(t).toMatchObject({ direction: 'inbound', name: 'New', numbers: ['+1 415 555 0100', '+1 415 555 0101'], address: 'sip.x.com' });
    const after = deleteTrunk(d, 'ST1', monday);
    expect(after.trunks).toEqual([]);
    expect(after.rules[0].routing).toBe('');
  });
});

describe('agents as the rules see them', () => {
  const base: Agent = {
    id: 'acme',
    name: 'Acme',
    starter: 'blank',
    draft: { bot_id: 'acme', revision: 1, saved_at: T0, saved_by: 'x', config: {} as Agent['draft']['config'] },
    versions: [],
    deployments: [],
  };
  const deployment = (environment: Deployment['environment'], version: string): Deployment => ({ id: `d-${environment}`, status: 'active', environment, version, previous_version: null, deployed_at: T0, deployed_by: 'x', note: '' });

  it('are live only when deployed to Production, answering with that version', () => {
    expect(telAgent(base)).toMatchObject({ live: false, version: 'draft', where: 'Draft only', canHandOff: false });
    const published = { ...base, versions: [{ version: '1.2.0', published_at: T0, published_by: 'x', checksum: 'c' }] };
    expect(telAgent(published)).toMatchObject({ live: false, version: '1.2.0', where: 'Published, not deployed' });
    expect(telAgent({ ...published, deployments: [deployment('staging', '1.2.0')] }).where).toBe('In Staging');
    expect(telAgent({ ...published, deployments: [deployment('production', '1.1.0')] })).toMatchObject({ live: true, version: '1.1.0', where: 'Live in Production' });
    expect(telAgent({ ...base, loadError: 'gone' }).canHandOff).toBeNull();
  });

  it('can hand a caller to a person with a transfer tool, a transfer, or an escalation rule', () => {
    expect(hasHumanHandoff(null)).toBe(false);
    expect(hasHumanHandoff({ tools: [{ id: 't', builtin: 'transfer_or_callback' }] })).toBe(true);
    expect(hasHumanHandoff({ telephony: { transfers: [{ id: 'desk' }] } })).toBe(true);
    expect(hasHumanHandoff({ guardrails: { escalation: [{ action: 'handoff' }] } })).toBe(true);
    expect(hasHumanHandoff({ guardrails: { escalation: [{ action: 'say' }] }, tools: [{ builtin: 'end_call' }] })).toBe(false);
  });
});

describe('what is kept', () => {
  it('keeps only records with ids, whatever was stored', () => {
    expect(normalizeTelephony(undefined)).toEqual({ numbers: [], rules: [], trunks: [], calls: [] });
    expect(normalizeTelephony({ numbers: [{ id: 'PN' }, null, { number: 'x' }], rules: 'nope' })).toEqual({ numbers: [{ id: 'PN' }], rules: [], trunks: [], calls: [] });
  });

  it('starts with a sample setup for the sample agents, every reference sound', () => {
    const s = sampleTelephony(monday);
    const ids = [...s.numbers, ...s.rules, ...s.trunks].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    s.rules.forEach((r) => {
      expect(SANDBOX_SAMPLE_IDS).toContain(r.agentId);
      expect(r.routing === 'all' || s.numbers.some((n) => n.id === r.routing)).toBe(true);
      expect(hasErrors(ruleErrors({ ...ruleForm(s, [], r), agentId: r.agentId }, s, r.id))).toBe(false);
    });
    expect(s.calls).toEqual([]);
    s.numbers.forEach((n) => expect(n.number).toMatch(/555 01\d\d|7946 0\d{3}/));
  });

  it('is found by the search, each record opening its part', () => {
    const s = sampleTelephony(monday);
    const found = telephonyResults(s, { 'acme-support': 'Acme Support' });
    expect(found.filter((f) => f.section === 'numbers').map((f) => f.title)).toEqual(['+1 415 555 0142', '+44 20 7946 0321']);
    expect(found.find((f) => f.id === 'SDR_sample_main')).toMatchObject({ section: 'dispatch', title: 'Main support line', description: 'Sandbox dispatch rule to Acme Support (Any time)' });
    expect(found.filter((f) => f.section === 'trunks')).toHaveLength(2);
    expect(found.every((f) => /Sandbox/.test(f.description))).toBe(true);
  });
});
