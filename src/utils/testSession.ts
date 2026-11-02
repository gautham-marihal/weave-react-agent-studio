// Plain words for what can go wrong in a Test tab conversation, and the live trace read from the call's records.
// Pure, so every message is tested without a browser or a LiveKit room.

import type { ApiErrorKind } from '../api/client';
import type { TraceEvent } from '../types/testConsole';

export type TraceItem = Omit<TraceEvent, 'id' | 'at_ms'>;

/** What the person sees, and the technical detail that goes to the trace only. */
export interface Explained {
  message: string;
  detail: string;
}

export const AGENT_DID_NOT_JOIN =
  'The agent did not join the room. The runtime worker may not be running or cannot reach LiveKit.';
export const MIC_NEEDS_SECURE_CONTEXT =
  'Microphone needs HTTPS or localhost. Open Studio over https:// (or on localhost) to talk by voice.';

// --- Room disconnects ------------------------------------------------------------------------------------------------

// LiveKit's DisconnectReason numbers (@livekit/protocol). Kept as numbers so this file does not load livekit-client.
const DISCONNECT_REASONS: Record<number, { name: string; text: string; error: boolean }> = {
  0: { name: 'UNKNOWN_REASON', text: 'The conversation closed without a reason from LiveKit.', error: true },
  1: { name: 'CLIENT_INITIATED', text: 'You left the conversation.', error: false },
  2: {
    name: 'DUPLICATE_IDENTITY',
    text: 'The same test identity joined from somewhere else (another tab or window), so this conversation was closed.',
    error: true,
  },
  3: { name: 'SERVER_SHUTDOWN', text: 'The LiveKit server restarted and closed the conversation.', error: true },
  4: { name: 'PARTICIPANT_REMOVED', text: 'The server removed you from the conversation.', error: false },
  5: { name: 'ROOM_DELETED', text: 'The agent ended the conversation.', error: false },
  6: { name: 'STATE_MISMATCH', text: 'The connection got out of step with the LiveKit server and was closed.', error: true },
  7: {
    name: 'JOIN_FAILURE',
    text: 'Could not finish joining the room. A firewall, VPN or proxy may be blocking LiveKit.',
    error: true,
  },
  8: { name: 'MIGRATION', text: 'The conversation was moved to another LiveKit server and could not continue.', error: true },
  9: { name: 'SIGNAL_CLOSE', text: 'The connection to LiveKit was lost.', error: true },
  10: { name: 'ROOM_CLOSED', text: 'The agent ended the conversation.', error: false },
  11: { name: 'USER_UNAVAILABLE', text: 'The person being called was not available.', error: false },
  12: { name: 'USER_REJECTED', text: 'The person being called declined.', error: false },
  13: { name: 'SIP_TRUNK_FAILURE', text: 'The phone line failed.', error: true },
  14: { name: 'CONNECTION_TIMEOUT', text: 'The connection to LiveKit timed out.', error: true },
  15: {
    name: 'MEDIA_FAILURE',
    text: 'Audio could not get through between your browser and LiveKit. A firewall or VPN may be blocking it.',
    error: true,
  },
  16: { name: 'AGENT_ERROR', text: 'The agent ran into an error and left the conversation.', error: true },
};

/** A LiveKit disconnect reason in plain words; `error` says whether to offer Try again rather than a normal end. */
export function disconnectReasonText(reason: number | undefined): { name: string; text: string; error: boolean } {
  return DISCONNECT_REASONS[reason ?? 0] ?? { name: `REASON_${reason}`, text: 'The conversation closed unexpectedly.', error: true };
}

// --- Starting a session ----------------------------------------------------------------------------------------------

interface ApiErrorLike {
  status: number;
  kind: ApiErrorKind;
  message: string;
  errors?: { message: string }[];
}

function isApiErrorLike(err: unknown): err is ApiErrorLike {
  return typeof err === 'object' && err !== null && typeof (err as ApiErrorLike).status === 'number' && typeof (err as ApiErrorLike).kind === 'string';
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : typeof err === 'string' ? err : '');

