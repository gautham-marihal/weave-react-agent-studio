// Sandbox telephony (Weave React's Telephony page, src/pages/Telephony.jsx): test phone numbers, dispatch rules, SIP
// trunks and calls simulated through them, all kept in this browser. Nothing here reaches a phone system: the numbers
// come from ranges reserved for fictional use and a "call" is played through the rules by these functions.
// Pure: randomness and time are handed in, so the tests can pin them.

import type { Agent } from '../../types/studio';
import { currentDeployments } from '../../utils/agentStatus';

// ---------------------------------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------------------------------

export interface TestNumber {
  id: string;
  number: string;
  country: string;
  label: string;
  createdAt: string;
}

export type RuleHours = 'any' | 'business' | 'after';
export type Overflow = 'person' | 'agent' | 'end' | 'wait';
export type RuleType = 'individual' | 'direct';

export interface DispatchRule {
  id: string;
  name: string;
  type: RuleType;
  /** 'all', a test number's id, an inbound trunk's id, or '' once what it routed from was removed. */
  routing: string;
  agentId: string;
  roomPrefix: string;
  hours: RuleHours;
  /** 0 = Sunday. */
  days: number[];
  openTime: string;
  closeTime: string;
  callerPrefix: string;
  /** 1 is checked first. */
  priority: number;
  /** Seconds a caller waits for the agent before the overflow. */
  maxHold: number;
  holdMessage: string;
  overflow: Overflow;
  overflowAgentId: string;
  createdAt: string;
  updatedAt: string;
}

export type TrunkDirection = 'inbound' | 'outbound';

export interface SipTrunk {
  id: string;
  direction: TrunkDirection;
  name: string;
  numbers: string[];
  address: string;
  username: string;
  createdAt: string;
}

export type BusyLevel = 'quiet' | 'busy' | 'overloaded';
export type CallStatus = 'Completed' | 'Handed to a person' | 'Overflowed' | 'Ended early' | 'Abandoned' | 'No match' | 'Failed';

export interface CallStage {
  key: string;
  label: string;
  detail: string;
  at: string;
  durationSec: number;
  /** The caller is waiting (for the agent, a fallback agent or a person). */
  hold: boolean;
  /** The caller is waiting for the rule's own agent (what the hold limit counts). */
  agentWait: boolean;
}

export interface SimulatedCall {
  id: string;
  simulated: true;
  direction: 'Inbound';
  from: string;
  to: string;
  numberId: string;
  ruleId: string;
  ruleName: string;
  maxHold: number | null;
  agentId: string;
  agentName: string;
  answeredBy: { id: string; name: string; version: string } | null;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  holdSec: number;
  agentWaitSec: number;
  overLimit: boolean;
  connectedSec: number;
  conversationStart: string | null;
  conversationSec: number;
  status: CallStatus;
  issues: string[];
  stages: CallStage[];
  busy: BusyLevel;
  wantsPerson: boolean;
}

export interface TelephonyData {
  numbers: TestNumber[];
  rules: DispatchRule[];
  trunks: SipTrunk[];
  calls: SimulatedCall[];
}

/** An agent as the rules see it: its name, the version that answers, and whether it is live in Production. */
export interface TelAgent {
  id: string;
  name: string;
  version: string;
  live: boolean;
  /** Where it runs, in words: "Live in Production", "In Staging", "Draft only"… */
  where: string;
  /** Whether its draft can pass a caller to a person; null when the draft could not be read. */
  canHandOff: boolean | null;
}

/** How many simulated calls are kept. */
export const CALLS_KEPT = 500;

// ---------------------------------------------------------------------------------------------------------------------
// Words and choices
// ---------------------------------------------------------------------------------------------------------------------

export interface Country {
  code: string;
  name: string;
  dial: string;
  example: string;
  area: RegExp | null;
  areaRule: string;
}

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States', dial: '+1', example: '415', area: /^[2-9]\d{2}$/, areaRule: 'Use a 3-digit US area code, such as 415.' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', example: '20', area: /^\d{2,4}$/, areaRule: 'Use 2 to 4 digits, such as 20.' },
  { code: 'SG', name: 'Singapore', dial: '+65', example: '', area: null, areaRule: '' },
  { code: 'AU', name: 'Australia', dial: '+61', example: '2', area: /^[2378]$/, areaRule: 'Use one digit: 2, 3, 7 or 8.' },
  { code: 'IN', name: 'India', dial: '+91', example: '22', area: /^\d{2,4}$/, areaRule: 'Use 2 to 4 digits, such as 22.' },
];

