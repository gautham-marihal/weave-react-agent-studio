// Caller identity (`identity.caller_id`): where the agent reads who is calling (a participant attribute such as the SIP
// phone number, the participant's identity with parts stripped, or a fixed value), tried in order, and how the number is
// written (as dialled, or in international E.164 form with a default country). Pure: no React, no network.
import type { AgentConfig } from '../types/studio';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export type CallerSource =
  | { from: 'participant_attribute'; name: string }
  | { from: 'participant_identity'; strip?: string[] }
  | { from: 'static'; value: string; description?: string };
export type SourceKind = CallerSource['from'];
export type Normalize = { type: 'none' } | { type: 'e164'; default_country: string };

export const SOURCE_KINDS: { from: SourceKind; label: string; help: string }[] = [
  { from: 'participant_attribute', label: 'A detail the call carries', help: 'Read from the caller’s connection, such as sip.phoneNumber on a phone call.' },
  { from: 'participant_identity', label: 'The caller’s identity', help: 'The connection’s own identity, with the parts you list taken out (patterns).' },
  { from: 'static', label: 'A fixed value', help: 'The same value every time, for a line used by one person or for trying things out.' },
];

/** A new source of its kind, as the schema needs it (the attribute starts as the phone number of a SIP call). */
export function newSource(from: SourceKind): CallerSource {
  if (from === 'participant_attribute') return { from, name: 'sip.phoneNumber' };
  if (from === 'participant_identity') return { from, strip: ['^sip[:_]', '@.*$'] };
  return { from, value: '' };
}

export interface CallerId {
  on: boolean;
  sources: CallerSource[];
  normalize: Normalize | null;
}

export function callerIdOf(config: AgentConfig): CallerId {
  const c = isObj(config?.identity) && isObj((config.identity as Json).caller_id) ? ((config.identity as Json).caller_id as Json) : null;
  const n = c && isObj(c.normalize) ? (c.normalize as Json) : null;
  return {
    on: !!c,
    sources: list<CallerSource>(c?.sources).filter((s) => isObj(s) && typeof s.from === 'string'),
    normalize: n?.type === 'e164' ? { type: 'e164', default_country: typeof n.default_country === 'string' ? n.default_country : '' } : n?.type === 'none' ? { type: 'none' } : null,
  };
}

/** Writes identity.caller_id (null takes it away, and identity with it when nothing else is there). */
export function setCallerId(config: AgentConfig, value: { sources: CallerSource[]; normalize: Normalize | null } | null): AgentConfig {
  const next = clone(config);
  const identity: Json = { ...(isObj(next.identity) ? (next.identity as Json) : {}) };
  if (!value) delete identity.caller_id;
  else {
    const callerId: Json = { sources: clone(value.sources) };
    if (value.normalize) callerId.normalize = clone(value.normalize);
    identity.caller_id = callerId;
  }
  if (Object.keys(identity).length) next.identity = identity;
  else delete next.identity;
  return next;
}

/** Switched on, it starts as a phone call reads its caller: the SIP number, else the identity without "sip:" and the domain. */
export const startCallerId = (): { sources: CallerSource[]; normalize: Normalize | null } => ({
  sources: [newSource('participant_attribute'), newSource('participant_identity')],
  normalize: null,
});

/** One source in words. */
export function sourceWords(source: CallerSource): string {
  if (source.from === 'participant_attribute') return source.name ? `the call’s “${source.name}”` : 'a detail of the call (none named yet)';
  if (source.from === 'participant_identity') return list(source.strip).length ? `the caller’s identity, without ${list<string>(source.strip).map((s) => `“${s}”`).join(' and ')}` : 'the caller’s identity';
  return source.value ? `the fixed value “${source.value}”` : 'a fixed value (none typed yet)';
}

/** The whole setting in a sentence. */
export function callerIdWords(c: CallerId): string {
  if (!c.on) return 'Not set: the server’s default.';
  if (!c.sources.length) return 'No source yet: it needs at least one.';
  const first = `It reads who is calling from ${c.sources.map(sourceWords).join(', else ')}`;
  const norm = c.normalize?.type === 'e164' ? `, written in international form${c.normalize.default_country ? ` (numbers without a country code are taken as ${c.normalize.default_country})` : ''}` : '';
  return `${first}${norm}.`;
}

/** Problems as typed (the server says the same on Save). */
export function callerIdProblems(c: CallerId): string[] {
  if (!c.on) return [];
  const out: string[] = [];
  if (!c.sources.length) out.push('It needs at least one place to read the caller from.');
  c.sources.forEach((s, i) => {
    const n = c.sources.length > 1 ? ` ${i + 1}` : '';
    if (s.from === 'participant_attribute' && !s.name.trim()) out.push(`Source${n} needs the name of the detail.`);
    if (s.from === 'static' && !s.value.trim()) out.push(`Source${n} needs a value.`);
    if (s.from === 'participant_identity')
      list<string>(s.strip).forEach((p) => {
        try {
          new RegExp(p);
        } catch {
          out.push(`Source${n}: “${p}” is not a pattern that can be read.`);
        }
      });
  });
  if (c.normalize?.type === 'e164' && !/^[A-Z]{2}$/.test(c.normalize.default_country)) out.push('The default country is two capital letters, such as US or GB.');
  return out;
}
