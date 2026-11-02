// What each kind of channel may carry and offer, so a screen never offers what POST /validate refuses. GET /channel-types
// is the only source: when it cannot be read, nothing is narrowed (a kind the studio does not know is not restricted)
// and the page says the list could not be read. Pure: no network, no DOM.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** One kind of channel as the server describes it. A list that is null means "not restricted". */
export interface ChannelKind {
  type: string;
  label: string;
  runsToday: boolean;
  input: string[] | null;
  output: string[] | null;
  voice: boolean;
  canKeypad: boolean;
  canForms: boolean;
  /** null: any entry field (a custom channel). */
  entryFields: string[] | null;
  defaultModalities: { input: string[]; output: string[] };
  note: string;
}

/** The server answers { types: [...], note }; a bare list is read too. A row with no `type` is dropped. */
export function normalizeChannelTypes(raw: unknown): ChannelKind[] {
  const rows = list(isObj(raw) ? raw.types : raw);
  return rows
    .filter((r): r is Json => isObj(r) && !!text(r.type))
    .map((r) => {
      const defaults = isObj(r.default_modalities) ? r.default_modalities : {};
      return {
        type: text(r.type),
        label: text(r.label) || text(r.type),
        runsToday: r.runs_today !== false,
        // a list the server left out means "not restricted" (null), never "nothing allowed"
        input: Array.isArray(r.input) ? r.input.map(text) : null,
        output: Array.isArray(r.output) ? r.output.map(text) : null,
        voice: r.voice === true,
        canKeypad: r.can_have_keypad === true,
        canForms: r.can_show_forms === true,
        entryFields: r.entry_fields === null ? null : list(r.entry_fields).map(text),
        defaultModalities: { input: list(defaults.input).map(text), output: list(defaults.output).map(text) },
        note: text(r.note),
      };
    });
}

export type Kinds = ChannelKind[] | null | undefined;

export const infoOf = (types: Kinds, type: unknown): ChannelKind | null => list<ChannelKind>(types).find((t) => t.type === type) ?? null;

interface ChannelLike {
  type?: unknown;
  modalities?: { input?: unknown; output?: unknown } | null;
  [key: string]: unknown;
}

/** Carries audio when its kind is a voice one or its own modalities list audio. An unknown kind only by its modalities. */
export function isVoiceChannel(channel: ChannelLike | null | undefined, types: Kinds): boolean {
  const info = infoOf(types, channel?.type);
  const m = channel?.modalities;
  const carries = list(m?.input).includes('audio') || list(m?.output).includes('audio');
  return carries || info?.voice === true;
}

/** What can be ticked for a channel: the kind's own list; null when the kind is not known (anything goes). */
export function allowedModalities(types: Kinds, type: unknown, direction: 'input' | 'output'): string[] | null {
  const info = infoOf(types, type);
  return info ? ((direction === 'output' ? info.output : info.input) ?? null) : null;
}

/** The entry fields of a kind; null = any (also an unknown kind). */
export function entryFieldsFor(types: Kinds, type: unknown): string[] | null {
  const info = infoOf(types, type);
  return info ? info.entryFields : null;
}

/** Does the kind allow a keypad / a form on screen? An unknown kind is not restricted. */
export const canKeypad = (types: Kinds, type: unknown): boolean => infoOf(types, type)?.canKeypad ?? true;
export const canForms = (types: Kinds, type: unknown): boolean => infoOf(types, type)?.canForms ?? true;

/** Settings only a voice channel has, in a channel's `overrides`. */
export const VOICE_ONLY: Record<string, string[]> = {
  conversation: ['sounds', 'speech', 'noise_cancellation', 'ivr_detection'],
  models: ['stt', 'tts', 'realtime', 'vad', 'turn_detector'],
};

/** The names ("conversation.sounds") of the voice-only settings present in a channel's overrides. */
export const findVoiceOnly = (overrides: unknown): string[] =>
  Object.entries(VOICE_ONLY).flatMap(([group, keys]) => {
    const part = isObj(overrides) ? overrides[group] : undefined;
    return isObj(part) ? keys.filter((key) => key in part && part[key] !== null).map((key) => `${group}.${key}`) : [];
  });

/** A channel's overrides without the voice-only settings (null switches a component off and stays). */
export function stripVoiceOnly(overrides: unknown): { overrides: Json | undefined; removed: string[] } {
  if (!isObj(overrides)) return { overrides: undefined, removed: [] };
  const next: Json = { ...overrides };
  const removed: string[] = [];
  Object.entries(VOICE_ONLY).forEach(([group, keys]) => {
    const part = next[group];
    if (!isObj(part)) return;
    const left: Json = { ...part };
    keys.forEach((key) => {
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

/** Keys of the object at `path` (a channel's overrides group) that must not be offered on a channel with no voice. */
export function keysNotOffered(config: unknown, types: Kinds, path: (string | number)[]): string[] {
  if (path[0] !== 'channels' || typeof path[1] !== 'number' || path[2] !== 'overrides') return [];
  const channel = list<ChannelLike>((config as { channels?: unknown } | null)?.channels)[path[1]];
  if (!channel || isVoiceChannel(channel, types)) return [];
  const where = String(path[3]);
  return path.length === 4 && VOICE_ONLY[where] ? VOICE_ONLY[where] : [];
}

/** Choices for a channel's modalities: what the kind may carry, and ticked values it cannot (kept, to be removed). */
export function modalityChoices(config: unknown, types: Kinds, path: (string | number)[], current: unknown): { allowed: string[]; extra: string[] } | null {
  if (path[0] !== 'channels' || typeof path[1] !== 'number' || path[2] !== 'modalities' || (path[3] !== 'input' && path[3] !== 'output')) return null;
  const channel = list<ChannelLike>((config as { channels?: unknown } | null)?.channels)[path[1]];
  const allowed = allowedModalities(types, channel?.type, path[3]);
  if (!allowed) return null;
  return { allowed, extra: list<string>(current).filter((v) => !allowed.includes(v)) };
}

/** A web chat that carries audio: the schema calls that a web voice channel. */
export function mislabelledChat(channel: ChannelLike | null | undefined): boolean {
  const m = channel?.modalities;
  return channel?.type === 'web_chat' && (list(m?.input).includes('audio') || list(m?.output).includes('audio'));
}

/** What a kind that does not run yet says. */
export const NOT_RUNNING = 'Not available yet';
export const notRunningYet = (types: Kinds, type: unknown): boolean => infoOf(types, type)?.runsToday === false;

/** The config's enabled web chat and web voice channels, in order (what a browser can try). */
export function browserChannels(config: unknown): { id: string; type: string; input: string[]; output: string[] }[] {
  return list<ChannelLike>((config as { channels?: unknown } | null)?.channels)
    .filter((c) => isObj(c) && !!c.id && (c.type === 'web_chat' || c.type === 'web_voice') && c.enabled !== false)
    .map((c) => ({ id: String(c.id), type: String(c.type), input: list<string>(c.modalities?.input), output: list<string>(c.modalities?.output) }));
}

const PLAIN: Record<string, string> = {
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
/** A setting in words, for sentences (a confirmation lists these). */
export const plainSetting = (key: string): string =>
  PLAIN[key] || (String(key).startsWith('entry.') ? `the ${String(key).slice(6).replace(/_/g, ' ')} field` : String(key));
/** "a" or "an" before a word. */
export const withArticle = (word: string): string => `${/^[aeiou]/i.test(String(word)) ? 'an' : 'a'} ${word}`;
