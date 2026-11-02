import { addDays, localParts, weekdayOf } from '../domain/time.ts';
import type { AppointmentService } from '../ports/ports.ts';
import { empty, integer, isoDate, object, oneOf, string } from '../schema/schema.ts';
import { customerIdOf, type Committer } from './account-tools.ts';
import { declined, defineTool, ok, type ToolContext } from './define.ts';
import { prepareTransaction, PREPARE_FIELDS } from './helpers.ts';

// Deck p19 (multi-branch, foreign worker accounts), p45 (single branch, Velocity training), p47 (cancel),
// p48 (FW ITSR revision). Rules: book at least 2 days ahead; no weekends or public holidays; no cancellation within
// 2 days of the appointment; party size limits per service.

const SERVICE_LABEL: Record<AppointmentService, string> = {
  foreign_worker_account: 'foreign worker account opening',
  velocity_payment_training: 'Velocity payment module training',
  velocity_trade_training: 'Velocity trade module training',
};

const maxParty = (ctx: ToolContext, service: AppointmentService) =>
  service === 'foreign_worker_account' ? ctx.policy.appointments.maxPartyFwa : ctx.policy.appointments.maxPartyTraining;

async function bookable(ctx: ToolContext, date: string): Promise<boolean> {
  const earliest = addDays(localParts(ctx.now).date, ctx.policy.appointments.minDaysAhead);
  const day = weekdayOf(date);
  return date >= earliest && day !== 0 && day !== 6 && !(await ctx.ports.content.isHoliday(date, ctx.signal));
}

const appointmentService = oneOf(['foreign_worker_account', 'velocity_payment_training', 'velocity_trade_training'] as const);

export const findAppointmentSlots = defineTool({
  name: 'find_appointment_slots',
  agents: ['appointments'],
  description: 'Earliest available appointment slots at a branch for a service, from a date onwards (at least 2 days ahead, weekdays only).',
  access: 'entitled',
  service: 'appointment',
  effect: 'read',
  params: object({ service: appointmentService, branch_id: string({ maxLength: 20, pattern: /^[a-z0-9_-]+$/, description: 'branch_id from find_branch.' }), from_date: isoDate('Earliest date the caller wants, YYYY-MM-DD.') }, ['service', 'branch_id']),
  llmFields: ['slots', 'max_party', 'message'],
  timeoutMs: 6_000,
  legacy: 'p19 "CMM Fetch earliest slot available for this branch", p45',
  async handler(ctx, args) {
    const branches = await ctx.ports.content.branches(ctx.signal);
    const branch = branches.find((b) => b.id === args.branch_id);
    if (!branch || !branch.appointmentServices.includes(args.service)) return declined('branch_not_offering', 'That branch does not take appointments for this service.', 'ask_again');
    const earliest = addDays(localParts(ctx.now).date, ctx.policy.appointments.minDaysAhead);
    const from = args.from_date && args.from_date > earliest ? args.from_date : earliest;
    const slots = await ctx.ports.crm.appointmentSlots({ service: args.service, branchId: branch.id, fromDate: from }, ctx.signal);
    const open: typeof slots[number][] = [];
    for (const s of slots) if (s.capacity > 0 && (await bookable(ctx, s.date))) open.push(s);
    if (open.length === 0) return ok({ slots: [], max_party: maxParty(ctx, args.service), message: 'There are no available appointments from that date.' });
    return ok({ slots: open.slice(0, 3).map((s) => ({ slot_id: s.slotId, date: s.date, start: s.start, end: s.end, branch: branch.name })), max_party: maxParty(ctx, args.service) });
  },
});

