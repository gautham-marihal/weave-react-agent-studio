// A banking agent, made from any agent in one step and taken apart again: the gateway's generated config (tools,
// connection, session events, state) plus the six specialist roles of docs/BANKING-AGENT-DESIGN.md §4.2, their
// instructions and the hand-offs between them. The agent's own roles stay; the one that answered first becomes
// reachable from the banking front desk for anything that is not banking. Pure: no React, no network.
//
// Every role definition and instruction lives here, once. The Build stage, the Create dialog and Sandbox's sample
// agent all build a banking agent through makeBankingAgent.

import type { GeneratedAgentConfig } from '../api/gatewayTypes';
import type { AgentConfig, AgentRole } from '../types/studio';
import { applyGatewayConfig, MAX_AGENT_TOOLS, removeGatewayConfig, stableJson, usesGateway, type GatewayConfigChange } from './bankingTools';
import { GOODBYE, setEndCall, setReach } from './setup';
import type { ProvidersAnswer } from '../api/types';

export type BankingRoleId = 'greeter' | 'authenticator' | 'accounts' | 'cheques' | 'rates_info' | 'appointments' | 'payments';

/** The front desk: the role that answers first in a banking agent. */
export const BANKING_ENTRY: BankingRoleId = 'greeter';
export const BANKING_ROLE_IDS: readonly BankingRoleId[] = ['greeter', 'authenticator', 'accounts', 'cheques', 'rates_info', 'appointments', 'payments'];
export const isBankingRoleId = (id: unknown): id is BankingRoleId => typeof id === 'string' && (BANKING_ROLE_IDS as readonly string[]).includes(id);

interface Handoff {
  id: string;
  tool: string;
  description: string;
  to: string;
  carry_context?: boolean;
}

/** A hand-off a banking role makes, before it is placed in a role: where it goes, what its tool says, and when. */
interface HandoffTemplate {
  to: BankingRoleId;
  /** The tool's name before the role it sits in is added. */
  verb: string;
  description: string;
}

const handoff = (to: BankingRoleId, verb: string, description: string): HandoffTemplate => ({ to, verb, description });

/**
 * The hand-off as it sits in role `from`. The Agent Builder server wants every hand-off id, and every hand-off tool
 * name, to be unique in the whole agent (validate_config: "duplicate handoff tool name"), and several roles hand over
 * to the same specialist, so both name the role they start from: accounts_to_authenticator, go_to_sign_in_from_accounts.
 */
export const placeHandoff = (from: string, t: HandoffTemplate): Handoff => ({ id: `${from}_to_${t.to}`, tool: `${t.verb}_from_${from}`, description: t.description, to: t.to, carry_context: true });

const TO = {
  authenticator: handoff('authenticator', 'go_to_sign_in', 'The caller needs to sign in, or a banking tool answered with next: start_authentication.'),
  accounts: handoff('accounts', 'go_to_accounts', 'The caller asks about balances, incoming funds, recent transactions, statements or changing their Phone PIN.'),
  cheques: handoff('cheques', 'go_to_cheques', 'The caller asks about cheques: deposited cheques, a cheque they issued, cheque books or stopping a cheque.'),
  rates_info: handoff('rates_info', 'go_to_rates_and_info', 'The caller asks about exchange rates, the prime rate, time deposit rates, branches or announcements.'),
  appointments: handoff('appointments', 'go_to_appointments', 'The caller wants to book, check or cancel a branch appointment.'),
  payments: handoff('payments', 'go_to_transfers', 'The caller wants to move money between their own accounts.'),
  greeter: handoff('greeter', 'back_to_menu', 'The caller wants something you do not handle, has nothing more for you, or wants to end the call.'),
} as const;

