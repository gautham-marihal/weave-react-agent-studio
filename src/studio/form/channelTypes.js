// What each kind of channel may carry and offer, so a screen never offers what `/validate` would refuse (FRONTEND_GUIDE 5, "Options that depend on the channel").
// The truth is `GET /channel-types`; `FALLBACK_TYPES` is a copy of that answer (read from the real server on 2026-10-17) for when it cannot be asked.
// Pure: no network, no DOM.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

const WEB_IN = ['audio', 'text', 'image', 'video'];
export const FALLBACK_TYPES = [
  {
    type: 'sip_voice',
    label: 'Phone line (SIP)',
    runs_today: true,
    input: ['audio'],
    output: ['audio'],
    voice: true,
    can_have_keypad: true,
    can_show_forms: false,
    entry_fields: ['dnis', 'sip_trunk', 'dispatch_rule'],
    default_modalities: { input: ['audio'], output: ['audio'] },
    note: 'A phone call carries audio only: no typed text, images or video, and nothing to show a form on. The caller has a keypad.',
  },
  {
    type: 'web_voice',
    label: 'Web voice',
    runs_today: true,
    input: WEB_IN,
    output: ['audio', 'text'],
    voice: true,
    can_have_keypad: false,
    can_show_forms: true,
    entry_fields: ['widget_id', 'allowed_origins'],
    default_modalities: { input: ['audio'], output: ['audio'] },
    note: 'A visitor talks in the browser; typing, an image or the camera can be added; the reply is spoken and also written. There is no keypad.',
  },
  {
    type: 'web_chat',
    label: 'Web chat',
    runs_today: true,
    input: WEB_IN,
    output: ['audio', 'text'],
    voice: true,
    can_have_keypad: false,
    can_show_forms: true,
    entry_fields: ['widget_id', 'allowed_origins'],
    default_modalities: { input: ['text'], output: ['text'] },
    note: 'A chat box in the browser. If the visitor can also talk to it, the channel is web voice, not web chat.',
  },
  {
    type: 'whatsapp',
    label: 'WhatsApp',
    runs_today: false,
    input: ['text', 'image'],
    output: ['text'],
    voice: false,
    can_have_keypad: false,
    can_show_forms: false,
    entry_fields: ['phone_number_id'],
    default_modalities: { input: ['text'], output: ['text'] },
    note: 'Text and pictures. Nothing connects WhatsApp to the runtime yet.',
  },
  {
    type: 'sms',
    label: 'SMS',
    runs_today: false,
    input: ['text'],
    output: ['text'],
    voice: false,
    can_have_keypad: false,
    can_show_forms: false,
    entry_fields: [],
    default_modalities: { input: ['text'], output: ['text'] },
    note: 'Plain text. Nothing connects SMS to the runtime yet.',
  },
  {
    type: 'email',
    label: 'Email',
    runs_today: false,
    input: ['text', 'image'],
    output: ['text'],
    voice: false,
    can_have_keypad: false,
    can_show_forms: false,
    entry_fields: [],
    default_modalities: { input: ['text'], output: ['text'] },
    note: 'Text and attached pictures. Nothing connects email to the runtime yet.',
  },
  {
    type: 'custom',
    label: 'Custom',
    runs_today: true,
    input: WEB_IN,
    output: ['audio', 'text'],
    voice: true,
    can_have_keypad: true,
    can_show_forms: true,
    entry_fields: null,
    default_modalities: { input: ['text'], output: ['text'] },
    note: 'Anything you map yourself with `match` (a connector participant, say). Not restricted.',
  },
];

// The server answers { types: [...], note }; an older or odd answer (a bare list) is read too. A row with no `type` is dropped.
export function normalizeChannelTypes(raw) {
  const rows = list(isObj(raw) ? raw.types : raw);
  return rows
    .filter((r) => isObj(r) && text(r.type))
    .map((r) => ({
      type: text(r.type),
      label: text(r.label) || text(r.type),
      runsToday: r.runs_today !== false,
      // a list the server left out means "not restricted" (null), never "nothing allowed"
      input: Array.isArray(r.input) ? r.input.map(text) : null,
      output: Array.isArray(r.output) ? r.output.map(text) : null,
      voice: r.voice === true,
      canKeypad: r.can_have_keypad === true,
      canForms: r.can_show_forms === true,
      entryFields: r.entry_fields === null ? null : list(r.entry_fields).map(text), // null = any (a custom channel)
      defaultModalities: {
        input: list(r.default_modalities?.input).map(text),
        output: list(r.default_modalities?.output).map(text),
      },
      note: text(r.note),
    }));
}
export const FALLBACK = normalizeChannelTypes(FALLBACK_TYPES);

export const infoOf = (types, type) => list(types).find((t) => t.type === type) || null;

// A channel that carries audio: its kind is a voice one, or its own modalities list audio.
// (the guide: "`voice` is true for the type, or its modalities list audio"). A kind the studio does not know carries audio only if its modalities say so.
export function isVoiceChannel(channel, types) {
  const info = infoOf(types, channel?.type);
  const m = channel?.modalities;
  const carries = list(m?.input).includes('audio') || list(m?.output).includes('audio');
  return carries || info?.voice === true;
}

// What can be ticked for a channel: the kind's own list. null when the kind is not known (anything goes).
export function allowedModalities(types, type, direction) {
  const info = infoOf(types, type);
  return info ? ((direction === 'output' ? info.output : info.input) ?? null) : null;
}