/**
 * POST /bots/{id}/sessions failed: what to tell the person, and what the trace keeps. `ref` is what was asked for
 * (the draft, "latest", a version or an environment), so a 404 can say which.
 */
export function sessionStartError(err: unknown, ref = 'draft'): Explained {
  if (!isApiErrorLike(err)) {
    const raw = messageOf(err);
    return { message: 'The test conversation could not start.', detail: raw || 'Unknown error' };
  }
  const where = `POST /sessions → ${err.status || 'no response'}`;
  switch (err.kind) {
    case 'unavailable':
      return {
        message:
          'This server is not set up for test conversations: it has no LiveKit connection. Ask whoever runs the Agent Builder server to connect LiveKit, then try again.',
        detail: `${where}: ${err.message}. The server needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.`,
      };
    case 'invalid': {
      const issues = (err.errors ?? []).map((e) => e.message).filter(Boolean);
      // A channel not offered to browsers: the server's message lists the ones that are, so it is shown as it is.
      if (!issues.length && /offer/i.test(err.message) && /channel/i.test(err.message))
        return { message: `That channel can’t be tried in a browser: ${err.message}`, detail: `${where}: ${err.message}` };
      const shown = issues.length ? issues.slice(0, 3).join(' · ') + (issues.length > 3 ? ` (and ${issues.length - 3} more)` : '') : err.message;
      return {
        message: `The server can’t run this draft yet: ${shown}`,
        detail: `${where}: ${[err.message, ...issues].join(' | ')}`,
      };
    }
    case 'client_bug':
      return { message: 'Studio sent a request the server did not accept. This is a Studio bug, not a problem with your agent.', detail: `${where}: ${err.message}` };
    case 'not_found':
      if (ref && ref !== 'draft')
        return {
          message:
            ref === 'latest'
              ? 'This agent has no published version to talk to yet. Publish one, or talk to the saved draft.'
              : `Nothing is live in “${ref}” yet. Put a version live there first, or talk to the saved draft.`,
          detail: `${where}: ${err.message}`,
        };
      return {
        message: 'The server has no saved draft for this agent. It may have been deleted. Reload the page and try again.',
        detail: `${where}: ${err.message}`,
      };
    case 'auth':
      return {
        message: 'The server refused Studio’s credentials, so the test can’t start. Ask an admin to check the API key Studio uses.',
        detail: `${where}: ${err.message}`,
      };
    case 'network':
      return err.status
        ? { message: `The Agent Builder server is not responding (HTTP ${err.status}). Try again in a moment.`, detail: `${where}: ${err.message}` }
        : { message: 'Could not reach the Agent Builder server. Check your connection and try again.', detail: `${where}: ${err.message}` };
    default:
      return { message: `The server could not start the test (HTTP ${err.status}): ${err.message}`, detail: `${where}: ${err.message}` };
  }
}

// livekit-client's ConnectionErrorReason numbers.
const NOT_ALLOWED = 0;
const SERVER_UNREACHABLE = 1;
const CANCELLED = 3;
const TIMEOUT = 5;

/** room.connect failed after the server handed out a token. */
export function roomConnectError(err: unknown): Explained {
  const reason = typeof err === 'object' && err !== null ? (err as { reason?: unknown }).reason : undefined;
  const raw = messageOf(err) || 'Unknown error';
  const detail = `LiveKit connect failed${typeof reason === 'number' ? ` (reason ${reason})` : ''}: ${raw}`;
  if (reason === NOT_ALLOWED) {
    return { message: 'LiveKit refused the join token. The server’s LiveKit key may not belong to this LiveKit project.', detail };
  }
  if (reason === SERVER_UNREACHABLE || reason === TIMEOUT) {
    return { message: 'Could not reach the LiveKit server. A firewall, VPN or proxy may be blocking it. Try another network, then try again.', detail };
  }
  if (reason === CANCELLED) return { message: 'Joining the room was cancelled.', detail };
  return { message: 'Could not join the LiveKit room. Try again in a moment.', detail };
}