/** What every banking role is told: the design rules (§4.5, §6.2, §8.3 step 7). */
export const BANKING_RULES: readonly string[] = [
  'Every banking tool answers with ok, say and next. Do what next says: continue goes on; retry or ask_again asks the caller once more; wait_for_secure_entry tells the caller to use the secure keypad on their screen and then waits; start_authentication hands over to sign-in; confirm_or_cancel reads the summary and asks for a clear yes or no; offer_transfer or offer_callback offers a Service Manager or a callback; transfer_now transfers now; end_call says goodbye and ends the call.',
  'When a result has say, read it to the caller as given. Never reword, round or add to amounts, dates, rates or cheque status.',
  'Never ask for a PIN, NRIC, one-time password (OTP) or password aloud or in chat, and never repeat one a caller offers. The caller keys them in on the secure keypad on their screen.',
  'Refer to accounts by the account ref the tools give (A1, A2) and the last digits they show. Never read out a full account number.',
  'If a tool fails, say its error_message plainly and follow next. Never invent balances, rates, cheque details or any account data.',
];

/** For the roles that change something for the caller (they have confirm_transaction). */
export const BANKING_WRITE_RULE =
  'Every change is two steps: a prepare_ tool, then confirm_transaction. Read the prepared summary as given, ask the caller to confirm, and pass their exact reply to confirm_transaction; if they say no, call cancel_transaction. Never confirm for the caller.';

interface RoleSpec {
  id: BankingRoleId;
  name: string;
  kind: 'router' | 'specialist';
  role: string;
  writes: boolean;
  handoffs: HandoffTemplate[];
}

export const BANKING_ROLES: readonly RoleSpec[] = [
  {
    id: 'greeter',
    name: 'Banking front desk',
    kind: 'router',
    role: 'You answer first for business banking. Call get_caller_context once at the start and greet the caller for the time of day. Find out what they need, offer a short menu from list_services, and hand over to the right specialist. You handle lost or stolen cards (report_lost_card, then transfer), callbacks (request_callback) and requests for a person (prepare_agent_transfer) yourself. Do no account business yourself.',
    writes: false,
    handoffs: [TO.authenticator, TO.accounts, TO.cheques, TO.rates_info, TO.appointments, TO.payments],
  },
  {
    id: 'authenticator',
    name: 'Sign-in',
    kind: 'specialist',
    role: 'You verify who the caller is, and nothing else. Ask whether they sign in with their 7-digit Phone Code or their 12-digit business account number, and call start_authentication with the one they give. The caller then keys in their PIN, or their NRIC digits and SMS one-time password, on the secure keypad on their screen. When they say they have finished, call get_auth_status. If the SMS did not arrive, call resend_otp; if they gave the wrong Phone Code or account number, call restart_authentication. Once they are verified, hand over to the specialist for what they asked.',
    writes: false,
    handoffs: [TO.accounts, TO.cheques, TO.appointments, TO.payments, TO.greeter],
  },
  {
    id: 'accounts',
    name: 'Accounts',
    kind: 'specialist',
    role: 'You help a verified caller with their accounts: which accounts they have (list_accounts), balances, incoming funds, recent transactions, statement requests and changing their Phone PIN (start_pin_change). If they have several accounts, ask which one by its ref and last digits.',
    writes: true,
    handoffs: [TO.authenticator, TO.payments, TO.greeter],
  },
  {
    id: 'cheques',
    name: 'Cheques',
    kind: 'specialist',
    role: 'You help a verified caller with cheques: cheques they deposited, the status of a cheque they issued, their cheque books, ordering a cheque book and stopping a cheque.',
    writes: true,
    handoffs: [TO.authenticator, TO.greeter],
  },
  {
    id: 'rates_info',
    name: 'Rates and information',
    kind: 'specialist',
    role: 'You give public information that needs no sign-in: foreign exchange rates, the prime rate, time deposit rates, branches and announcements. Offer a callback or a Service Manager when the caller needs more.',
    writes: false,
    handoffs: [TO.greeter],
  },
  {
    id: 'appointments',
    name: 'Appointments',
    kind: 'specialist',
    role: 'You book and cancel branch appointments for a verified caller: find the branch, offer free slots, book the one they choose, list their appointments and cancel one.',
    writes: true,
    handoffs: [TO.authenticator, TO.greeter],
  },
  {
    id: 'payments',
    name: 'Transfers',
    kind: 'specialist',
    role: 'You move money between a verified caller\'s own accounts, and nothing else: never to anyone else\'s account. Ask how much and between which of their accounts (by ref and last digits; list_accounts and get_balance help), then call prepare_own_transfer with the amount exactly as the caller said it. If it answers choose_from_account or choose_to_account, ask which one. Never round, guess or change an amount.',
    writes: true,
    handoffs: [TO.authenticator, TO.accounts, TO.greeter],
  },
];