// The entry fields of a kind; null = any (also an unknown kind).
export function entryFieldsFor(types, type) {
  const info = infoOf(types, type);
  return info ? info.entryFields : null;
}

// Does the kind allow a keypad / a form on screen? An unknown kind is not restricted.
export const canKeypad = (types, type) => infoOf(types, type)?.canKeypad ?? true;
export const canForms = (types, type) => infoOf(types, type)?.canForms ?? true;

// ---- the settings only a voice channel has, on a channel's `overrides` (the same shape as at every level) ---------------------------------------------
export const VOICE_ONLY = {
  conversation: ['sounds', 'speech', 'noise_cancellation', 'ivr_detection'],
  models: ['stt', 'tts', 'realtime', 'vad', 'turn_detector'],
};

// The names ("conversation.sounds") of the voice-only settings present in a channel's overrides.
export const findVoiceOnly = (overrides) =>
  Object.entries(VOICE_ONLY).flatMap(([group, keys]) =>
    keys.filter((key) => isObj(overrides?.[group]) && overrides[group][key] !== null && key in overrides[group]).map((key) => `${group}.${key}`),
  );

// A channel's overrides without the voice-only settings: { overrides (undefined when nothing is left), removed: ['conversation.sounds', ...] }.
export function stripVoiceOnly(overrides) {
  if (!isObj(overrides)) return { overrides, removed: [] };
  const next = { ...overrides };
  const removed = [];
  Object.entries(VOICE_ONLY).forEach(([group, keys]) => {
    if (!isObj(next[group])) return;
    const left = { ...next[group] };
    keys.forEach((key) => {
      // `null` is how a component is switched off on a channel (no text-to-speech on a text channel), which is right on a channel with no voice
      if (key in left && left[key] !== null) {
        delete left[key];
        removed.push(`${group}.${key}`);
      }
    });
    if (Object.keys(left).length) next[group] = left;
    else delete next[group];
  });
  return { overrides: Object.keys(next).length ? next : undefined, removed };
}

// For an address into the config, the keys of that object that must not be OFFERED (what is already there stays, with its warning).
// `path` is the address of the object being drawn, for example ['channels', 0, 'overrides', 'conversation'].
export function keysNotOffered(config, types, path) {
  if (path[0] !== 'channels' || typeof path[1] !== 'number' || path[2] !== 'overrides') return [];
  const channel = list(config?.channels)[path[1]];
  if (!channel || isVoiceChannel(channel, types)) return [];
  const where = path[3];
  return path.length === 4 && VOICE_ONLY[where] ? VOICE_ONLY[where] : [];
}

// The choices to draw for a list of options at `path` (a channel's modalities): { allowed, extra } or null when the path is not one.
//   allowed: what the kind may carry; extra: ticked values the kind cannot carry (kept, so they can be seen and removed).
export function modalityChoices(config, types, path, current) {
  if (path[0] !== 'channels' || typeof path[1] !== 'number' || path[2] !== 'modalities' || !['input', 'output'].includes(path[3])) return null;
  const channel = list(config?.channels)[path[1]];
  const allowed = allowedModalities(types, channel?.type, path[3]);
  if (!allowed) return null;
  return { allowed, extra: list(current).filter((v) => !allowed.includes(v)) };
}

// The channel is a web chat that carries audio: the schema calls that a web voice channel (a mislabelled one).
export function mislabelledChat(channel) {
  const m = channel?.modalities;
  return channel?.type === 'web_chat' && (list(m?.input).includes('audio') || list(m?.output).includes('audio'));
}

// What a kind that does not run yet should say in a picker.
export const NOT_RUNNING = 'Not available yet';
export const notRunningYet = (types, type) => infoOf(types, type)?.runsToday === false;

// ---- the browser channels of a bot (what the Test tab offers) -------------------------------------------------------------------------------------------
// From the config: its enabled web chat and web voice channels, in order. A session response's `channels` list is the server's version of the same thing.
export function browserChannels(config) {
  return list(config?.channels)
    .filter((c) => isObj(c) && c.id && (c.type === 'web_chat' || c.type === 'web_voice') && c.enabled !== false)
    .map((c) => ({ id: c.id, type: c.type, input: list(c.modalities?.input), output: list(c.modalities?.output) }));
}

// A setting named the way the form draws it, for sentences (a confirmation lists these).
const PLAIN = {
  'conversation.sounds': 'background and waiting sounds',
  'conversation.speech': 'how the voice reads things',
  'conversation.noise_cancellation': 'noise reduction',
  'conversation.ivr_detection': 'phone-menu detection',
  'models.stt': 'the listening model',
  'models.tts': 'the speaking model',
  'models.realtime': 'the realtime model',
  'models.vad': 'voice detection',
  'models.turn_detector': 'the turn detector',
  modalities: 'what it can hear and say',
  'capabilities.dtmf': 'the keypad switch',
  'capabilities.forms': 'the form switch',
  'inputs.image': 'picture settings',
  'inputs.video': 'camera and screen settings',
  match: 'how callers are matched',
};
export const plainSetting = (key) => PLAIN[key] || (String(key).startsWith('entry.') ? `the ${String(key).slice(6).replace(/_/g, ' ')} field` : String(key));
// "a" or "an" before a word.
export const withArticle = (word) => `${/^[aeiou]/i.test(String(word)) ? 'an' : 'a'} ${word}`;