/** Turning the microphone on failed (getUserMedia's error names, and LiveKit's MediaDeviceFailure names). */
export function micErrorMessage(err: unknown): string {
  const name = typeof err === 'object' && err !== null ? String((err as { name?: unknown }).name ?? '') : '';
  const text = messageOf(err);
  if (/NotAllowed|PermissionDenied|SecurityError/i.test(name) || /permission/i.test(text)) {
    return 'Microphone access is blocked. Allow the microphone for this site in your browser (the icon in the address bar), then press Try again.';
  }
  if (/NotFound|DevicesNotFound/i.test(name)) return 'No microphone was found. Connect one, then press Try again.';
  if (/NotReadable|DeviceInUse|TrackStart|AbortError/i.test(name)) {
    return 'The microphone is busy or not working. Close other apps that use it, then press Try again.';
  }
  return `The microphone could not be turned on${text ? `: ${text}` : '.'}`;
}

// --- Voice readiness -------------------------------------------------------------------------------------------------

export type ModelStage = 'stt' | 'tts' | 'llm';

const STAGE_NAMES: Record<ModelStage, string> = { stt: 'Speech-to-text', tts: 'Text-to-speech', llm: 'Language model' };

export interface StageCheck {
  status: 'pass' | 'fail' | 'warning';
  detail: string;
  fix?: string;
}

/** Whether the draft's model for one stage can run here: a provider and model are set, installed, and keyed. */
export function modelStageCheck(
  stage: ModelStage,
  model: { provider?: string; model?: string } | undefined,
  providers: { name: string; stages: string[]; installed: boolean; key_available?: boolean; default_secret?: string | null }[]
): StageCheck {
  const what = STAGE_NAMES[stage];
  const provider = model?.provider?.trim();
  if (!provider) return { status: 'fail', detail: `No ${what.toLowerCase()} provider is set.`, fix: `Choose a ${what.toLowerCase()} provider and model in Build.` };
  const name = model?.model?.trim();
  const found = providers.find((p) => p.name === provider);
  if (!found || !found.installed) {
    return { status: 'fail', detail: `${what}: “${provider}” is not installed on this server.`, fix: 'Pick a provider the server has, or ask the server admin to install it.' };
  }
  if (Array.isArray(found.stages) && !found.stages.includes(stage)) {
    return { status: 'fail', detail: `${what}: “${provider}” does not offer ${what.toLowerCase()}.`, fix: 'Pick another provider in Build.' };
  }
  if (!name) return { status: 'fail', detail: `${what}: no model is set for “${provider}”.`, fix: `Choose a ${what.toLowerCase()} model in Build.` };
  if (found.key_available === false) {
    return {
      status: 'fail',
      detail: `${what}: the server has no API key for “${provider}”.`,
      fix: found.default_secret ? `Ask the server admin to set ${found.default_secret}.` : 'Ask the server admin to add the provider key.',
    };
  }
  if (found.key_available === undefined) return { status: 'warning', detail: `${what}: ${provider} · ${name}. The server did not say whether its key is set.` };
  return { status: 'pass', detail: `${what}: ${provider} · ${name}, key set on the server.` };
}

// --- Participants ----------------------------------------------------------------------------------------------------

/** The runtime worker joins as a LiveKit agent participant; with no kind to go on, any other participant counts. */
export function isAgentParticipant(p: { kind?: unknown; isAgent?: unknown }, agentKind: number): boolean {
  if (typeof p.isAgent === 'boolean') return p.isAgent;
  if (p.kind === undefined || p.kind === null) return true;
  return p.kind === agentKind;
}

// --- Live trace ------------------------------------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

