import type { ServiceId } from '../domain/types.ts';
import { clockMinutes, greetingPeriod, localParts } from '../domain/time.ts';
import { entitlement } from '../fsm/session-machine.ts';
import { digits, empty, object, oneOf, string } from '../schema/schema.ts';
import { maskTail } from '../security/redact.ts';
import { declined, defineTool, ok, type ToolContext } from './define.ts';
import { ROUTES } from './routing.ts';

/** Deck p31/p35: Mon–Fri 08:30–18:00, excluding public holidays (from CMM). */
export async function serviceCentreOpen(ctx: ToolContext): Promise<boolean> {
  const local = localParts(ctx.now);
  const { open, close, weekdays } = ctx.policy.serviceCentre;
  if (!weekdays.includes(local.weekday)) return false;
  if (local.minutes < clockMinutes(open) || local.minutes >= clockMinutes(close)) return false;
  return !(await ctx.ports.content.isHoliday(local.date, ctx.signal));
}

export const getCallerContext = defineTool({
  name: 'get_caller_context',
  agents: ['greeter'],
  description: 'Call once at the start: greeting period (morning/afternoon/evening), whether Service Managers are available now, and the caller\'s preferred language if known from earlier calls.',
  access: 'public',
  service: null,
  effect: 'read',
  params: empty(),
  llmFields: ['greeting', 'service_centre_open', 'preferred_language', 'channel'],
  timeoutMs: 3_000,
  legacy: 'p1 time-of-day greeting (1001/1002/1003) and stored preferred language; p31 office-hours check',
  async handler(ctx) {
    const preferred = ctx.session.callerId ? await ctx.ports.content.preferredLanguage(ctx.session.callerId, ctx.signal) : null;
    return ok({ greeting: greetingPeriod(ctx.now), service_centre_open: await serviceCentreOpen(ctx), preferred_language: preferred, channel: ctx.session.channel });
  },
});

export const recordLanguageChoice = defineTool({
  name: 'record_language_choice',
  agents: ['greeter'],
  description: 'Record the language the caller chose (en or zh). After several calls the same choice becomes their default.',
  access: 'public',
  service: null,
  effect: 'session',
  params: object({ language: oneOf(['en', 'zh'] as const) }, ['language']),
  llmFields: ['recorded'],
  timeoutMs: 3_000,
  legacy: 'p1 "Language selection personalised based on Caller ID after 5 selections; stored in CMM"',
  async handler(ctx, args) {
    if (!ctx.session.callerId) return ok({ recorded: false });
    await ctx.ports.content.recordLanguageChoice(ctx.session.callerId, args.language, ctx.signal);
    return ok({ recorded: true });
  },
});

export const MENU: ReadonlyArray<{ service: ServiceId; label: string; agent: string }> = [
  { service: 'account_balance', label: 'Account balance', agent: 'accounts' },
  { service: 'incoming_funds', label: 'Incoming funds', agent: 'accounts' },
  { service: 'recent_activity', label: 'Recent account activity', agent: 'accounts' },
  { service: 'statement_request', label: 'Statement request', agent: 'accounts' },
  { service: 'pin_change', label: 'Change Phone PIN', agent: 'accounts' },
  { service: 'cheque_deposit_status', label: 'Deposited cheques', agent: 'cheques' },
  { service: 'cheque_issued_status', label: 'Issued cheques', agent: 'cheques' },
  { service: 'chequebook_status', label: 'Cheque book sent?', agent: 'cheques' },
  { service: 'chequebook_request', label: 'New cheque book', agent: 'cheques' },
  { service: 'stop_cheque', label: 'Stop cheque payment', agent: 'cheques' },
  { service: 'fd_loan', label: 'Fixed deposit and loans (Service Manager)', agent: 'transfer' },
  { service: 'appointment', label: 'Branch appointment', agent: 'appointments' },
  { service: 'rates', label: 'Rates', agent: 'rates_info' },
  { service: 'branch_locator', label: 'Branch locations and hours', agent: 'rates_info' },
  { service: 'lost_card', label: 'Report a lost card', agent: 'greeter' },
];

export const listServices = defineTool({
  name: 'list_services',
  agents: ['greeter'],
  description: 'The services this caller can use right now and which specialist handles each. Before verification it lists public services and marks the rest as needing verification. Use it to offer a short menu, never to promise a service it does not list.',
  access: 'public',
  service: null,
  effect: 'read',
  params: empty(),
  llmFields: ['available', 'needs_verification', 'authenticated'],
  timeoutMs: 1_000,
  legacy: 'p2 main menu; p3/p10 dynamic menus "present the sets of menus dynamically (P, AS & AC)"',
  async handler(ctx) {
    const available: Array<{ service: string; label: string; agent: string }> = [];
    const needsVerification: string[] = [];
    for (const item of MENU) {
      const e = entitlement(ctx.session, item.service, ctx.policy);
      if (e.ok) available.push(item);
      else if (e.reason === 'not_authenticated') needsVerification.push(item.label);
    }
    return ok({ available, needs_verification: needsVerification, authenticated: ctx.session.auth.kind === 'authenticated' });
  },
});

