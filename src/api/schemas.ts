import * as z from 'zod/mini';
import type { AgentConfig } from './agentConfig';

// The Agent Builder API's answers, written once in Zod: types.ts is made from these, and client.ts checks each read
// against them, so an unexpected shape is a clear error naming the field. Fields the server adds pass through.

const text = z.string();
const when = z.string(); // an ISO date and time
const path = z.array(z.union([z.string(), z.number()]));
// the agent's configuration: an object (its own schema is checked by POST /validate, not here)
const config = z.custom<AgentConfig>((value) => !!value && typeof value === 'object' && !Array.isArray(value), { message: 'expected an object' });

export const ValidationIssue = z.looseObject({ path: z.nullable(path), message: text });
export const Unsupported = z.looseObject({ feature: text, where: text, severity: z.optional(z.literal('security')) });
// unsupported features and needed secrets read as "none" when missing (an older server sends neither)
export const ValidationReport = z.looseObject({
  valid: z.boolean(),
  errors: z.array(ValidationIssue),
  warnings: z.array(ValidationIssue),
  unsupported: z.optional(z.array(Unsupported)),
  secrets_required: z.optional(z.array(text)),
});

export const BotSummary = z.looseObject({
  id: text,
  // an agent without a name is shown by its id
  name: z.optional(z.nullable(text)),
  draft_revision: z.nullable(z.number()),
  draft_saved_at: z.nullable(when),
  latest_version: z.nullable(text),
  deployed: z.record(text, text),
});
export const BotList = z.array(BotSummary);

export const Draft = z.looseObject({ bot_id: text, revision: z.number(), saved_at: when, saved_by: text, config });
export const SavedDraft = z.looseObject({ draft: Draft, validation: ValidationReport });

export const VersionSummary = z.looseObject({ version: text, published_at: when, published_by: text, checksum: text });
export const VersionList = z.array(VersionSummary);
export const Version = z.extend(VersionSummary, { bot_id: text, config });
export const Published = z.extend(VersionSummary, { bot_id: text, warnings: z.array(ValidationIssue), secrets_required: z.array(text) });

export const DiffChange = z.looseObject({ op: z.enum(['add', 'remove', 'change']), path, before: z.optional(z.unknown()), after: z.optional(z.unknown()) });
export const Diff = z.looseObject({ from: text, to: text, changes: z.array(DiffChange) });

export const DeploymentStatus = z.enum(['active', 'pending', 'failed']);
export const Deployment = z.looseObject({
  id: text,
  status: DeploymentStatus,
  environment: text,
  version: text,
  previous_version: z.nullable(text),
  deployed_at: when,
  deployed_by: text,
  note: z.nullable(text),
});
export const Preflight = z.looseObject({ secrets_required: z.array(text), secrets_missing: z.array(text), unsupported: z.array(Unsupported) });
export const DeployResult = z.looseObject({ deployment: Deployment, preflight: Preflight });
export const Deployments = z.looseObject({
  current: z.record(text, z.looseObject({ id: text, version: text, deployed_at: when, deployed_by: text })),
  history: z.array(Deployment),
});
export const DeploymentAnswer = z.union([DeployResult, Deployment]);

const Stage = z.enum(['stt', 'llm', 'tts', 'realtime', 'vad']);
export const Provider = z.looseObject({
  name: text,
  stages: z.array(Stage),
  installed: z.boolean(),
  realtime_runnable: z.optional(z.boolean()),
  plugin: z.optional(text),
  default_secret: z.optional(z.nullable(text)),
  key_available: z.optional(z.boolean()),
});
export const ProvidersAnswer = z.looseObject({
  providers: z.array(Provider),
  stages: z.record(text, text),
  turn_detectors: z.array(text),
  note: z.optional(text),
});

export const SessionChannel = z.looseObject({ id: text, type: text, input: z.array(text), output: z.array(text) });
export const Session = z.looseObject({
  livekit_url: text,
  token: text,
  room: text,
  identity: text,
  expires_in_s: z.number(),
  bot: text,
  ref: text,
  version: text,
  channel: SessionChannel,
  channels: z.optional(z.array(SessionChannel)),
});

const count = z.optional(z.nullable(z.number()));
export const CallSummary = z.looseObject({
  id: text,
  bot: z.optional(text),
  started_at: when,
  ended_at: z.optional(z.nullable(when)),
  status: text,
  duration_s: count,
  caller_turns: count,
  handoffs: count,
  channel: z.optional(z.nullable(z.looseObject({ id: z.optional(text), type: z.optional(text) }))),
  version: z.optional(z.nullable(text)),
  ref: z.optional(z.nullable(text)),
});
export const CallPage = z.looseObject({ calls: z.array(CallSummary), next: z.nullable(text) });
export const CallRecord = z.looseObject({ event: text, t: z.optional(when), seq: z.optional(z.number()), elapsed_s: z.optional(z.number()) });
export const CallRecords = z.looseObject({
  call: z.optional(CallSummary),
  events: z.array(CallRecord),
  // the next page starts after this record; `more`: there is one; `complete`: the call ended and every record is here
  next_after: z.optional(z.nullable(z.number())),
  more: z.optional(z.boolean()),
  complete: z.optional(z.boolean()),
});

export const Health = z.looseObject({ ok: z.boolean() });
export const Environments = z.array(text);
export const JsonSchema = z.record(text, z.unknown());