export const prepareAppointmentBooking = defineTool({
  name: 'prepare_appointment_booking',
  agents: ['appointments'],
  description: 'Prepare a booking for a slot from find_appointment_slots. party_size is the number of accounts to open (foreign worker) or attendees (training). Nothing is booked until confirm_transaction.',
  access: 'entitled',
  service: 'appointment',
  effect: 'prepare',
  params: object({ service: appointmentService, slot_id: string({ maxLength: 40, pattern: /^[A-Za-z0-9_-]+$/ }), branch_id: string({ maxLength: 20, pattern: /^[a-z0-9_-]+$/ }), party_size: integer({ min: 1, max: 6 }) }, ['service', 'slot_id', 'branch_id', 'party_size']),
  llmFields: [...PREPARE_FIELDS],
  timeoutMs: 6_000,
  legacy: 'p19 "Please enter the number of accounts to be opened" (max 6), p45 (max 2 attendees)',
  async handler(ctx, args) {
    const limit = maxParty(ctx, args.service);
    if (args.party_size > limit) return declined('party_too_large', `At most ${limit} per appointment for ${SERVICE_LABEL[args.service]}.`, 'ask_again');
    const customerId = customerIdOf(ctx) as string;
    const existing = await ctx.ports.crm.listAppointments(customerId, ctx.signal);
    const booked = existing.filter((a) => a.service === args.service).reduce((n, a) => n + a.partySize, 0);
    if (booked + args.party_size > limit) return declined('limit_reached', `You already have bookings for ${booked}; the limit is ${limit}.`, 'continue');
    const slots = await ctx.ports.crm.appointmentSlots({ service: args.service, branchId: args.branch_id, fromDate: addDays(localParts(ctx.now).date, ctx.policy.appointments.minDaysAhead) }, ctx.signal);
    const slot = slots.find((s) => s.slotId === args.slot_id);
    if (!slot || slot.capacity < args.party_size || !(await bookable(ctx, slot.date))) return declined('slot_unavailable', 'That slot is no longer available. Find another slot.', 'ask_again');
    return prepareTransaction(ctx, {
      service: 'appointment_book',
      summary: `An appointment for ${SERVICE_LABEL[args.service]} on ${slot.date} from ${slot.start} to ${slot.end}, for ${args.party_size}.`,
      charge: null,
      payload: { slotId: slot.slotId, partySize: args.party_size, customerId },
    });
  },
});

export const commitAppointmentBooking: Committer = async (ctx, txn) => {
  const { slotId, partySize, customerId } = txn.payload as { slotId: string; partySize: number; customerId: string };
  const { bookingId } = await ctx.ports.crm.bookAppointment({ slotId, customerId, partySize }, txn.idempotencyKey, ctx.signal);
  return ok({ done: true, booking_id: bookingId, message: 'Your appointment has been made.' });
};

export const listAppointments = defineTool({
  name: 'list_appointments',
  agents: ['appointments'],
  description: 'The caller\'s booked appointments.',
  access: 'entitled',
  service: 'appointment',
  effect: 'read',
  params: empty(),
  llmFields: ['appointments'],
  timeoutMs: 6_000,
  legacy: 'p19/p47 "Record exists for this CIF?" → "You have made an appointment for <booked>"',
  async handler(ctx) {
    const list = await ctx.ports.crm.listAppointments(customerIdOf(ctx) as string, ctx.signal);
    return ok({ appointments: list.map((a) => ({ booking_id: a.bookingId, service: SERVICE_LABEL[a.service], date: a.date, start: a.start, end: a.end, party_size: a.partySize })) });
  },
});

export const prepareAppointmentCancellation = defineTool({
  name: 'prepare_appointment_cancellation',
  agents: ['appointments'],
  description: 'Prepare cancelling one of the caller\'s appointments. Not allowed within 2 days of the appointment. Nothing changes until confirm_transaction.',
  access: 'entitled',
  service: 'appointment',
  effect: 'prepare',
  params: object({ booking_id: string({ maxLength: 40, pattern: /^[A-Za-z0-9_-]+$/ }) }, ['booking_id']),
  llmFields: [...PREPARE_FIELDS],
  timeoutMs: 6_000,
  legacy: 'p47 Cancel Booked Appointment; prompt 1297 "No cancellation is allowed 2 days before your appointment date"',
  async handler(ctx, args) {
    const customerId = customerIdOf(ctx) as string;
    const booking = (await ctx.ports.crm.listAppointments(customerId, ctx.signal)).find((a) => a.bookingId === args.booking_id);
    if (!booking) return declined('not_found', 'No such appointment for this caller.', 'ask_again');
    if (booking.date < addDays(localParts(ctx.now).date, ctx.policy.appointments.cancelMinDaysAhead)) {
      return declined('too_late', 'No cancellation is allowed within 2 days of the appointment date.', 'offer_transfer');
    }
    return prepareTransaction(ctx, {
      service: 'appointment_cancel',
      summary: `Cancel the ${SERVICE_LABEL[booking.service]} appointment on ${booking.date} from ${booking.start} to ${booking.end}.`,
      charge: null,
      payload: { bookingId: booking.bookingId, customerId },
    });
  },
});

export const commitAppointmentCancellation: Committer = async (ctx, txn) => {
  const { bookingId, customerId } = txn.payload as { bookingId: string; customerId: string };
  await ctx.ports.crm.cancelAppointment(bookingId, customerId, txn.idempotencyKey, ctx.signal);
  return ok({ done: true, message: 'Your appointment has been cancelled.' });
};

export const APPOINTMENT_TOOLS = [findAppointmentSlots, prepareAppointmentBooking, listAppointments, prepareAppointmentCancellation];