/** A role's rules: the shared design rules, and the two-step rule for the roles that change things. */
export const rulesFor = (spec: Pick<RoleSpec, 'writes'>): string[] => [...BANKING_RULES, ...(spec.writes ? [BANKING_WRITE_RULE] : [])];

/** The hand-off from the front desk to the agent's own first role, for anything that is not banking. */
const toOwnRole = (role: AgentRole): Handoff => ({
  id: `${BANKING_ENTRY}_to_${role.id}`,
  tool: `go_to_${role.id.replace(/[^a-z0-9_]/g, '_')}`,
  description: `The caller asks about something that is not banking. ${role.name || role.id} takes it.`,
  to: role.id,
  carry_context: true,
});
/** And back again, from that role to the front desk. */
export const TO_BANKING: Handoff = {
  id: 'to_banking',
  tool: 'go_to_banking',
  description: 'The caller asks about their accounts, cheques, rates, appointments, a lost card, signing in or anything else to do with business banking.',
  to: BANKING_ENTRY,
  carry_context: true,
};

/**
 * Hand-off ids and tool names used more than once in the agent: the Agent Builder server refuses such an agent (and
 * will not start a test session). A banking agent made by an older Studio has them; makeBankingAgent repairs it.
 */
export function handoffClashes(config: AgentConfig | null | undefined): string[] {
  const all = ((config?.agents?.items ?? []) as AgentRole[]).flatMap((r) => (Array.isArray(r.handoffs) ? (r.handoffs as Handoff[]) : []));
  const twice = (values: string[]) => values.filter((v, i) => typeof v === 'string' && values.indexOf(v) !== i);
  return [...new Set([...twice(all.map((h) => h?.id)), ...twice(all.map((h) => h?.tool))])];
}

/** A banking role's own hand-offs, placed in it (unique ids and tool names). */
export const handoffsOf = (spec: RoleSpec): Handoff[] => spec.handoffs.map((t) => placeHandoff(spec.id, t));

const roleFrom = (spec: RoleSpec): AgentRole => ({ id: spec.id, name: spec.name, kind: spec.kind, instructions: { role: spec.role, rules: rulesFor(spec) }, tools: [], handoffs: handoffsOf(spec) });

/**
 * Sets the hand-offs that banking manages in a role, keeping any the owner added. Managed ones are those that go to a
 * banking role, or to `own` (the agent's own role the front desk passes non-banking to); they are replaced, not added
 * beside, so a banking agent made by an older Studio (with the same hand-off in several roles) is repaired too.
 */
const withHandoffs = (role: AgentRole, wanted: Handoff[], own: string | null): AgentRole => {
  const have = (role.handoffs ?? []) as Handoff[];
  const kept = have.filter((h) => !(isBankingRoleId(h?.to) || (own !== null && h?.to === own)));
  const next = [...kept, ...wanted];
  return stableJson(next) === stableJson(have) ? role : { ...role, handoffs: next };
};

export interface BankingAgentChange {
  readonly ok: boolean;
  /** The new config when ok and changed; the input itself otherwise. */
  readonly config: AgentConfig;
  readonly changed: boolean;
  readonly conflicts: readonly string[];
  /** Specialist roles created now (the others were there already). */
  readonly rolesAdded: readonly string[];
  /** The agent's own role the front desk hands non-banking questions to, if it has one. */
  readonly ownRole: string | null;
  /** What the gateway's config did to the draft (null when refused before it ran). */
  readonly gateway: GatewayConfigChange | null;
}

