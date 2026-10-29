import { useEffect, useState, type ReactNode } from 'react';
import Icon from '../../ui/Icon.jsx';
import AiOrb from '../preview/AiOrb.jsx';
import type { BrowserVoice } from './useBrowserVoice.ts';
import { cn } from './ui.tsx';

// The banking conversation as a phone call, WhatsApp style: a compact call header (the assistant's avatar, its name,
// what it is doing, how long the call has lasted) above the conversation, and the call's controls in the bottom bar.
// Nothing here takes the place of the conversation: every state is a line in the header and a change in the avatar.
// Every state comes from the voice (useBrowserVoice.ts: microphone, recognition, speech synthesis) and the assistant
// (a gateway tool running, a secure step open), never from a timer.

export type CallState = 'connecting' | 'listening' | 'muted' | 'thinking' | 'working' | 'speaking' | 'auth_required' | 'off' | 'error' | 'ended';

/** What the assistant is doing while a gateway tool runs, in the caller's words. */
const TOOL_PROGRESS: Record<string, string> = {
  get_balance: 'Checking your balance…',
  list_accounts: 'Checking your accounts…',
  get_recent_transactions: 'Looking up your transactions…',
  get_incoming_funds: 'Looking up incoming funds…',
  get_deposited_cheques: 'Checking your deposited cheques…',
  get_issued_cheque_status: 'Checking that cheque…',
  get_chequebook_status: 'Checking your chequebook…',
  prepare_chequebook_request: 'Preparing your chequebook request…',
  prepare_statement_request: 'Preparing your statement request…',
  prepare_stop_cheque: 'Preparing the stop-cheque request…',
  start_pin_change: 'Starting your PIN change…',
  get_fx_rate: 'Checking exchange rates…',
  get_prime_rate: 'Checking the prime rate…',
  get_time_deposit_rates: 'Checking deposit rates…',
  find_branch: 'Finding a branch…',
  list_services: 'Checking what I can help with…',
  request_callback: 'Arranging a call back…',
  prepare_agent_transfer: 'Finding a Service Manager…',
  report_lost_card: 'Reporting the lost card…',
  confirm_transaction: 'Sending your request to the bank…',
  cancel_transaction: 'Cancelling the request…',
  get_caller_context: 'Checking your account…',
};

export const toolProgress = (tool: string | null) => (tool && TOOL_PROGRESS[tool]) || 'Checking with the bank…';

export interface CallSignals {
  voice: BrowserVoice;
  /** The banking session is on (not starting, not ended). */
  live: boolean;
  starting: boolean;
  thinking: boolean;
  activeTool: string | null;
  /** A sign-in step is open: a PIN, NRIC or OTP, or the Phone Code / account number. */
  verifying: boolean;
}

/** One state at a time, the most telling first: speech beats work, work beats a waiting sign-in step. */
export function callStateOf({ voice, live, starting, thinking, activeTool, verifying }: CallSignals): CallState {
  if (!live) return starting || voice.status === 'connecting' ? 'connecting' : 'ended';
  if (voice.status === 'error' || voice.status === 'unsupported') return 'error';
  if (voice.status === 'connecting') return 'connecting';
  if (!voice.active) return 'off';
  if (voice.status === 'speaking') return 'speaking';
  if (thinking || voice.status === 'processing') return activeTool ? 'working' : 'thinking';
  if (verifying) return 'auth_required';
  return voice.muted ? 'muted' : 'listening';
}

const STATE_LABEL: Record<Exclude<CallState, 'working'>, string> = {
  connecting: 'Connecting…',
  listening: 'Listening…',
  muted: 'Muted · unmute to speak',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  auth_required: 'Verification needed',
  off: 'Microphone off',
  error: 'Voice is unavailable',
  ended: 'Call ended',
};

export const callLabel = (state: CallState, activeTool: string | null) => (state === 'working' ? toolProgress(activeTool) : STATE_LABEL[state]);

const ORB: Record<CallState, 'idle' | 'thinking' | 'live' | 'rest'> = {
  connecting: 'thinking',
  listening: 'live',
  muted: 'live',
  thinking: 'thinking',
  working: 'thinking',
  speaking: 'live',
  auth_required: 'live',
  off: 'idle',
  error: 'rest',
  ended: 'rest',
};

/** The assistant's round avatar: a ring that follows the microphone while it listens, a turning arc while it works. */
export function CallAvatar({ state, level = 0, size = 52 }: { state: CallState; level?: number; size?: number }) {
  const listening = state === 'listening';
  const busy = state === 'connecting' || state === 'thinking' || state === 'working';
  return (
    <span className="tw-relative tw-inline-grid tw-shrink-0 tw-place-items-center" style={{ width: size, height: size }} aria-hidden="true">
      {listening && (
        <>
          <span className="tw-absolute tw-inset-0 tw-animate-call-ring tw-rounded-full tw-border-2 tw-border-solid tw-border-accent motion-reduce:tw-hidden" />
          {/* the real input level: the ring grows as the caller speaks */}
          <span
            className="tw-absolute tw-inset-0 tw-rounded-full tw-bg-accent-soft tw-transition-transform tw-duration-75"
            style={{ transform: `scale(${1 + Math.min(1, level) * 0.32})` }}
          />
        </>
      )}
      {state === 'speaking' && <span className="tw-absolute -tw-inset-1 tw-rounded-full tw-border-2 tw-border-solid tw-border-accent" />}
      {busy && (
        <span className="tw-absolute -tw-inset-1 tw-animate-spin tw-rounded-full tw-border-2 tw-border-solid tw-border-transparent tw-border-t-accent motion-reduce:tw-animate-none" />
      )}
      <AiOrb size={size} state={ORB[state]} className="tw-relative" />
      {state === 'muted' && (
        <span className="tw-absolute -tw-bottom-0.5 -tw-right-0.5 tw-grid tw-h-5 tw-w-5 tw-place-items-center tw-rounded-full tw-border-2 tw-border-solid tw-border-surface tw-bg-ink tw-text-surface">
          <Icon name="micOff" size={11} />
        </span>
      )}
    </span>
  );
}