export const countryName = (code: string): string => COUNTRIES.find((c) => c.code === code)?.name ?? code;

export const RULE_TYPES: Record<RuleType, { label: string; note: string }> = {
  individual: { label: 'Individual', note: 'Each caller gets their own room with the agent.' },
  direct: { label: 'Direct', note: 'All callers join one shared room.' },
};

export const RULE_HOURS: Record<RuleHours, string> = { any: 'Any time', business: 'Business hours', after: 'After hours' };

export const OVERFLOW_OPTIONS: Record<Overflow, { label: string; short: string }> = {
  person: { label: 'Hand off to a person', short: 'Hand to a person' },
  agent: { label: 'Send to another agent', short: 'Send to another agent' },
  end: { label: 'Play the exit message and end the call', short: 'End the call' },
  wait: { label: 'Keep waiting', short: 'Keep waiting' },
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const BUSY_LEVELS: Record<BusyLevel, { label: string; wait: [number, number] }> = {
  quiet: { label: 'Quiet', wait: [0, 6] },
  busy: { label: 'Busy', wait: [15, 45] },
  overloaded: { label: 'Overloaded', wait: [60, 120] },
};

export type StatusTone = 'success' | 'warning' | 'danger';
export const CALL_STATUS_TONE: Record<CallStatus, StatusTone> = {
  Completed: 'success',
  'Handed to a person': 'success',
  Overflowed: 'warning',
  'Ended early': 'warning',
  Abandoned: 'danger',
  'No match': 'danger',
  Failed: 'danger',
};

export const RANGES = ['Past 24 hours', 'Past 7 days', 'Past 30 days', 'Past 90 days'] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_MS: Record<Range, number> = { 'Past 24 hours': 86_400_000, 'Past 7 days': 7 * 86_400_000, 'Past 30 days': 30 * 86_400_000, 'Past 90 days': 90 * 86_400_000 };

/** What each part says about itself, so nobody believes a number or a trunk here exists. */
export const SANDBOX_COPY: Record<'calls' | 'dispatch' | 'numbers' | 'trunks' | 'dialog', string> = {
  calls: 'These calls are simulated in your browser to show how your rules would route a call. No real call is placed or received.',
  dispatch:
    'Rules here are kept in this browser and route no real call. On the platform a call reaches an agent through a SIP trunk and a dispatch rule that names the agent and its environment; setting up a number under Phone numbers makes both. Business hours, caller-prefix routing, priority, hold limits, hold messages and overflow are not features of the platform yet.',
  numbers:
    'Test numbers come from ranges reserved for fictional use and only exist in this browser: “Get a number” buys and connects nothing. Dispatch rules and simulated calls use them.',
  trunks: 'Nothing is created at a carrier: a trunk here is only a row in this browser. On the platform, the trunk a number needs is made when the number is set up.',
  dialog: 'Kept in this browser only. Nothing real is created or routed.',
};

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------

export type Random = () => number;

const between = (min: number, max: number, random: Random): number => Math.round(min + random() * (max - min));
const digits = (count: number, random: Random): string => Array.from({ length: count }, () => Math.floor(random() * 10)).join('');

/** A record id such as "SDR_k3j9x2abc". */
export function makeId(prefix: string, random: Random = Math.random, now = Date.now()): string {
  return `${prefix}_${now.toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

/** "10 s", "1 min 8 s", "1 h 5 min". */
export function formatDuration(seconds = 0): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The short id a call is shown by ("#X2ABCD"). */
export const callTag = (id: string): string => `#${id.slice(-6).toUpperCase()}`;

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value.filter((item) => item && typeof item === 'object' && (item as { id?: unknown }).id) as T[]) : []);