export const requestCallback = defineTool({
  name: 'request_callback',
  agents: ['greeter', 'rates_info'],
  description: 'Ask a Service Manager to call the caller back (for example outside office hours). Uses the number the caller is calling from unless they give another (5 to 15 digits). Only one request per number per day.',
  access: 'public',
  service: 'callback',
  effect: 'session',
  params: object({ phone_number: digits({ min: 5, max: 15 }, 'A different number to call back, if the caller gives one.', { identifier: true }), reason: string({ maxLength: 200, description: 'What the caller needs, in a few words.' }) }, ['reason']),
  llmFields: ['created', 'number_ending', 'message'],
  timeoutMs: 4_000,
  legacy: 'p39 Call Back Mgr: caller ID or a different number (min 5, max 15), duplicate check',
  async handler(ctx, args) {
    const number = args.phone_number ?? ctx.session.callerId?.replace(/\D/g, '') ?? null;
    if (!number) return declined('need_number', 'Ask for a number to call back on.', 'ask_again');
    const result = await ctx.ports.content.insertCallback({ number, callerId: ctx.session.callerId, reason: args.reason, date: localParts(ctx.now).date }, ctx.signal);
    if (result.result === 'duplicate') {
      return ok({ created: false, number_ending: maskTail(number), message: 'A callback to this number has already been requested. A Service Manager will return the call as soon as possible.' });
    }
    return ok({ created: true, number_ending: maskTail(number), message: 'Our Service Manager will return your call as soon as possible.' });
  },
});

export const prepareAgentTransfer = defineTool({
  name: 'prepare_agent_transfer',
  agents: ['greeter', 'rates_info'],
  description: 'Before transferring to a Service Manager: checks office hours and returns the route (skillset) and a context id for the agent\'s screen. If closed, offer request_callback instead. Then use the escalate tool to transfer.',
  access: 'public',
  service: null,
  effect: 'session',
  params: object({
    topic: oneOf(['account_balance', 'incoming_funds', 'recent_activity', 'statement_request', 'pin_change', 'fd_loan', 'cheque_deposit_status', 'cheque_issued_status', 'chequebook_status', 'chequebook_request', 'stop_cheque', 'appointment', 'rates', 'lost_card', 'general', 'investigation', 'trade'] as const),
    reason: string({ maxLength: 200, description: 'Why the caller needs a person, in a few words.' }),
  }, ['topic', 'reason']),
  llmFields: ['within_hours', 'route', 'priority', 'context_id', 'message'],
  stateFields: { transfer_route: '$.route', transfer_context_id: '$.context_id' },
  timeoutMs: 4_000,
  legacy: 'p41 Tsf to SM (CTI data for agent screen pop); red "Note : 0 - Transfer to …" boxes on every page',
  async handler(ctx, args) {
    const route = ROUTES[args.topic];
    const open = await serviceCentreOpen(ctx);
    if (!open && route.priority !== 'high') {
      return ok({ within_hours: false, route: route.skillset, priority: route.priority, context_id: null, message: 'Our Commercial Service Centre is open 8:30am to 6:00pm, Monday to Friday. Offer a callback.' }, 'offer_callback');
    }
    const customerId = ctx.session.auth.kind === 'authenticated' ? ctx.session.auth.customer.customerId : null;
    const srNumber = await ctx.recordServiceRequest({ customerId, type: route.type || 'GENERAL', category: route.category || 'GENERAL ENQUIRY', subCategory: route.subCategory, priority: route.priority, note: args.reason }, `xfer_${ctx.session.id}_${ctx.session.toolCalls}`);
    return ok({ within_hours: open, route: route.skillset, priority: route.priority, context_id: srNumber, message: 'Tell the caller you are transferring them to a Service Manager.' }, 'transfer_now');
  },
});

export const reportLostCard = defineTool({
  name: 'report_lost_card',
  agents: ['greeter'],
  description: 'A caller reports a lost corporate ATM card, an unauthorised withdrawal or an SMS alert concern. Takes the 12-digit account number, logs a high-priority request and returns where to transfer. Always transfer right after.',
  access: 'public',
  service: 'lost_card',
  effect: 'session',
  params: object({ account_number: digits(12, 'The 12-digit business account number.', { identifier: true }) }),
  llmFields: ['route', 'priority', 'context_id', 'message'],
  stateFields: { transfer_route: '$.route', transfer_context_id: '$.context_id' },
  timeoutMs: 6_000,
  legacy: 'p30 Lost Card: office hours → account login → BI high priority; otherwise card operations after-hours line',
  async handler(ctx, args) {
    const open = await serviceCentreOpen(ctx);
    if (!open) {
      return ok({ route: 'card_ops_after_hours', priority: 'high', context_id: null, message: 'Transfer the caller to card operations now.' }, 'transfer_now');
    }
    const id = args.account_number ? await ctx.ports.crm.identifyAccount(args.account_number, ctx.signal) : { found: false, customerId: null };
    const route = ROUTES.lost_card;
    const srNumber = await ctx.recordServiceRequest(
      { customerId: id.customerId, type: route.type, category: route.category, subCategory: route.subCategory, priority: 'high', note: id.found ? 'Lost card reported; account identified' : 'Lost card reported; account not identified' },
      `lost_${ctx.session.id}`,
    );
    // Deck p30: an identification error still transfers, at medium priority.
    return ok({ route: id.found ? 'bi_high_priority' : 'bi_medium_priority', priority: id.found ? 'high' : 'medium', context_id: srNumber, message: 'Transfer the caller to a Service Manager now.' }, 'transfer_now');
  },
});

export const GREETER_TOOLS = [getCallerContext, recordLanguageChoice, listServices, requestCallback, prepareAgentTransfer, reportLostCard];