/** Bars beside the status: the microphone's real level while listening; moving while the assistant speaks. */
function VoiceBars({ state, level }: { state: CallState; level: number }) {
  if (state !== 'listening' && state !== 'speaking') return null;
  const weights = [0.5, 0.85, 1, 0.7, 0.45];
  return (
    <span className="tw-inline-flex tw-h-3.5 tw-items-center tw-gap-[2px]" aria-hidden="true">
      {weights.map((weight, i) =>
        state === 'speaking' ? (
          <i
            key={i}
            className="tw-block tw-h-full tw-w-[3px] tw-origin-center tw-animate-voice-bar tw-rounded-full tw-bg-accent motion-reduce:tw-animate-none"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ) : (
          <i
            key={i}
            className="tw-block tw-w-[3px] tw-rounded-full tw-bg-accent"
            style={{ height: `${Math.max(3, Math.round(Math.min(1, level) * weight * 14))}px` }}
          />
        ),
      )}
    </span>
  );
}

/** Seconds since `running` last turned on; holds the final figure once it turns off. */
function useCallClock(running: boolean) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const begin = Date.now();
    setStartedAt(begin);
    setNow(begin);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return startedAt === null ? null : Math.max(0, Math.floor((now - startedAt) / 1000));
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The top of the call: who you are talking to and what is happening, in one compact row. */
export function CallHeader({ name, state, activeTool, voice }: { name: string; state: CallState; activeTool: string | null; voice: BrowserVoice }) {
  const seconds = useCallClock(voice.active);
  const label = callLabel(state, activeTool);
  return (
    <div
      role="region"
      aria-label="Voice call"
      className="tw-flex tw-shrink-0 tw-items-center tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-bg-subtle tw-px-4 tw-py-2.5"
    >
      <CallAvatar state={state} level={voice.level} />
      <div className="tw-min-w-0 tw-flex-1">
        <p className="tw-m-0 tw-truncate tw-text-md tw-font-semibold tw-text-ink">{name}</p>
        <p
          role="status"
          className={cn(
            'tw-m-0 tw-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-text-sm',
            state === 'error' ? 'tw-text-danger' : state === 'auth_required' ? 'tw-text-accent-ink' : 'tw-text-muted',
          )}
        >
          {state === 'auth_required' && <Icon name="lock" size={13} />}
          <VoiceBars state={state} level={voice.level} />
          <span className="tw-truncate">{label}</span>
        </p>
      </div>
      {seconds !== null && (
        <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5 tw-text-xs tw-tabular-nums tw-text-muted">
          <i className={cn('tw-h-1.5 tw-w-1.5 tw-rounded-full', voice.active ? 'tw-bg-success' : 'tw-bg-line-strong')} aria-hidden="true" />
          <span className="srOnly">{voice.active ? 'Call time' : 'Call lasted'}</span>
          {clock(seconds)}
        </span>
      )}
    </div>
  );
}

/** A round call button with its name under it. */
export function CallButton({
  icon,
  label,
  onClick,
  tone = 'plain',
  pressed,
  disabled,
}: {
  icon: string;
  label: ReactNode;
  onClick: () => void;
  tone?: 'plain' | 'danger' | 'primary';
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      className="tw-group tw-flex tw-min-w-[64px] tw-flex-col tw-items-center tw-gap-1 tw-border-0 tw-bg-transparent tw-p-0 tw-text-xs tw-text-ink-soft disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
    >
      <span
        className={cn(
          'tw-grid tw-h-11 tw-w-11 tw-place-items-center tw-rounded-full tw-transition-colors group-focus-visible:tw-outline group-focus-visible:tw-outline-2 group-focus-visible:tw-outline-offset-2 group-focus-visible:tw-outline-accent',
          tone === 'danger'
            ? 'tw-bg-danger tw-text-surface group-hover:tw-opacity-90'
            : tone === 'primary'
              ? 'tw-bg-accent tw-text-[color:var(--on-accent)] group-hover:tw-opacity-90'
              : pressed
                ? 'tw-bg-ink tw-text-surface'
                : 'tw-border tw-border-solid tw-border-line tw-bg-surface tw-text-ink group-hover:tw-border-accent',
        )}
        aria-hidden="true"
      >
        <Icon name={icon} size={18} />
      </span>
      {label}
    </button>
  );
}
