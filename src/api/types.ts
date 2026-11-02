// Types for the Agent Builder API
import type { AgentConfig } from '../types/studio';

export type { AgentConfig };

export interface ValidationIssue {
  path: Array<string | number> | null;
  message: string;
}

export interface Unsupported {
  feature: string;
  where: string;
  severity?: 'security';
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  unsupported: Unsupported[];
  secrets_required: string[];
}

export interface BotSummary {
  id: string;
  name: string;
  draft_revision: number | null;
  draft_saved_at: string | null;
  latest_version: string | null;
  deployed: Record<string, string>;
}

export interface Draft {
  bot_id: string;
  revision: number;
  saved_at: string;
  saved_by: string;
  config: AgentConfig;
}

export interface SavedDraft {
  draft: Draft;
  validation: ValidationReport;
}

export interface VersionSummary {
  version: string;
  published_at: string;
  published_by: string;
  checksum: string;
}

export interface Version extends VersionSummary {
  bot_id: string;
  config: AgentConfig;
}

export interface Published extends VersionSummary {
  bot_id: string;
  warnings: ValidationIssue[];
  secrets_required: string[];
}

/** A phone number the phone system knows (GET /numbers). managed: created through this API for a bot. */
export interface PhoneNumber {
  number: string;
  managed: boolean;
  trunk: { id: string; name: string } | null;
  bot: string | null;
  environment: string | null;
  rule: { id: string; name: string; agents: string[][] } | null;
  options: { record_audio: boolean; krisp: boolean; allowed_addresses: string[]; max_call_duration_s: number | null };
  problems: Array<string | { problem: string; fix?: string }>;
}

export interface NumberSettings {
  number_pattern: string;
  environments: string[];
  defaults: { record_audio: boolean; krisp: boolean; allowed_addresses: string[] };
  recording?: { format: string; path: string };
  livekit_configured: boolean;
}

export interface NumberCheck {
  number: string;
  /** free, invalid, taken_external, or taken by a bot */
  status: string;
  owner: { trunk?: string; bot?: string | null; environment?: string | null; agents?: string[][] } | null;
  warnings: string[];
  reason?: string;
}

/** POST /preview/prompt: what the model would be given, built by the server from a config. */
export interface PromptPreview {
  agent: { id: string; name: string; kind?: string; is_entry?: boolean };
  channel: { id: string; type: string; modality?: string } | null;
  instructions: string;
  sections: Array<{ kind: string; label: string; text: string; active: boolean; when?: string }>;
  opening?: string | null;
  greeting?: string | null;
  tools: Array<{ id?: string; name: string; type?: string; description?: string; offered: boolean; reason?: string | null }>;
  stats: { words: number; characters?: number; approx_tokens: number; tools_offered: number };
  warnings: Array<string | ValidationIssue>;
}

export interface DiffChange {
  op: 'add' | 'remove' | 'change';
  path: Array<string | number>;
  before?: unknown;
  after?: unknown;
}

export interface Diff {
  from: string;
  to: string;
  changes: DiffChange[];
}

export type DeploymentStatus = 'active' | 'pending' | 'failed';

export interface Deployment {
  id: string;
  status: DeploymentStatus;
  environment: string;
  version: string;
  previous_version: string | null;
  deployed_at: string;
  deployed_by: string;
  note: string | null;
}

export interface Preflight {
  secrets_required: string[];
  secrets_missing: string[];
  unsupported: Unsupported[];
  knowledge?: unknown;
}

export interface DeployResult {
  deployment: Deployment;
  preflight: Preflight;
}

export interface Deployments {
  current: Record<string, { id: string; version: string; deployed_at: string; deployed_by: string }>;
  history: Deployment[];
}

export type ProviderStage = 'stt' | 'llm' | 'tts' | 'realtime' | 'vad';

export interface Provider {
  name: string;
  stages: ProviderStage[];
  installed: boolean;
  realtime_runnable?: boolean;
  plugin?: string;
  default_secret?: string | null;
  key_available?: boolean;
}

export interface ProvidersAnswer {
  providers: Provider[];
  stages: Record<string, string>;
  turn_detectors: string[];
  note?: string;
}

export interface ChannelSpec {
  id: string;
  type: string;
  input: string[];
  output: string[];
}

export interface Session {
  livekit_url: string;
  token: string;
  room: string;
  identity: string;
  expires_in_s: number;
  bot: string;
  ref: string;
  version: string;
  channel: ChannelSpec;
  channels?: ChannelSpec[];
}

export interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  raw?: Blob | string | File;
  headers?: Record<string, string>;
}

export interface KnowledgeBase {
  id: string;
  type: string;
  mode: string;
  used_by?: string[] | { agents?: string[]; tools?: string[] };
  sources?: Array<string | { type?: string; file_id?: string; [key: string]: any }>;
  index?: any;
  build?: {
    id: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    progress?: number;
    error?: string;
    log?: string[];
  };
  problems?: string[];
  embedding_key_available?: boolean;
}

export interface KnowledgeFile {
  name: string;
  size: number;
  modified: string;
  used_by: string[];
}

export interface KnowledgeStatus {
  index: unknown;
  build: {
    id: string;
    status: 'pending' | 'running' | 'done' | 'failed';
    log?: string[];
  };
  problems: string[];
}

export interface KnowledgeSearchResult {
  hits: Array<{
    text: string;
    source: string;
    score: number;
  }>;
  ms: number;
  the_model_is_shown?: string;
}

export interface CallSummaryItem {
  id: string;
  room: string;
  bot?: string;
  ref?: string;
  channel: string | { id?: string; type?: string };
  caller: string;
  dialled?: string | null;
  started_at: string;
  status: 'ended' | 'in_progress' | 'unfinished';
  duration_s: number;
  caller_turns?: number;
  agent_turns?: number;
  handoffs?: number;
  version: string;
}

export interface CallsResponse {
  calls: CallSummaryItem[];
  next: string | null;
}

export interface CallDetailTurn {
  role: 'agent' | 'caller' | 'system' | 'user' | 'assistant';
  text: string;
  at?: number;
  elapsed_s?: number;
}

export interface CallTranscriptResponse {
  call: CallSummaryItem;
  turns: CallDetailTurn[];
}



/** One test scenario as GET /bots/{id}/tests lists it. The scenarios themselves live in the draft's config. */
export interface Scenario {
  id: string;
  description: string | null;
  channel: string;
  /** "live" needs a real model (costs money); others run scripted. */
  mode: string;
  /** How many caller turns it has. */
  turns: number;
  expectations: string[];
  mocks: number;
  last_result: { status: string; run_id?: string; finished_at?: string } | null;
}

/** A test run (GET /tests/runs, GET /tests/runs/{id}). The list leaves out per-scenario details. */
export interface TestRun {
  run_id: string;
  bot?: string;
  ref?: string;
  version?: string;
  config_checksum?: string;
  options?: { live?: boolean; allow_network?: boolean };
  status: 'running' | 'passed' | 'failed' | 'error' | 'skipped';
  started_at: string;
  finished_at?: string | null;
  total?: number;
  counts?: { passed?: number; failed?: number; error?: number; skipped?: number };
  error?: string | null;
  scenarios?: Array<{
    id: string;
    status: 'passed' | 'failed' | 'skipped' | 'error';
    duration_s?: number;
    notes?: string[];
    error?: string | null;
  }>;
}