/** Whether a role with a banking id is a banking role (it has gateway tools or our own words), not one of the owner's. */
const looksBanking = (role: AgentRole, generated: GeneratedAgentConfig | null): boolean => {
  const spec = BANKING_ROLES.find((s) => s.id === role.id);
  const gatewayNames = new Set(generated?.tools.map((t) => t.id) ?? []);
  return (role.tools ?? []).some((n) => gatewayNames.has(n)) || (!!spec && role.instructions?.role === spec.role);
};

/**
 * Makes the draft a complete banking agent, or brings it up to date: the gateway's config, the six roles with their
 * instructions and tools (at most 8 each), the hand-offs, the front desk answering first, and end_call for it.
 * Applying it twice changes nothing.
 */
export function makeBankingAgent(config: AgentConfig, generated: GeneratedAgentConfig, { gatewayUrl }: { gatewayUrl?: string } = {}): BankingAgentChange {
  const refused = (conflicts: string[], gateway: GatewayConfigChange | null = null): BankingAgentChange => ({ ok: false, config, changed: false, conflicts, rolesAdded: [], ownRole: null, gateway });
  const items = (config.agents?.items ?? []) as AgentRole[];

  const clashes = items.filter((r) => isBankingRoleId(r.id) && !looksBanking(r, generated)).map((r) => `The agent already has its own role "${r.id}", which a banking agent needs for itself. Rename that role first.`);
  if (clashes.length) return refused(clashes);

  // The agent's own role that answered first (or its first own role), reachable from the front desk.
  const entryId = config.agents?.entry;
  const own = items.find((r) => r.id === entryId && !isBankingRoleId(r.id)) ?? items.find((r) => !isBankingRoleId(r.id)) ?? null;
  const ownId = (items.find((r) => r.id === BANKING_ENTRY)?.handoffs as Handoff[] | undefined)?.find((h) => !isBankingRoleId(h?.to))?.to ?? own?.id ?? null;
  const ownRole = items.find((r) => r.id === ownId) ?? null;

  const rolesAdded: string[] = [];
  const nextItems: AgentRole[] = items.map((r) => (ownRole && r.id === ownRole.id ? withHandoffs(r, [TO_BANKING], null) : r));
  const ownTo = ownRole?.id ?? null;
  for (const spec of BANKING_ROLES) {
    const index = nextItems.findIndex((r) => r.id === spec.id);
    const wanted = spec.id === BANKING_ENTRY && ownRole ? [...handoffsOf(spec), toOwnRole(ownRole)] : handoffsOf(spec);
    if (index >= 0) nextItems[index] = withHandoffs(nextItems[index] as AgentRole, wanted, ownTo);
    else {
      nextItems.push(withHandoffs(roleFrom(spec), wanted, ownTo));
      rolesAdded.push(spec.id);
    }
  }
  const shaped: AgentConfig = { ...config, agents: { ...(config.agents ?? {}), entry: BANKING_ENTRY, items: nextItems } };

  const gateway = applyGatewayConfig(shaped, generated, gatewayUrl);
  if (!gateway.ok) return refused([...gateway.conflicts], gateway);
  // The front desk ends the call (the agent's own end_call tool when it has one).
  const next = setEndCall(gateway.config, true);

  const changed = stableJson(next) !== stableJson(config);
  return { ok: true, config: changed ? next : config, changed, conflicts: [], rolesAdded, ownRole: ownRole?.id ?? null, gateway };
}

export interface RemoveBankingChange {
  readonly ok: boolean;
  readonly config: AgentConfig;
  readonly reason: string;
}

const isOwnEndCall = (t: { id?: unknown; type?: unknown; builtin?: unknown }) => t.type === 'builtin' && t.builtin === 'end_call' && typeof t.id === 'string' && /^end_call(_\d+)?$/.test(t.id);

/**
 * Takes the banking out again: the six roles, the hand-offs to them, the gateway's config, and the end_call tool and
 * goodbye line when only the front desk used them. The agent's own role answers first again.
 */
