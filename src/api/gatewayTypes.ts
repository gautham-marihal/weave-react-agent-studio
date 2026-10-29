// Types for the banking gateway's HTTP API (services/banking-gateway). The gateway is a separate package, so these
// mirror its contract: src/channel/views.ts, src/session/events.ts, src/tools/registry.ts, src/executor/respond.ts.

export type HostMode = 'mock' | 'live';

export type NextStep =
  | 'continue'
  | 'retry'
  | 'ask_again'
  | 'wait_for_secure_entry'
  | 'start_authentication'
  | 'confirm_or_cancel'
  | 'offer_transfer'
  | 'offer_callback'
  | 'transfer_now'
  | 'end_call';

export type LockReason = 'too_many_failures' | 'host_locked' | 'otp_suspended' | 'dormant_account' | 'personal_customer' | 'unauthorised_usage';
export type AuthState = 'not_started' | 'awaiting_pin' | 'awaiting_nric' | 'awaiting_otp' | 'authenticated' | 'locked';
export type CapturePurpose = 'pin' | 'nric' | 'otp' | 'current_pin' | 'new_pin' | 'confirm_new_pin';
export type AuthMethodId = 'phonecode_pin' | 'account_nric_otp';

export interface SecureEntryView {
  purpose: CapturePurpose;
  label: string;
  min_digits: number;
  max_digits: number;
  expires_at: number;
}

export interface AuthView {
  state: AuthState;
  authenticated: boolean;
  method: AuthMethodId | null;
  attempts_remaining: number;
  max_attempts: number;
  lock_reason: LockReason | null;
  otp_resends_left: number | null;
  next: NextStep;
  message: string;
  secure_entry: SecureEntryView | null;
}

export interface AuthMethodView {
  id: AuthMethodId;
  label: string;
  summary: string;
  identifier: { field: 'phone_code' | 'account_number'; label: string; digits: number; reveal_allowed: boolean; help: string };
  secure_steps: Array<{ purpose: 'pin' | 'nric' | 'otp'; label: string; help: string }>;
  available: boolean;
  unavailable_reason: string | null;
  legacy: string;
}

export interface HelpEntry {
  id: string;
  question: string;
  answer: string | null;
  fallback: string;
  source: 'legacy_deck' | 'product' | 'unknown';
  reference: string;
  approved: boolean;
}

export interface AccountView {
  account_ref: string;
  type: string;
  ending: string;
  currencies: string[];
}

export interface ProfileView {
  business_name_masked: string;
  customer_ref_ending: string;
  method: AuthMethodId;
  role: 'AS' | 'AC' | null;
  accounts: AccountView[];
  language: 'en' | 'zh';
}

export interface Money {
  minor: number;
  currency: string;
}

export interface ConfirmationView {
  confirmation_id: string;
  service: string;
  summary: string;
  charge: Money | null;
  expires_at: number;
  state: 'pending' | 'executing';
}

export interface ChannelState {
  hosts: HostMode;
  policy_approved: boolean;
  channel: 'sip_voice' | 'web_voice' | 'web_chat' | 'custom';
  auth: AuthView;
  methods: AuthMethodView[];
  profile: ProfileView | null;
  services: { available: string[]; needs_verification: string[] };
  confirmation: ConfirmationView | null;
  help: Record<string, HelpEntry>;
}

/** A tool result as the model sees it (flat; ok:false carries error_code / error_message / next). */
export type ToolResponse = { ok: boolean; error_code?: string; error_message?: string; next?: NextStep } & Record<string, unknown>;

export interface ChannelActionResult {
  result: ToolResponse;
  state: ChannelState;
}

/** The keypad request as the gateway sends it. The token is a one-time capability: keep it out of React state. */
export interface CaptureRequest {
  token: string;
  purpose: CapturePurpose;
  label: string;
  minDigits: number;
  maxDigits: number;
  expiresAt: number;
}

export interface CaptureOutcome {
  accepted: boolean;
  message: string;
}

export type ConfirmationOutcome = 'confirmed' | 'cancelled' | 'expired' | 'failed' | 'unknown';

export type ChannelEvent =
  | { type: 'capture_requested'; at: number; capture: CaptureRequest }
  | { type: 'capture_result'; at: number; purpose: string; accepted: boolean; message: string; auth: AuthView }
  | { type: 'auth_changed'; at: number; auth: AuthView }
  | { type: 'confirmation_requested'; at: number; confirmationId: string; summary: string; expiresAt: number }
  | { type: 'confirmation_processing'; at: number; confirmationId: string }
  | { type: 'confirmation_closed'; at: number; confirmationId: string; outcome: ConfirmationOutcome; message?: string; reference?: string };

export type TimelineEvent =
  | { type: 'tool'; at: number; tool: string; outcome: 'ok' | 'refused' | 'failed'; ms: number; code?: string; origin: 'runtime' | 'channel' }
  | { type: 'auth'; at: number; state: string; failures: number }
  | { type: 'transaction'; at: number; service: string; state: 'pending' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'expired' }
  | { type: 'session'; at: number; state: 'started' | 'ended' };

export interface ManifestTool {
  name: string;
  agents: string[];
  description: string;
  access: 'public' | 'auth_flow' | 'authenticated' | 'entitled';
  service: string | null;
  effect: 'read' | 'prepare' | 'commit' | 'session';
  parameters: {
    type: 'object';
    properties: Record<string, { type?: string; description?: string; pattern?: string; minLength?: number; maxLength?: number; enum?: string[] }>;
    required?: string[];
  };
  returns: string[];
  timeout_ms: number;
  legacy: string;
}

export interface GeneratedAgentConfig {
  tools: Array<{ id: string; type: string; connection?: string; description?: string } & Record<string, unknown>>;
  connections: Record<string, Record<string, unknown>>;
  events: Array<{ on: string; do: Array<Record<string, unknown>> }>;
  state: { variables: Record<string, Record<string, unknown>> };
  agentTools: Record<string, string[]>;
  requiredConstants: string[];
  runtimeDependencies: Array<{ placeholder: string; used_in: string; needed_for: string }>;
}

export interface GatewayHealth {
  ok: boolean;
  policy_approved: boolean;
  hosts?: HostMode;
}

/** A documented mock test login (mock gateway only, mock/fixtures.ts). */
export interface TestLogin {
  id: string;
  label: string;
  method: AuthMethodId;
  identifier: string;
  secret: string;
  otp: boolean;
  exercises: string;
}

/** The verified rehearsal customer's accounts in full (mock gateway only). */
export interface AccountDetails {
  display_name: string;
  customer_id: string;
  segment: string;
  role: 'AS' | 'AC' | null;
  accounts: Array<{ account_ref: string; number: string; type: string; currencies: string[]; dormant: boolean; omnibus: boolean }>;
}

export interface Rehearsal {
  call_id: string;
  room: string;
  channel: 'web_chat' | 'web_voice';
  channel_token: string;
  expires_in_s: number;
  hosts: HostMode;
}
