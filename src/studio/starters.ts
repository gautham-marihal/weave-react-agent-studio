// Starting points for a new agent. The server creates every agent with the same minimal draft, so without these
// two agents begin identical. A starter fills in what makes an agent its own: how it talks, what it says first,
// what it is told to do, how it says goodbye, what it does when the caller goes quiet, and (for voice) the recording
// notice. Everything is ordinary configuration the person can edit.

import type { AgentConfig } from '../api/types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a draft is edited as plain JSON here; the result is still an AgentConfig
type Loose = any;

export type Starter = {
  id: string;
  label: string;
  blurb: string;
  person?: boolean;
  tone?: string;
  styleRules?: string[];
  greeting?: (name: string) => string;
  role?: string;
  opening?: string;
  goodbye?: string;
  tags?: string[];
};

export const STARTERS: Starter[] = [
  {
    id: 'blank',
    label: 'Blank',
    blurb: 'A minimal helpful assistant to build from.',
  },
  {
    id: 'support',
    person: true,
    label: 'Customer care',
    blurb: 'Helps with questions and problems, and hands over when it can’t solve them.',
    tone: 'warm, patient, plain language',
    styleRules: ['One question at a time.', 'Say sorry once when something went wrong, then move on to fixing it.'],
    greeting: (name) => `Hi, I’m ${name}. How can I help you today?`,
    role: 'You are a customer care agent. Find out what the customer needs, ask one question at a time and give short, clear answers. If you cannot solve the problem, say so and offer to pass it to a person. Never guess account details. When the customer is finished, say goodbye and end the conversation.',
    opening: 'Greet the customer and ask what they need help with.',
    goodbye: 'Thanks for getting in touch. Take care!',
    tags: ['support'],
  },
  {
    id: 'receptionist',
    person: true,
    label: 'Front desk',
    blurb: 'Greets people, finds out who or what they need and points them the right way.',
    tone: 'polite, quick, professional',
    styleRules: ['Keep every reply to one or two short sentences.'],
    greeting: (name) => `Welcome, this is ${name} at the front desk. Who or what can I help you find?`,
    role: 'You are the front desk. Greet everyone, find out who they want to reach or what they need, and point them the right way in one or two short sentences. If you do not know the answer, say you will find out rather than guessing. When they are finished, say goodbye and end the conversation.',
    opening: 'Greet the visitor and ask who or what they are looking for.',
    goodbye: 'Thank you, have a good day.',
    tags: ['front-desk'],
  },
  {
    id: 'knowledge',
    person: true,
    label: 'Knowledge guide',
    blurb: 'Answers only from the information you give it, and says so when it doesn’t know.',
    tone: 'clear, factual, helpful',
    styleRules: ['Quote figures and dates exactly as written.', 'Never make anything up.'],
    greeting: (name) => `Hello, I’m ${name}. Ask me anything and I’ll answer from what I know.`,
    role: 'You answer questions using only the information in these instructions. Add the facts you should answer from below this paragraph. If the answer is not there, say you do not know and suggest contacting a person. Keep answers short. Do not make anything up. When the user is finished, say goodbye and end the conversation.',
    opening: 'Say you can answer questions and ask what they would like to know.',
    goodbye: 'Glad I could help. Goodbye!',
    tags: ['knowledge'],
  },
  {
    id: 'lead',
    label: 'Lead concierge',
    blurb: 'Welcomes interested visitors and collects their details for your team.',
    tone: 'friendly, curious, never pushy',
    styleRules: ['Ask for one detail at a time.', 'Never pressure anyone to share more than they want to.'],
    greeting: (name) => `Hi, I’m ${name}. What brings you here today?`,
    role: 'You welcome people who are interested in what the company offers. Find out what they are looking for, then politely collect their name, email address and phone number, one at a time. Repeat the details back before you finish. When done, thank them, say the team will be in touch, and end the conversation.',
    opening: 'Welcome the visitor and ask what they are looking for.',
    goodbye: 'Thank you! Our team will be in touch soon.',
    tags: ['sales', 'leads'],
  },
  {
    id: 'appointment',
    person: true,
    label: 'Booking concierge',
    blurb: 'Takes booking requests: the service, a day and time, and contact details.',
    tone: 'calm, organised, reassuring',
    styleRules: ['Ask one question at a time.', 'Say dates and times the way a person would.'],
    greeting: (name) => `Hello, this is ${name}. Would you like to book an appointment?`,
    role: 'You take appointment requests. Ask which service they want, then the day and time that suit them, then their name and a contact number, one question at a time. Repeat the booking back and ask them to confirm. Say that a person will confirm the slot, and never promise a time you cannot check. When done, say goodbye and end the conversation.',
    opening: 'Offer to book an appointment and ask which service they need.',
    goodbye: 'Your request is noted. We’ll confirm your booking shortly. Goodbye!',
    tags: ['booking'],
  },
  {
    id: 'feedback',
    label: 'Feedback collector',
    blurb: 'Asks for a rating and a short comment, then thanks the person.',
    tone: 'appreciative, brief, neutral',
    styleRules: ['Never argue or defend. Thank the person for every answer.'],
    greeting: (name) => `Hi, I’m ${name}. Could you spare a minute to tell us how we did?`,
    role: 'You collect feedback after a service. Ask for a rating from one to five, then ask what went well or badly in one short question. Thank the person for every answer, never argue or defend, and keep it under a minute. When done, thank them and end the conversation.',
    opening: 'Ask if they have a minute to rate their experience from one to five.',
    goodbye: 'Thank you for your feedback. It really helps!',
    tags: ['feedback'],
  },
];

