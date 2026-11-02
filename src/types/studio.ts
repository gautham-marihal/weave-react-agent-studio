export type Role = 'viewer' | 'editor' | 'admin';
export type EnvironmentName = 'development' | 'staging' | 'production';
/** Channel types the server schema accepts (GET /schema, $defs.channel.type). A phone line is `sip_voice`. */
export type ChannelType = 'web_chat' | 'web_voice' | 'sip_voice' | 'whatsapp' | 'sms' | 'email' | 'custom';
/** How a call's channel is shown in call lists: the server's sip_voice is a phone call. */
export type CallChannel = 'web_chat' | 'web_voice' | 'phone';
export const isWebChannel = (type: ChannelType): type is 'web_chat' | 'web_voice' => type === 'web_chat' || type === 'web_voice';
export type Tone = 'warm' | 'neutral' | 'formal' | 'upbeat';
/** Tool types the server schema accepts ($defs.tool). Ending a call or passing to a person is a builtin tool. */
export type ToolType = 'builtin' | 'task' | 'http' | 'mcp' | 'knowledge' | 'code';
export type VersionBump = 'major' | 'minor' | 'patch';
export type PathSegment = string | number;
export type Path = PathSegment[];
export type StageId = 'overview' | 'build' | 'test' | 'release' | 'monitor' | 'setup';
export type EditorView = 'guided' | 'detailed' | 'canvas' | 'json';

export interface AgentRole {
  id: string;
  name: string;
  instructions?: { role?: string; opening?: string; rules?: string[]; [key: string]: any };
  tools?: string[];
  handoffs?: any[];
  kind?: string;
  /** Knowledge bases (mode "inject") read on every caller turn. */
  knowledge?: string[];
  [key: string]: unknown;
}

export interface ToolDefinition {
  id: string;
  type: ToolType;
  description?: string;
  connection?: string;
  /** For a builtin tool: end_call, transfer_or_callback, send_form, ... */
  builtin?: string;
  [key: string]: unknown;
}

export interface ChannelDefinition {
  id: string;
  type: ChannelType;
  enabled: boolean;
  greeting?: { say?: unknown; allow_interruptions?: boolean; [key: string]: any };
  entry?: any;
  modalities?: any;
  [key: string]: any;
}

export interface LanguageConfig {
  primary?: string;
  speaks?: string[];
  also_understands?: string[];
  auto_detect?: boolean;
}

export interface ModelConfig {
  provider?: string;
  model?: string;
  [key: string]: any;
}

/**
 * A bot config exactly as the server stores it (GET /schema). Every section is optional here because a config read from
 * the server can lack any of them; the editor never fills gaps with invented values. A setting that is not set is the
 * server's default.
 */
export interface AgentConfig {
  schema_version?: string;
  meta?: {
    id?: string;
    name?: string;
    version?: string;
    status?: 'draft' | 'published' | 'archived';
    description?: string;
    [key: string]: any;
  };
  persona?: {
    name?: string;
    company?: string;
    tone?: Tone | string;
    style_rules?: string[];
    shared_rules?: string[];
    disclosures?: { recording_notice?: string };
    [key: string]: any;
  };
  defaults?: {
    language?: LanguageConfig;
    models?: {
      llm?: ModelConfig;
      stt?: ModelConfig;
      tts?: ModelConfig & { voice_id?: string };
      [key: string]: any;
    };
    conversation?: {
      inactivity?: { enabled?: boolean; timeout_s?: number; [key: string]: any };
      turn_handling?: { interruption?: { enabled?: boolean; [key: string]: any }; [key: string]: any };
      [key: string]: any;
    };
    [key: string]: any;
  };
  channels?: ChannelDefinition[];
  agents?: { entry?: string; items?: AgentRole[]; [key: string]: any };
  tools?: ToolDefinition[];
  post_call?: {
    summary?: { enabled?: boolean; prompt?: string; [key: string]: any };
    recording?: { audio?: boolean; transcript?: boolean; retention_days?: number };
    redaction?: { enabled?: boolean; entities?: string[]; patterns?: unknown[]; [key: string]: any };
    analysis?: any[];
    artifacts?: any[];
    [key: string]: any;
  };
  observability?: {
    session_log?: { enabled?: boolean; directory?: string; detail?: string; retention_days?: number };
    [key: string]: any;
  };
  runtime?: {
    engine?: string;
    provider_mode?: 'plugins' | 'inference';
    timezone?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface Issue {
  path: Path | null;
  message: string;
}

export interface UnsupportedFeature {
  feature: string;
  where: string;
  /** "security": a protection that is configured but not enforced yet. Shown prominently. */
  severity?: 'security';
}

export interface ValidationReport {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  secrets_required: string[];
  unsupported: UnsupportedFeature[];
}

export interface Draft {
  bot_id: string;
  revision: number;
  saved_at: string;
  saved_by: string;
  config: AgentConfig;
}

export interface Version {
  version: string;
  published_at: string;
  published_by: string;
  checksum: string;
  /** Loaded for the newest version up front, for older ones when first needed (GET /versions only lists summaries). */
  config?: AgentConfig;
}

export type DeploymentStatus = 'pending' | 'active' | 'failed';

export interface Deployment {
  id: string;
  status: DeploymentStatus;
  environment: EnvironmentName;
  version: string;
  previous_version: string | null;
  deployed_at: string;
  deployed_by: string;
  note: string;
}

export interface Agent {
  id: string;
  name: string;
  starter: string;
  draft: Draft;
  /** Set when the draft could not be read from the server; the draft then holds no real config and must not be edited. */
  loadError?: string;
  /** Newest first. */
  versions: Version[];
  deployments: Deployment[];
}

export type ActivityAction = 'created' | 'saved' | 'published' | 'deployed' | 'rolled_back' | 'restored' | 'exported' | 'imported';

export interface JobNotification {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  type: 'deploy' | 'knowledge' | 'test' | 'system';
  status: 'success' | 'running' | 'failed' | 'warning';
  read: boolean;
  link?: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  who: string;
  action: ActivityAction;
  agentId: string;
  detail: string;
}

export type CallOutcome = 'resolved' | 'handed_over' | 'cut_off' | 'in_progress';

export interface TranscriptLine {
  speaker: 'agent' | 'caller';
  text: string;
  /** Seconds into the call; undefined when the record has no time for this turn. */
  at_s?: number;
}

export interface ToolCallRecord {
  name: string;
  kind: 'tool' | 'api';
  at_s: number;
  status: 'ok' | 'error';
  latency_ms: number;
  detail: string;
}

export interface CallRecord {
  id: string;
  agentId: string;
  channel: CallChannel;
  /** test = a test conversation (the draft); other = run on a version or 'latest' directly (see ref). */
  environment: EnvironmentName | 'test' | 'other';
  /** What the call ran on, as the server recorded it: draft, an environment, a version. */
  ref?: string;
  version: string;
  started_at: string;
  duration_s: number;
  outcome: CallOutcome;
  caller: string;
  summary: string;
  transcript: TranscriptLine[];
  tool_calls: ToolCallRecord[];
  errors: string[];
}

export interface HealthSnapshot {
  calls: number;
  handover_rate: number;
  cutoff_rate: number;
  tool_failures: number;
}

export interface HealthMetric {
  agentId: string;
  environment: EnvironmentName;
  period: 7 | 14 | 30;
  current: HealthSnapshot;
  previous: HealthSnapshot;
  current_version: string;
  previous_version: string;
}