function compact(value: unknown, max = 200): string {
  if (value === undefined || value === null || value === '') return '';
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const join = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(' · ');

/**
 * One record from GET /bots/{id}/calls/{room}/stream as a trace line. Records name their type in `event`
 * (user_said, agent_said, tool_called, …); `kind` is read only when `event` is missing. Null = nothing to show.
 */
export function traceFromRecord(record: unknown): TraceItem | null {
  if (typeof record !== 'object' || record === null) return null;
  const r = record as Record<string, unknown>;
  const type = str(r.event) || str(r.kind);
  if (!type) return null;

  switch (type) {
    case 'user_said':
      return { kind: 'session', label: 'Caller said', detail: str(r.text), status: 'info' };
    case 'agent_said':
      return { kind: 'agent', label: r.interrupted ? 'Agent said (interrupted)' : 'Agent said', detail: str(r.text), status: 'info' };
    case 'tool_called': {
      const failed = r.error === true || (typeof r.error === 'string' && r.error !== '');
      return {
        kind: 'tool',
        label: str(r.tool) || str(r.name) || 'Tool',
        detail: join(
          `args ${compact(r.arguments ?? r.args ?? {}, 160)}`,
          (r.output ?? r.result) !== undefined && `result ${compact(r.output ?? r.result, 200) || '(empty)'}`,
          typeof r.duration_ms === 'number' && `${r.duration_ms} ms`,
          typeof r.error === 'string' && r.error
        ),
        status: failed ? 'error' : 'ok',
      };
    }
    case 'http_request':
      return {
        kind: 'tool',
        label: join(str(r.method), str(r.path) || str(r.url)) || 'HTTP request',
        detail: join(r.status !== undefined && `status ${str(r.status)}`, typeof r.ms === 'number' && `${r.ms} ms`, str(r.connection), str(r.error)),
        status: r.ok === false || (typeof r.status === 'number' && r.status >= 400) ? 'error' : 'ok',
      };
    case 'knowledge_search': {
      const results = Array.isArray(r.results) ? r.results : Array.isArray(r.hits) ? r.hits : null;
      return {
        kind: 'tool',
        label: `Knowledge search${str(r.base) || str(r.knowledge_base) ? ` · ${str(r.base) || str(r.knowledge_base)}` : ''}`,
        detail: join(str(r.query) && `“${str(r.query)}”`, results && `${results.length} results`, typeof r.ms === 'number' && `${r.ms} ms`),
        status: r.error ? 'error' : 'ok',
      };
    }
    case 'state_changed':
      return { kind: 'agent', label: `${str(r.variable) || 'State'} changed`, detail: `${compact(r.previous) || '(empty)'} → ${compact(r.value) || '(empty)'}`, status: 'info' };
    case 'handoff':
      return { kind: 'handoff', label: `Handed over to ${str(r.to) || 'another agent'}`, detail: join(str(r.from) && `from ${str(r.from)}`, str(r.reason)), status: 'info' };
    case 'agent_entered':
      return r.first === false
        ? { kind: 'handoff', label: `Now talking: ${str(r.agent)}`, status: 'info' }
        : { kind: 'agent', label: `Agent ${str(r.agent)} started`, status: 'ok' };
    case 'model_request':
      return {
        kind: 'llm',
        label: `Model request${str(r.model) ? ` · ${str(r.model)}` : ''}`,
        detail: join(typeof r.messages === 'number' && `${r.messages} messages`, Array.isArray(r.tools) && `${r.tools.length} tools`, str(r.agent)),
        status: 'info',
      };
    case 'guardrail_triggered':
      return { kind: 'agent', label: `Guardrail: ${str(r.rule) || 'rule'}`, detail: join(str(r.action), Array.isArray(r.kinds) && r.kinds.join(', ')), status: 'info' };
    case 'task_started':
    case 'task_step':
    case 'task_finished':
      return {
        kind: 'agent',
        label: `${type === 'task_started' ? 'Task started' : type === 'task_finished' ? 'Task finished' : 'Task step'}: ${str(r.task)}`,
        detail: join(str(r.step), str(r.status), str(r.outcome)),
        status: r.status === 'failed' ? 'error' : 'info',
      };
    case 'error':
      return { kind: 'error', label: 'Error', detail: str(r.message) || str(r.error) || compact(withoutHousekeeping(r)), status: 'error' };
    case 'end_call':
      return { kind: 'end', label: 'Agent ended the call', detail: r.said_goodbye ? 'Said goodbye first' : undefined, status: 'info' };
    case 'session_closed':
      return { kind: 'end', label: 'Session closed', detail: join(str(r.reason), r.error ? compact(r.error) : ''), status: r.error ? 'error' : 'info' };
    case 'call_started':
      return { kind: 'session', label: 'Call log started', detail: join(str(r.version) && `version ${str(r.version)}`, str(r.caller)), status: 'info' };
    case 'call_ended':
      return {
        kind: 'end',
        label: 'Call ended',
        detail: join(typeof r.duration_s === 'number' && `${r.duration_s}s`, typeof r.agent_turns === 'number' && `${r.agent_turns} agent turns`),
        status: 'info',
      };
    case 'config_log':
      return { kind: 'agent', label: 'Runtime log', detail: str(r.message), status: r.level === 'error' ? 'error' : 'info' };
    case 'artifact':
      return null;
    default:
      return { kind: 'agent', label: type.replace(/_/g, ' '), detail: compact(withoutHousekeeping(r)), status: 'info' };
  }
}

function withoutHousekeeping(r: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...r };
  delete rest.t;
  delete rest.seq;
  delete rest.elapsed_s;
  delete rest.event;
  return rest;
}