export const starterById = (id: string | null | undefined): Starter => STARTERS.find((starter) => starter.id === id) || STARTERS[0];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const GOODBYE_ID = 'goodbye';

// Lines the starters add to the messages catalogue (each starter replaces its own by id, so applying twice doesn't repeat).
const INACTIVITY_MESSAGES = [
  { id: 'still_there', text: 'Are you still there?' },
  { id: 'still_there_final', text: 'I’m still here whenever you’re ready. Is there anything else I can help with?' },
  {
    id: 'inactivity_goodbye',
    text: 'I haven’t heard from you, so I’ll end the conversation now. Please get in touch again any time.',
    allow_interruptions: false,
  },
];
export const CALLBACK_MESSAGE = {
  id: 'callback_line',
  text: 'I’m sorry, I can’t put you through to a person from here right now. Please get in touch with us again a little later.',
};
const TRANSFER_ID = 'human_support';
const ESCALATE_ID = 'escalate_to_human';

// A silent caller otherwise keeps the line open for ever: nudge twice, then say goodbye and end.
export const INACTIVITY = {
  enabled: true,
  timeout_s: 10,
  max_nudges: 2,
  nudges: [
    { type: 'say', text: { message: 'still_there' } },
    { type: 'say', text: { message: 'still_there_final' } },
  ],
  on_exhausted: { do: [{ type: 'end_call', say: { message: 'inactivity_goodbye' } }] },
};

// Does any channel that is switched on carry voice? (then a recording notice is the usual courtesy)
export const usesVoice = (config: Loose): boolean =>
  (Array.isArray(config?.channels) ? config.channels : []).some(
    (channel: Loose) =>
      channel &&
      channel.enabled !== false &&
      (['sip_voice', 'web_voice'].includes(channel.type) ||
        ['input', 'output'].some((side) => Array.isArray(channel.modalities?.[side]) && channel.modalities[side].includes('audio'))),
  );

const upsertById = (list: unknown, entries: { id: string }[]): Loose[] => [
  ...(Array.isArray(list) ? list : []).filter((item: Loose) => !entries.some((entry) => entry.id === item?.id)),
  ...entries,
];

