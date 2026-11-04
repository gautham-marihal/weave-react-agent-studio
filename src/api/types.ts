// The shapes the Agent Builder API sends and takes, for the type checker. Made from schemas.ts, so what is checked and
// what is typed never drift apart. Types only; AgentConfig is generated into agentConfig.d.ts (npm run types).

import type * as z from 'zod/mini';
import type * as S from './schemas.ts';
import type { AgentConfig } from './agentConfig';

export type { AgentConfig };

/** One problem the validator found. `path` leads to the field; null or [] means the whole config. */
export type ValidationIssue = z.infer<typeof S.ValidationIssue>;

/** Something the runtime can't do yet. `severity: "security"` means a protection is declared but not enforced. */
export type Unsupported = z.infer<typeof S.Unsupported>;

/** The answer of POST /validate, and `validation` in a saved draft. */
export type ValidationReport = z.infer<typeof S.ValidationReport>;

/** One agent in GET /bots. */
export type BotSummary = z.infer<typeof S.BotSummary>;

/** The working copy of an agent (GET /bots/{id}/draft, and the answer to creating one). */
export type Draft = z.infer<typeof S.Draft>;
export type SavedDraft = z.infer<typeof S.SavedDraft>;

export type VersionSummary = z.infer<typeof S.VersionSummary>;
export type Version = z.infer<typeof S.Version>;
export type Published = z.infer<typeof S.Published>;

export type Diff = z.infer<typeof S.Diff>;

export type Deployment = z.infer<typeof S.Deployment>;
export type DeployResult = z.infer<typeof S.DeployResult>;
export type Deployments = z.infer<typeof S.Deployments>;

/** A model provider the runtime can run (GET /providers). */
export type Provider = z.infer<typeof S.Provider>;
export type ProvidersAnswer = z.infer<typeof S.ProvidersAnswer>;

/** What a browser needs to join a test conversation (POST /bots/{id}/sessions). */
export type Session = z.infer<typeof S.Session>;

/** One call in GET /bots/{id}/calls. The list adds `bot` on the client side when it gathers several agents' calls. */
export type CallSummary = z.infer<typeof S.CallSummary>;

/** A page of GET /bots/{id}/calls. */
export type CallPage = z.infer<typeof S.CallPage>;

/** GET /bots/{id}/calls/{call_id}: the call and its records (events), a page at a time. */
export type CallRecords = z.infer<typeof S.CallRecords>;

export type RequestOptions = { signal?: AbortSignal };