// --- What a browser can try ------------------------------------------------------------------------------------------

type ChannelLike = { id?: unknown; type?: unknown; enabled?: unknown; input?: unknown };
const WEB_TYPES = ['web_chat', 'web_voice'];
const channelsOf = (config: unknown): ChannelLike[] => {
  const channels = (config as { channels?: unknown } | null | undefined)?.channels;
  return Array.isArray(channels) ? channels.filter((c): c is ChannelLike => !!c && typeof c === 'object') : [];
};

export interface Testability {
  /** 'none': no web channel (the server refuses a session); 'off': web channels all switched off; 'unknown': not loaded. */
  state: 'none' | 'off' | 'ok' | 'unknown';
  /** Phone channels by id: a phone line is tried by calling its number. */
  phone: string[];
}

/** Whether a browser can talk to this configuration: only web chat and web voice can be tried here. */
export function testability(config: unknown): Testability {
  if (!config) return { state: 'unknown', phone: [] };
  const all = channelsOf(config);
  const web = all.filter((c) => WEB_TYPES.includes(String(c.type ?? '')));
  const phone = all
    .filter((c) => c.type === 'sip_voice')
    .map((c) => c.id)
    .filter((id): id is string => typeof id === 'string' && !!id);
  if (!web.length) return { state: 'none', phone };
  if (!web.some((c) => c.enabled !== false)) return { state: 'off', phone };
  return { state: 'ok', phone };
}

/** What a session's channel carries (the server's answer `{ type, input, output }`): pictures, and a camera or screen. */
export interface ChannelInputs {
  image: boolean;
  video: boolean;
}
export function channelInputs(channel: { input?: unknown } | null | undefined): ChannelInputs {
  const input = Array.isArray(channel?.input) ? channel.input : [];
  return { image: input.includes('image'), video: input.includes('video') };
}

/** A picture checked against what the channel accepts ('' when it may be sent). */
export function pictureProblem(file: { size: number; type: string }, limits: { acceptedMime?: string[]; maxBytes?: number }): string {
  const mb = (n: number) => (n / 1048576).toFixed(1);
  if (limits.maxBytes && file.size > limits.maxBytes) return `That picture is ${mb(file.size)} MB; this channel allows ${mb(limits.maxBytes)} MB.`;
  const accepted = limits.acceptedMime ?? [];
  if (accepted.length && !accepted.includes(file.type)) return `This channel accepts ${accepted.join(', ')}; that file is ${file.type || 'an unknown type'}.`;
  return '';
}

// --- What a conversation showed, for making a scenario from it -------------------------------------------------------

/** The tools the agent used in a call's records, in order, by the name the model knows them by. */
export function toolsUsedIn(records: unknown[]): string[] {
  return records
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && (r as Record<string, unknown>).event === 'tool_called')
    .map((r) => str(r.tool) || str(r.name))
    .filter(Boolean);
}

/** The state at the end of a call: each `state_changed` record's latest value. */
export function finalStateOf(records: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  records.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const rec = r as Record<string, unknown>;
    if (rec.event === 'state_changed' && typeof rec.variable === 'string') out[rec.variable] = rec.value;
  });
  return out;
}