// Returns a new configuration with the starter's content written into it. The agent's own name, id and version
// are left alone. A blank starter returns the configuration unchanged.
export function applyStarter<C extends AgentConfig | Loose>(config: C, starterId: string): C {
  const starter = starterById(starterId);
  if (!config || starter.id === 'blank') return config;
  const next: Loose = clone(config);
  const name = next.persona?.name || next.meta?.name || 'your assistant';

  next.meta = { ...(next.meta || {}), description: starter.blurb, tags: [...new Set([...(next.meta?.tags || []), ...(starter.tags || [])])] };
  next.persona = { ...(next.persona || {}), tone: starter.tone, style_rules: [...(starter.styleRules || [])] };
  if (usesVoice(next) && !next.persona.disclosures?.recording_notice) {
    next.persona.disclosures = { ...(next.persona.disclosures || {}), recording_notice: 'This call may be recorded to improve our service.' };
  }

  (next.channels || []).forEach((channel: Loose) => {
    if (channel && channel.greeting && typeof channel.greeting.say === 'string' && starter.greeting) channel.greeting.say = starter.greeting(name);
  });

  // How the agent says goodbye: a message, and the built-in end_call tool that plays it.
  const messages: Loose[] = [{ id: GOODBYE_ID, text: starter.goodbye }];
  const tools: Loose[] = Array.isArray(next.tools) ? next.tools.filter((t: Loose) => t?.id !== 'end_call') : [];
  tools.push({
    id: 'end_call',
    type: 'builtin',
    builtin: 'end_call',
    description: 'Ends the conversation. Use it after saying goodbye, when the person has nothing more to ask.',
    params: { say: { message: GOODBYE_ID } },
  });
  const offered = ['end_call'];

  // A silent caller is nudged, then the call ends. A configuration that already handles it is left alone.
  const conversation = next.defaults?.conversation;
  if (!conversation?.inactivity) {
    next.defaults = { ...(next.defaults || {}), conversation: { ...(conversation || {}), inactivity: clone(INACTIVITY) } };
    messages.push(...INACTIVITY_MESSAGES);
  }

  next.messages = upsertById(next.messages, messages);
  next.tools = tools;

  const items = next.agents?.items;
  if (Array.isArray(items) && items.length) {
    const entry = items.find((agent: Loose) => agent.id === next.agents.entry) || items[0];
    entry.instructions = { ...(entry.instructions || {}), role: starter.role, opening: starter.opening };
    entry.tools = [...new Set([...(entry.tools || []), ...offered])];
  }
  return starter.person ? addPersonHandoff(next) : next;
}

// "Put me through to a person": a tool the agent can offer, a transfer for it to use and the line the caller hears when no one can take
// the call. No number is known yet, so the transfer has none and the fallback line is what callers hear until one is set under Telephony.
// Anything already there is left alone, so applying it twice changes nothing.
//   id: the tool's id, when the usual one is taken by a tool of another kind
export function addPersonHandoff<C extends AgentConfig | Loose>(config: C, { id = ESCALATE_ID }: { id?: string } = {}): C {
  if (!config) return config;
  const next: Loose = clone(config);
  const tools: Loose[] = Array.isArray(next.tools) ? next.tools : [];
  const messages: Loose[] = [];
  if (!tools.some((t) => t?.id === id)) {
    // a callback line already there (its wording changed, or other languages added) is kept
    if (!(Array.isArray(next.messages) && next.messages.some((m: Loose) => m?.id === CALLBACK_MESSAGE.id))) messages.push(CALLBACK_MESSAGE);
    tools.push({
      id,
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'Use when the caller asks for a person, or you cannot help them.',
      params: { transfer: TRANSFER_ID, fallback: [{ type: 'say', text: { message: CALLBACK_MESSAGE.id } }] },
    });
  }
  next.tools = tools;
  const telephony = next.telephony || {};
  if (!(Array.isArray(telephony.transfers) && telephony.transfers.some((t: Loose) => t?.id === TRANSFER_ID))) {
    next.telephony = {
      ...telephony,
      transfers: [
        ...(telephony.transfers || []),
        {
          id: TRANSFER_ID,
          description: 'A person to take over. Add the number to transfer to; until then the callers hear the fallback line.',
          method: 'sip_refer',
          target: '',
        },
      ],
    };
  }
  if (messages.length) next.messages = upsertById(next.messages, messages);
  const items = next.agents?.items;
  if (Array.isArray(items) && items.length) {
    const entry = items.find((agent: Loose) => agent.id === next.agents.entry) || items[0];
    entry.tools = [...new Set([...(entry.tools || []), id])];
  }
  return next;
}
