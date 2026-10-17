// The shapes the Agent Builder API sends and takes, as JSDoc types, so an editor can check a field name or a missing property. They
// follow the API's FRONTEND_GUIDE (and builder_api/README.md). Nothing here runs: the file only holds type definitions.
//
// AgentConfig is generated from the schema (npm run types) into agentConfig.d.ts.

/** @typedef {import('./agentConfig').AgentConfig} AgentConfig */

/** One problem the validator found. `path` is the list of keys and indexes to the field; null or [] means it applies to the whole config.
 * @typedef {{ path: Array<string | number> | null, message: string }} ValidationIssue */

/** Something the runtime can't do yet. `severity: "security"` means a protection is declared but not enforced.
 * @typedef {{ feature: string, where: string, severity?: 'security' }} Unsupported */

/** The answer of POST /validate, and `validation` in a saved draft.
 * @typedef {{ valid: boolean, errors: ValidationIssue[], warnings: ValidationIssue[], unsupported: Unsupported[], secrets_required: string[] }} ValidationReport */

/** One agent in GET /bots.
 * @typedef {{ id: string, name: string, draft_revision: number | null, draft_saved_at: string | null, latest_version: string | null, deployed: Record<string, string> }} BotSummary */

/** The working copy of an agent (GET /bots/{id}/draft, and the answer to creating one).
 * @typedef {{ bot_id: string, revision: number, saved_at: string, saved_by: string, config: AgentConfig }} Draft */

/** @typedef {{ draft: Draft, validation: ValidationReport }} SavedDraft */

/** @typedef {{ version: string, published_at: string, published_by: string, checksum: string }} VersionSummary */
/** @typedef {VersionSummary & { bot_id: string, config: AgentConfig }} Version */
/** @typedef {VersionSummary & { bot_id: string, warnings: ValidationIssue[], secrets_required: string[] }} Published */

/** @typedef {{ op: 'add' | 'remove' | 'change', path: Array<string | number>, before?: unknown, after?: unknown }} DiffChange */
/** @typedef {{ from: string, to: string, changes: DiffChange[] }} Diff */

/** @typedef {'active' | 'pending' | 'failed'} DeploymentStatus */
/** @typedef {{ id: string, status: DeploymentStatus, environment: string, version: string, previous_version: string | null, deployed_at: string, deployed_by: string, note: string }} Deployment */
/** @typedef {{ secrets_required: string[], secrets_missing: string[], unsupported: Unsupported[] }} Preflight */
/** @typedef {{ deployment: Deployment, preflight: Preflight }} DeployResult */
/** @typedef {{ current: Record<string, { id: string, version: string, deployed_at: string, deployed_by: string }>, history: Deployment[] }} Deployments */

/** A model provider the runtime can run (GET /providers).
 * @typedef {{ name: string, stages: Array<'stt' | 'llm' | 'tts' | 'realtime' | 'vad'>, installed: boolean, realtime_runnable?: boolean, plugin?: string, default_secret?: string | null, key_available?: boolean }} Provider */
/** @typedef {{ providers: Provider[], stages: Record<string, string>, turn_detectors: string[], note?: string }} ProvidersAnswer */

/** What a browser needs to join a test conversation (POST /bots/{id}/sessions).
 * @typedef {{ livekit_url: string, token: string, room: string, identity: string, expires_in_s: number, bot: string, ref: string, version: string, channel: { id: string, type: string, input: string[], output: string[] }, channels?: { id: string, type: string, input: string[], output: string[] }[] }} Session */

/** @typedef {{ signal?: AbortSignal }} RequestOptions */

export {};