export function removeBankingAgent(config: AgentConfig): RemoveBankingChange {
  const items = (config.agents?.items ?? []) as AgentRole[];
  const kept = items.filter((r) => !isBankingRoleId(r.id));
  if (!kept.length) return { ok: false, config, reason: 'This agent has no role of its own to answer instead. Add one under Agents first, then remove banking.' };
  const ownId = (items.find((r) => r.id === BANKING_ENTRY)?.handoffs as Handoff[] | undefined)?.find((h) => !isBankingRoleId(h?.to))?.to;
  const entry = isBankingRoleId(config.agents?.entry) || !config.agents?.entry ? (kept.find((r) => r.id === ownId) ?? kept[0])?.id : config.agents.entry;

  const roles = kept.map((r) => {
    if (!Array.isArray(r.handoffs) || !(r.handoffs as Handoff[]).some((h) => isBankingRoleId(h?.to))) return r;
    const handoffs = (r.handoffs as Handoff[]).filter((h) => !isBankingRoleId(h?.to));
    const next: AgentRole = { ...r, handoffs };
    if (!handoffs.length) delete next.handoffs;
    return next;
  });
  let next = removeGatewayConfig({ ...config, agents: { ...config.agents, entry, items: roles } });

  // end_call and its goodbye line, when nothing that stays uses them.
  const used = new Set(roles.flatMap((r) => r.tools ?? []));
  const dropped = (next.tools ?? []).filter((t) => isOwnEndCall(t) && !used.has(t.id) && !stableJson({ ...next, tools: [] }).includes(JSON.stringify(t.id)));
  if (dropped.length) {
    next = { ...next, tools: (next.tools ?? []).filter((t) => !dropped.includes(t)) };
    const messages = Array.isArray(next.messages) ? (next.messages as Array<{ id?: string; text?: string }>) : [];
    const stillSaid = stableJson({ ...next, messages: [] }).includes(JSON.stringify(GOODBYE.id));
    if (!stillSaid && messages.some((m) => m.id === GOODBYE.id && m.text === GOODBYE.text)) {
      const rest = messages.filter((m) => m.id !== GOODBYE.id);
      next = { ...next, messages: rest };
      if (!rest.length) delete next.messages;
    }
  }
  return { ok: true, config: next, reason: '' };
}

/** Is this draft a banking agent (wired to the banking gateway)? */
export const isBankingAgent = (config: AgentConfig | null | undefined): boolean => usesGateway(config);

/** The banking roles a draft has, each with its tool count and whether it is within the 8-tool limit. */
export function bankingRolesOf(config: AgentConfig | null | undefined): Array<{ id: BankingRoleId; name: string; tools: number; withinLimit: boolean }> {
  const items = (config?.agents?.items ?? []) as AgentRole[];
  return BANKING_ROLES.flatMap((spec) => {
    const role = items.find((r) => r.id === spec.id);
    if (!role) return [];
    const tools = (role.tools ?? []).length;
    return [{ id: spec.id, name: role.name || spec.name, tools, withinLimit: tools <= MAX_AGENT_TOOLS }];
  });
}

/** A new banking agent's ways in: chat and talking on the website (speech models from the server's providers). */
export function withBankingChannels(config: AgentConfig, { providers = null, botId = '' }: { providers?: ProvidersAnswer | null; botId?: string } = {}): AgentConfig {
  const chat = setReach(config, 'web_chat', true, { providers, botId }).config;
  return setReach(chat, 'web_voice', true, { providers, botId }).config;
}

/** A new agent from the "Banking assistant" starter: a banking agent people reach by web chat and web voice. */
export function newBankingAssistant(
  config: AgentConfig,
  generated: GeneratedAgentConfig,
  options: { providers?: ProvidersAnswer | null; botId?: string; gatewayUrl?: string } = {}
): BankingAgentChange {
  const made = makeBankingAgent(config, generated, { gatewayUrl: options.gatewayUrl });
  if (!made.ok) return made;
  const next = withBankingChannels(made.config, options);
  return { ...made, config: next, changed: stableJson(next) !== stableJson(config) };
}
