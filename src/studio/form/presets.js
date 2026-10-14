// Starting points for a new channel. A blank channel is invalid (empty modalities, a phone line with no entry), so
// "Add channel" offers these instead: each is a complete, valid channel for one kind of reach.
// Pure data and helpers: no network, no DOM.

import { freshId } from './references.js';

// Which `entry` fields mean something for each channel type. The runtime reads none of them (they describe the route);
// they exist so people reading the config know how a channel is reached.
export const ENTRY_FIELDS = {
  sip_voice: ['dnis', 'sip_trunk', 'dispatch_rule'],
  web_voice: ['widget_id', 'allowed_origins'],
  web_chat: ['widget_id', 'allowed_origins'],
  whatsapp: ['phone_number_id'],
  sms: [],
  email: [],
};
// The part of each list that is plain text, and the part that is a list of websites.
export const ENTRY_LABELS = {
  dnis: ['Phone number', 'The number callers dial, for reference. It doesn’t connect a number.', '+15550100'],
  sip_trunk: ['SIP trunk', 'The trunk the number arrives on, for reference.', 'trunk-main'],
  dispatch_rule: ['Dispatch rule', 'The SIP dispatch rule that routes the call, for reference.', 'my-agent-inbound'],
  widget_id: ['Widget id', 'The id of the chat or voice widget this channel serves.', 'my-agent-widget'],
  allowed_origins: ['Allowed websites', 'The websites the widget may be placed on, for reference.', 'https://example.com'],
  phone_number_id: ['WhatsApp phone number id', 'The WhatsApp Business phone number id, for reference.', '1234567890'],
};

export const CHANNEL_TYPES = ['sip_voice', 'web_voice', 'web_chat', 'whatsapp', 'sms', 'email', 'custom'];
export const TYPE_LABELS = { sip_voice: 'Phone line', web_voice: 'Web voice', web_chat: 'Web chat', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', custom: 'Custom' };

const GREETING_VOICE = 'Hello, thanks for calling. How can I help you today?';
const GREETING_CHAT = 'Hi! How can I help you today?';

export const CHANNEL_PRESETS = [
  { id: 'phone', type: 'sip_voice', label: 'Phone line', note: 'Callers dial a number', base: 'phone' },
  { id: 'web_voice', type: 'web_voice', label: 'Web voice', note: 'Talk to the agent in the browser', base: 'web_voice' },
  { id: 'web_chat', type: 'web_chat', label: 'Web chat', note: 'A chat widget on a website', base: 'web_chat' },
  { id: 'whatsapp', type: 'whatsapp', label: 'WhatsApp', note: 'Messages on WhatsApp', base: 'whatsapp' },
  { id: 'sms', type: 'sms', label: 'SMS', note: 'Text messages', base: 'sms' },
  { id: 'email', type: 'email', label: 'Email', note: 'Email conversations', base: 'email' },
];

// What a channel of this type starts with: modalities, greeting, capabilities. (Greetings and widget ids are the
// things a person is expected to change.)
export function defaultsForType(type, botId) {
  const widget = `${botId || 'agent'}-widget`;
  switch (type) {
    case 'sip_voice': return { entry: {}, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: GREETING_VOICE }, capabilities: { dtmf: true, human_transfer: true } };
    case 'web_voice': return { entry: { widget_id: widget }, modalities: { input: ['audio'], output: ['audio'] }, greeting: { say: GREETING_VOICE }, capabilities: { forms: true } };
    case 'web_chat': return { entry: { widget_id: widget }, modalities: { input: ['text'], output: ['text'] }, greeting: { say: GREETING_CHAT }, capabilities: { forms: true } };
    case 'whatsapp': return { entry: {}, modalities: { input: ['text'], output: ['text'] }, greeting: { say: GREETING_CHAT }, capabilities: { forms: false } };
    case 'sms': case 'email': return { modalities: { input: ['text'], output: ['text'] } };
    default: return { modalities: { input: ['text'], output: ['text'] } };
  }
}

export function buildChannel(presetId, { taken = [], botId = '' } = {}) {
  const preset = CHANNEL_PRESETS.find((item) => item.id === presetId) || CHANNEL_PRESETS[0];
  const start = defaultsForType(preset.type, botId);
  const channel = { id: freshId(taken, preset.base), type: preset.type, enabled: true, ...start };
  return channel;
}

// Changing a channel's type: the type itself, the `entry` fields that don't belong to the new type (dropped), the
// fields the new type needs (added), and modalities / greeting / capabilities only where they were still the old type's
// untouched defaults. `cleared` lists what was dropped so the person can be asked first.
export function changeChannelType(channel, nextType, botId = '') {
  const old = defaultsForType(channel.type, botId);
  const fresh = defaultsForType(nextType, botId);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keep = ENTRY_FIELDS[nextType];
  const entry = { ...(channel.entry || {}) };
  const cleared = [];
  if (keep) Object.keys(entry).forEach((key) => { if (!keep.includes(key)) { if (entry[key] !== '' && !(Array.isArray(entry[key]) && !entry[key].length)) cleared.push(`entry.${key}`); delete entry[key]; } });
  if (nextType === 'web_chat' && !entry.widget_id) entry.widget_id = fresh.entry.widget_id;
  const next = { ...channel, type: nextType };
  if (fresh.entry !== undefined || Object.keys(entry).length) next.entry = entry; else delete next.entry;
  if (nextType === 'sip_voice' && !next.entry) next.entry = {};
  if (same(channel.modalities, old.modalities)) next.modalities = fresh.modalities;
  if (channel.greeting && same(channel.greeting, old.greeting) && fresh.greeting) next.greeting = fresh.greeting;
  if (channel.capabilities && same(channel.capabilities, old.capabilities)) { if (fresh.capabilities) next.capabilities = fresh.capabilities; else delete next.capabilities; }
  if (channel.match && Object.keys(channel.match).length) { cleared.push('match'); delete next.match; } // how participants are matched follows the type
  return { channel: next, cleared };
}

// What a channel's modalities need from the rest of the config, as plain sentences. (The validator says the same, but
// only after the fact and not next to the field.)
export function modalityNotes(channel, config) {
  const models = config?.defaults?.models || {};
  const input = channel?.modalities?.input || [];
  const output = channel?.modalities?.output || [];
  const notes = [];
  if (input.includes('audio') && !models.stt?.provider) notes.push({ level: 'warn', text: 'Audio in needs a speech-to-text model. None is set yet.', fix: 'models' });
  if (output.includes('audio') && !models.tts?.provider) notes.push({ level: 'warn', text: 'Audio out needs a text-to-speech model. None is set yet.', fix: 'models' });
  if ((input.includes('image') || input.includes('video')) && models.llm?.vision !== true) notes.push({ level: 'warn', text: 'Images and video are only understood by a language model with vision. Turn on “vision” for the model.', fix: 'models' });
  if (input.includes('audio') || output.includes('audio')) notes.push({ level: 'info', text: 'Audio channels also use voice detection and the turn-taking settings in Defaults.' });
  return notes;
}