/** Whatever was kept, as four lists of records with ids. */
export function normalizeTelephony(value?: unknown): TelephonyData {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { numbers: list(v.numbers), rules: list(v.rules), trunks: list(v.trunks), calls: list(v.calls) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------------------------------------------------

/** Can the agent pass a caller to a person? A transfer-or-callback tool, a defined transfer, or an escalation rule. */
export function hasHumanHandoff(config: unknown): boolean {
  type Item = { builtin?: unknown; action?: unknown } | null | undefined;
  const c = (config && typeof config === 'object' ? config : {}) as { tools?: unknown; telephony?: { transfers?: unknown }; guardrails?: { escalation?: unknown } };
  const arr = (x: unknown): Item[] => (Array.isArray(x) ? x : []);
  return (
    arr(c.tools).some((tool) => tool?.builtin === 'transfer_or_callback') ||
    arr(c.telephony?.transfers).length > 0 ||
    arr(c.guardrails?.escalation).some((rule) => rule?.action === 'tool' || rule?.action === 'handoff')
  );
}

/** The studio's agent as the rules see it. */
export function telAgent(agent: Agent): TelAgent {
  const current = currentDeployments(agent);
  const latest = agent.versions[0]?.version;
  const version = current.production?.version || latest || 'draft';
  const where = current.production
    ? 'Live in Production'
    : current.staging
      ? 'In Staging'
      : current.development
        ? 'In Development'
        : latest
          ? 'Published, not deployed'
          : 'Draft only';
  return { id: agent.id, name: agent.name || agent.id, version, live: !!current.production, where, canHandOff: agent.loadError ? null : hasHumanHandoff(agent.draft?.config) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------------

export const RULE_DEFAULTS = {
  hours: 'any' as RuleHours,
  days: [1, 2, 3, 4, 5],
  openTime: '09:00',
  closeTime: '17:00',
  callerPrefix: '',
  priority: 5,
  maxHold: 30,
  holdMessage: '',
  overflow: 'person' as Overflow,
  overflowAgentId: '',
};

/** A rule with every setting filled in (rules kept by an older version may lack some). */
export const ruleSettings = (rule: Partial<DispatchRule> | null | undefined): typeof RULE_DEFAULTS & Partial<DispatchRule> => ({ ...RULE_DEFAULTS, ...(rule || {}) });

/** When a rule applies, split for a table: the days, and the hours under them ("" for any time). */
export function ruleHoursParts(rule: Partial<DispatchRule>): { days: string; hours: string } {
  const r = ruleSettings(rule);
  if (r.hours === 'any') return { days: 'Any time', hours: '' };
  const days = [...r.days].sort((a, b) => a - b);
  const key = days.join(',');
  const dayText = key === '1,2,3,4,5' ? 'Mon–Fri' : key === '0,1,2,3,4,5,6' ? 'Every day' : days.map((d) => WEEKDAYS[d]).join(', ');
  return { days: `${r.hours === 'business' ? '' : 'Outside '}${dayText}`, hours: `${r.openTime}–${r.closeTime}` };
}

/** "Any time", "Mon–Fri 09:00–17:00", "Outside Mon–Fri 09:00–17:00". */
export function describeRuleHours(rule: Partial<DispatchRule>): string {
  const { days, hours } = ruleHoursParts(rule);
  return hours ? `${days} ${hours}` : days;
}

/** Whether a rule handles calls at this moment (in this browser's time zone). */
export function ruleAppliesAt(rule: Partial<DispatchRule>, date: Date): boolean {
  const r = ruleSettings(rule);
  if (r.hours === 'any') return true;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const [oh, om] = r.openTime.split(':').map(Number);
  const [ch, cm] = r.closeTime.split(':').map(Number);
  const inside = r.days.includes(date.getDay()) && minutes >= oh * 60 + om && minutes < ch * 60 + cm;
  return r.hours === 'business' ? inside : !inside;
}

const dialDigits = (value: string): string => String(value || '').replace(/[^\d+]/g, '');

/** The rules that handle this call, best first (lowest priority number wins, then the oldest rule). */
export function matchingRules(data: TelephonyData, numberId: string, caller: string, date: Date): DispatchRule[] {
  return data.rules
    .filter((rule) => rule.routing === 'all' || rule.routing === numberId)
    .filter((rule) => ruleAppliesAt(rule, date))
    .filter((rule) => {
      const prefix = dialDigits(ruleSettings(rule).callerPrefix);
      return !prefix || dialDigits(caller).startsWith(prefix);
    })
    .sort((a, b) => ruleSettings(a).priority - ruleSettings(b).priority || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Where a rule takes its calls from, for a table. */
export function routingLabel(data: TelephonyData, rule: DispatchRule): string {
  if (rule.routing === 'all') return 'All inbound numbers';
  const number = data.numbers.find((n) => n.id === rule.routing);
  if (number) return number.number;
  const trunk = data.trunks.find((t) => t.id === rule.routing);
  return trunk ? `Trunk: ${trunk.name}` : 'Unassigned';
}

/** Where a rule takes its calls from, in a sentence. */
export function describeRuleRouting(data: TelephonyData, rule: DispatchRule): string {
  if (!rule.routing) return 'no number';
  if (rule.routing === 'all') return 'all inbound numbers';
  const number = data.numbers.find((n) => n.id === rule.routing);
  if (number) return number.number;
  const trunk = data.trunks.find((t) => t.id === rule.routing);
  return trunk ? `the ${trunk.name} trunk` : 'no number';
}

/** The rule a test number's calls go to: one routed from it, else one for all numbers. */
export const ruleForNumber = (data: TelephonyData, numberId: string): DispatchRule | undefined =>
  data.rules.find((r) => r.routing === numberId) || data.rules.find((r) => r.routing === 'all');

/** Rules that send callers to an agent that is missing or not live in Production. */
export const rulesNotLive = (data: TelephonyData, agents: TelAgent[]): DispatchRule[] =>
  data.rules.filter((rule) => !agents.find((a) => a.id === rule.agentId)?.live);

/** What the dispatch-rule form holds (numbers as typed). */
export interface RuleForm {
  name: string;
  type: RuleType;
  routing: string;
  agentId: string;
  roomPrefix: string;
  hours: RuleHours;
  days: number[];
  openTime: string;
  closeTime: string;
  callerPrefix: string;
  priority: string;
  maxHold: string;
  holdMessage: string;
  overflow: Overflow;
  overflowAgentId: string;
}

/** The form for a new rule, or for editing one. */
export function ruleForm(data: TelephonyData, agents: TelAgent[], initial: DispatchRule | null = null): RuleForm {
  const r = ruleSettings(initial);
  const agentId = initial?.agentId || agents[0]?.id || '';
  return {
    name: initial?.name || '',
    type: initial?.type || 'individual',
    routing: initial ? initial.routing || 'all' : data.numbers[0]?.id || data.trunks.find((t) => t.direction === 'inbound')?.id || 'all',
    agentId,
    roomPrefix: initial?.roomPrefix || 'call-',
    hours: r.hours,
    days: r.days,
    openTime: r.openTime,
    closeTime: r.closeTime,
    callerPrefix: r.callerPrefix,
    priority: String(r.priority),
    maxHold: String(r.maxHold),
    holdMessage: r.holdMessage,
    overflow: r.overflow,
    overflowAgentId: r.overflowAgentId || agents.find((a) => a.id !== agentId)?.id || '',
  };
}

export type RuleErrors = Record<'name' | 'agent' | 'prefix' | 'days' | 'times' | 'callerPrefix' | 'priority' | 'maxHold' | 'overflowAgent', string>;

/** What is wrong with the form, field by field ("" when fine). */
export function ruleErrors(form: RuleForm, data: TelephonyData, editingId = ''): RuleErrors {
  const duplicate = data.rules.some((rule) => rule.id !== editingId && rule.name.trim().toLowerCase() === form.name.trim().toLowerCase());
  const hold = Number(form.maxHold);
  const priority = Number(form.priority);
  return {
    name: !form.name.trim() ? 'Give the rule a name.' : duplicate ? 'A rule with this name already exists.' : '',
    agent: !form.agentId ? 'Choose the agent that answers these calls.' : '',
    prefix: form.roomPrefix && !/^[a-z0-9-_]+$/i.test(form.roomPrefix) ? 'Use letters, numbers, hyphens or underscores.' : '',
    days: form.hours !== 'any' && !form.days.length ? 'Pick at least one day.' : '',
    times: form.hours !== 'any' && form.openTime >= form.closeTime ? 'The closing time must be after the opening time.' : '',
    callerPrefix: form.callerPrefix && !/^\+?\d{1,6}$/.test(form.callerPrefix.replace(/\s/g, '')) ? 'Use up to 6 digits, optionally starting with +, e.g. +91.' : '',
    priority: form.priority.trim() === '' || !Number.isInteger(priority) || priority < 1 || priority > 10 ? 'Use a whole number from 1 to 10.' : '',
    maxHold: form.maxHold.trim() === '' || !Number.isFinite(hold) || hold < 5 || hold > 600 ? 'Use 5 to 600 seconds.' : '',
    overflowAgent: form.overflow === 'agent' && (!form.overflowAgentId || form.overflowAgentId === form.agentId) ? 'Choose a different agent to send calls to.' : '',
  };
}

export const hasErrors = (errors: Record<string, string>): boolean => Object.values(errors).some(Boolean);

/** The rule a valid form makes (keeping the id and creation time of the one edited). */
export function ruleFromForm(form: RuleForm, initial: DispatchRule | null, now: Date, random: Random = Math.random): DispatchRule {
  const at = now.toISOString();
  return {
    ...(initial || {}),
    id: initial?.id || makeId('SDR', random, now.getTime()),
    name: form.name.trim(),
    type: form.type,
    routing: form.routing,
    agentId: form.agentId,
    roomPrefix: form.roomPrefix || 'call-',
    hours: form.hours,
    days: [...form.days].sort((a, b) => a - b),
    openTime: form.openTime,
    closeTime: form.closeTime,
    callerPrefix: form.callerPrefix.replace(/\s/g, ''),
    priority: Number(form.priority),
    maxHold: Math.round(Number(form.maxHold)),
    holdMessage: form.holdMessage.trim(),
    overflow: form.overflow,
    overflowAgentId: form.overflow === 'agent' ? form.overflowAgentId : '',
    createdAt: initial?.createdAt || at,
    updatedAt: at,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Numbers and trunks
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A test number in the chosen country, from ranges kept for fictional use (US 555-01xx, UK Ofcom drama numbers…), so it
 * can never belong to a real subscriber. Never one already in `existing`.
 */
export function generateTestNumber(country: Country, areaCode = '', existing: string[] = [], random: Random = Math.random): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let number: string;
    if (country.code === 'US') number = `+1 ${areaCode || country.example} 555 01${digits(2, random)}`;
    else if (country.code === 'GB') number = `+44 ${areaCode || country.example} 7946 0${digits(3, random)}`;
    else if (country.code === 'SG') number = `+65 6${digits(3, random)} ${digits(4, random)}`;
    else if (country.code === 'AU') number = `+61 ${areaCode || country.example} 5550 ${digits(4, random)}`;
    else number = `${country.dial} ${areaCode || country.example} ${digits(4, random)} ${digits(4, random)}`;
    if (!existing.includes(number)) return number;
  }
  return `${country.dial} ${digits(10, random)}`;
}

/** What is wrong with an area code for this country ("" when fine or left empty). */
export const areaCodeError = (country: Country, areaCode: string): string => (areaCode && country.area && !country.area.test(areaCode) ? country.areaRule : '');

/** A phone number as a caller would type it. */
export const isPhoneNumber = (value: string): boolean => /^\+?[\d\s-]{6,20}$/.test(value.trim());

export interface TrunkForm {
  direction: TrunkDirection;
  name: string;
  numbers: string;
  address: string;
  username: string;
}

export const splitNumbers = (value: string): string[] =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export type TrunkErrors = Record<'name' | 'numbers' | 'address', string>;

/** What is wrong with the trunk form, field by field ("" when fine). */
export function trunkErrors(form: TrunkForm, data: TelephonyData): TrunkErrors {
  const numbers = splitNumbers(form.numbers);
  const bad = numbers.find((n) => !isPhoneNumber(n));
  const taken = data.trunks.some((t) => t.name.toLowerCase() === form.name.trim().toLowerCase());
  return {
    name: !form.name.trim() ? 'Give the trunk a name.' : taken ? 'A trunk with this name already exists.' : '',
    numbers: bad ? `“${bad}” isn’t a valid phone number.` : form.direction === 'outbound' && !numbers.length ? 'Add at least one number to call from.' : '',
    address:
      form.direction === 'outbound' && !form.address.trim()
        ? 'Enter your carrier’s SIP address.'
        : form.address.trim() && !/^(sips?:)?[\w.-]+(:\d+)?$/i.test(form.address.trim())
          ? 'Use a host name such as sip.carrier.com.'
          : '',
  };
}

export function trunkFromForm(form: TrunkForm, now: Date, random: Random = Math.random): SipTrunk {
  return {
    id: makeId('ST', random, now.getTime()),
    direction: form.direction,
    name: form.name.trim(),
    numbers: splitNumbers(form.numbers),
    address: form.address.trim(),
    username: form.username.trim(),
    createdAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Changes (each returns the new data)
// ---------------------------------------------------------------------------------------------------------------------

/** Rules that pointed at a removed number or trunk are kept, but unassigned. */
const unassign = (rules: DispatchRule[], id: string, at: string): DispatchRule[] => rules.map((rule) => (rule.routing === id ? { ...rule, routing: '', updatedAt: at } : rule));

export const releaseNumber = (data: TelephonyData, id: string, now: Date): TelephonyData => ({
  ...data,
  numbers: data.numbers.filter((n) => n.id !== id),
  rules: unassign(data.rules, id, now.toISOString()),
});

export const deleteTrunk = (data: TelephonyData, id: string, now: Date): TelephonyData => ({
  ...data,
  trunks: data.trunks.filter((t) => t.id !== id),
  rules: unassign(data.rules, id, now.toISOString()),
});

export const deleteRule = (data: TelephonyData, id: string): TelephonyData => ({ ...data, rules: data.rules.filter((r) => r.id !== id) });

export const saveRule = (data: TelephonyData, rule: DispatchRule): TelephonyData =>
  data.rules.some((r) => r.id === rule.id) ? { ...data, rules: data.rules.map((r) => (r.id === rule.id ? rule : r)) } : { ...data, rules: [...data.rules, rule] };

export const addCall = (data: TelephonyData, call: SimulatedCall): TelephonyData => ({ ...data, calls: [call, ...data.calls].slice(0, CALLS_KEPT) });

// ---------------------------------------------------------------------------------------------------------------------
// Simulated calls
// ---------------------------------------------------------------------------------------------------------------------

export interface SimulateInput {
  data: TelephonyData;
  agents: TelAgent[];
  numberId: string;
  caller: string;
  when: Date;
  busy?: BusyLevel;
  wantsPerson?: boolean;
  random?: Random;
}

/**
 * Plays a call through every stage using the dispatch rules. Hold time only counts the stages where the caller is
 * waiting: for the agent, a fallback agent, or a person; the rule's hold limit counts only the wait for its own agent.
 */
export function simulateCall({ data, agents, numberId, caller, when, busy = 'quiet', wantsPerson = false, random = Math.random }: SimulateInput): SimulatedCall {
  const number = data.numbers.find((n) => n.id === numberId);
  const stages: CallStage[] = [];
  let cursor = when.getTime();
  const push = (key: string, label: string, detail: string, seconds = 0, hold = false, agentWait = false) => {
    stages.push({ key, label, detail, at: new Date(cursor).toISOString(), durationSec: seconds, hold, agentWait });
    cursor += seconds * 1000;
  };
  const notLiveNote = (agent: TelAgent) => (agent.live ? '' : ` ${agent.name} isn’t live in Production (${agent.where.toLowerCase()}).`);
  const issues: string[] = [];
  let status: CallStatus = 'Completed';
  let answeredBy: TelAgent | null = null;
  let rule: DispatchRule | null = null;
  let conversationStart: number | null = null;
  let conversationSec = 0;

  push('incoming', 'Incoming call', `${caller} called ${number?.number || 'your number'}.`, 2);
  const matches = matchingRules(data, numberId, caller, when);
  if (!matches.length) {
    push('nomatch', 'No rule matched', 'No dispatch rule handles this number, caller and time, so no agent answered.', 1);
    status = 'No match';
    issues.push('No dispatch rule matched this call.');
  } else {
    rule = matches[0];
    const r = ruleSettings(rule);
    const agent = agents.find((a) => a.id === rule?.agentId);
    const others = matches.length - 1;
    push(
      'matched',
      `Matched “${rule.name}”`,
      `${describeRuleHours(rule)}${r.callerPrefix ? `, callers starting ${r.callerPrefix}` : ''}.${others ? ` Chosen over ${others} other matching rule${others === 1 ? '' : 's'} by priority ${r.priority}.` : ''}`,
      1,
    );
    const wait = between(...BUSY_LEVELS[busy].wait, random);
    const holdNote = r.holdMessage ? ` They heard: “${r.holdMessage}”` : '';
    if (!agent) {
      push('failed', 'Agent missing', 'The rule points to an agent that no longer exists.', 1);
      status = 'Failed';
      issues.push('The rule’s agent was deleted.');
    } else if (wait > r.maxHold && r.overflow !== 'wait') {
      push('hold', `On hold for ${agent.name}`, `No answer within the ${r.maxHold}-second limit.${holdNote}`, r.maxHold, true, true);
      if (r.overflow === 'agent') {
        const fallback = agents.find((a) => a.id === r.overflowAgentId);
        if (fallback) {
          push('overflow', `Sent to ${fallback.name}`, `The rule sends unanswered calls to ${fallback.name}.`, 1);
          push('hold', `On hold for ${fallback.name}`, 'Waiting for the fallback agent.', between(2, 8, random), true);
          answeredBy = fallback;
          status = 'Overflowed';
        } else {
          push('failed', 'Fallback agent missing', 'The fallback agent no longer exists.', 1);
          status = 'Failed';
          issues.push('The fallback agent was deleted.');
        }
      } else if (r.overflow === 'person') {
        push('hold', 'Waiting for a person', 'No agent answered in time, so the call went to the human queue.', between(10, 40, random), true);
        conversationStart = cursor;
        conversationSec = between(60, 180, random);
        push('handoff', 'Answered by a person', 'A member of your team took the call.', conversationSec);
        status = 'Handed to a person';
      } else {
        push('exit', 'Exit message played', 'No one answered in time, so the call ended politely.', 4);
        status = 'Ended early';
        issues.push(`No one answered within ${r.maxHold} seconds.`);
      }
    } else if (wait >= 120) {
      // (Weave React tested "> 120", which its longest wait of 120 s never reached, so no call was ever abandoned)
      push('hold', `On hold for ${agent.name}`, `Past the ${r.maxHold}-second limit; the rule keeps callers waiting.${holdNote}`, 120, true, true);
      push('abandoned', 'Caller hung up', 'The caller gave up after two minutes on hold.', 0);
      status = 'Abandoned';
      issues.push('The caller hung up while on hold.');
    } else {
      if (wait > 0)
        push(
          'hold',
          `On hold for ${agent.name}`,
          wait > r.maxHold ? `Past the ${r.maxHold}-second limit; the rule keeps callers waiting.${holdNote}` : `Waiting for the agent.${holdNote}`,
          wait,
          true,
          true,
        );
      answeredBy = agent;
    }
    if (answeredBy) {
      const note = notLiveNote(answeredBy);
      if (note) issues.push(note.trim());
      conversationStart = cursor;
      conversationSec = between(45, 240, random);
      push('answered', `Answered by ${answeredBy.name}`, `${answeredBy.version === 'draft' ? 'The draft' : `Version ${answeredBy.version}`}.${note}`, conversationSec);
      if (wantsPerson) {
        if (answeredBy.canHandOff) {
          push('hold', 'Waiting for a person', `The caller asked for a person, so ${answeredBy.name} handed off.`, between(10, 40, random), true);
          push('handoff', 'Answered by a person', 'A member of your team took over.', between(60, 180, random));
          status = 'Handed to a person';
        } else if (answeredBy.canHandOff === false) {
          issues.push(`The caller asked for a person, but ${answeredBy.name} has no transfer, callback tool or escalation rule.`);
        } else {
          issues.push(`The caller asked for a person, but ${answeredBy.name}’s configuration couldn’t be read to check handoff.`);
        }
      }
    }
    const agentWait = stages.filter((s) => s.agentWait).reduce((sum, s) => sum + s.durationSec, 0);
    if (agentWait > r.maxHold) issues.push(`The caller waited ${formatDuration(agentWait)} for ${agent?.name || 'the agent'}, over the rule’s ${r.maxHold}-second limit.`);
  }
  push('ended', 'Call ended', '', 0);
  const holdSec = stages.filter((s) => s.hold).reduce((sum, s) => sum + s.durationSec, 0);
  const agentWaitSec = stages.filter((s) => s.agentWait).reduce((sum, s) => sum + s.durationSec, 0);
  const durationSec = Math.round((cursor - when.getTime()) / 1000);
  const chosen = rule as DispatchRule | null;
  return {
    id: makeId('CA', random, when.getTime()),
    simulated: true,
    direction: 'Inbound',
    from: caller,
    to: number?.number || '—',
    numberId,
    ruleId: chosen?.id || '',
    ruleName: chosen?.name || '',
    maxHold: chosen ? ruleSettings(chosen).maxHold : null,
    agentId: answeredBy?.id || chosen?.agentId || '',
    agentName: answeredBy?.name || (chosen ? agents.find((a) => a.id === chosen.agentId)?.name || 'Deleted agent' : ''),
    answeredBy: answeredBy ? { id: answeredBy.id, name: answeredBy.name, version: answeredBy.version } : null,
    startedAt: when.toISOString(),
    endedAt: new Date(cursor).toISOString(),
    durationSec,
    holdSec,
    agentWaitSec,
    overLimit: !!chosen && agentWaitSec > ruleSettings(chosen).maxHold,
    connectedSec: Math.max(0, durationSec - holdSec),
    conversationStart: conversationStart !== null ? new Date(conversationStart).toISOString() : null,
    conversationSec,
    status,
    issues,
    stages,
    busy,
    wantsPerson,
  };
}

/** What the call form says before the call is run. */
export function previewWords(data: TelephonyData, agents: TelAgent[], numberId: string, caller: string, when: Date): string {
  const matches = numberId ? matchingRules(data, numberId, caller, when) : [];
  if (!matches.length) return 'No dispatch rule matches this number, caller and time, so the call won’t be answered.';
  const first = matches[0];
  return `This call would match “${first.name}” and go to ${agents.find((a) => a.id === first.agentId)?.name || 'a deleted agent'} (hold limit ${ruleSettings(first).maxHold} s).`;
}

export function callsInRange(calls: SimulatedCall[], range: Range = 'Past 24 hours', now = Date.now()): SimulatedCall[] {
  const since = now - (RANGE_MS[range] ?? RANGE_MS['Past 24 hours']);
  return calls.filter((call) => Date.parse(call.startedAt) >= since);
}

export interface CallsSummary {
  count: number;
  totalTalkSec: number;
  avgTalkSec: number;
  avgHoldSec: number;
  longestHoldSec: number | null;
  overLimit: number;
  answered: number;
  /** Whole percent of the calls an agent answered (0 with none). */
  answeredShare: number;
  withIssues: number;
}

/** The numbers above the calls table. */
export function summarizeCalls(calls: SimulatedCall[]): CallsSummary {
  const held = calls.filter((c) => c.ruleId);
  // a call someone talked on (React counted every call, as the ringing seconds made each one "connected")
  const connected = calls.filter((c) => c.conversationSec > 0);
  const answered = calls.filter((c) => c.answeredBy).length;
  const totalTalkSec = connected.reduce((sum, c) => sum + c.connectedSec, 0);
  return {
    count: calls.length,
    totalTalkSec,
    avgTalkSec: connected.length ? totalTalkSec / connected.length : 0,
    avgHoldSec: held.length ? held.reduce((sum, c) => sum + c.holdSec, 0) / held.length : 0,
    longestHoldSec: held.length ? Math.max(...held.map((c) => c.holdSec)) : null,
    overLimit: held.filter((c) => c.overLimit).length,
    answered,
    answeredShare: calls.length ? Math.round((answered / calls.length) * 100) : 0,
    withIssues: calls.filter((c) => c.issues.length).length,
  };
}

/** A rule's calls: how many, their average hold, and how many waited past its limit. */
export function ruleCallStats(calls: SimulatedCall[], ruleId: string): { count: number; avgHoldSec: number; over: number } {
  const mine = calls.filter((c) => c.ruleId === ruleId);
  return {
    count: mine.length,
    avgHoldSec: mine.length ? mine.reduce((sum, c) => sum + c.holdSec, 0) / mine.length : 0,
    over: mine.filter((c) => c.overLimit).length,
  };
}

/** Who answered, for the table. */
export const answeredWords = (call: SimulatedCall): string => call.answeredBy?.name || (call.status === 'Handed to a person' ? 'A person' : '—');

/** A caller number to start the form with (in the 555-01xx range kept for fictional use). */
export const sampleCaller = (random: Random = Math.random): string => `+1 415 555 01${String(between(10, 99, random))}`;
