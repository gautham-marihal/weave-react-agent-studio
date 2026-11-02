import React, { useState } from 'react';
import { CircleAlertIcon, MicIcon, MicOffIcon, PhoneOffIcon, MessageSquareIcon, SubtitlesIcon, Volume2Icon, RotateCcwIcon } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../../utils/styles';
import { AgentOrb, type OrbState } from './AgentOrb';

export type BubbleState =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'muted'
  | 'reconnecting'
  | 'auth_required'
  | 'tool_execution'
  | 'success'
  | 'error'
  | 'ended';

interface VoiceBubbleProps {
  state: BubbleState;
  audioLevel?: number; // 0.0 to 1.0
  captionText?: string;
  errorMessage?: string;
  isMuted?: boolean;
  onToggleMute?: () => void;
  onEndCall?: () => void;
  onSwitchToChat?: () => void;
  onStartVoice?: () => void;
  /** The browser blocked the agent's audio; show a button that lets it play. */
  audioBlocked?: boolean;
  onEnableAudio?: () => void;
  /** The microphone could not be turned on; shown with a Try again button. */
  micError?: string | null;
  onRetryMic?: () => void;
  /** Shorter, without captions: for when a live transcript is shown under the bubble. */
  compact?: boolean;
  /** The bubble's heading (default "Live Voice Agent"). */
  title?: string;
  /** Wording per state for voice that is not the LiveKit runtime (e.g. the browser's speech service). */
  descriptions?: Partial<Record<BubbleState, string>>;
  /** The start button's label (default "Start Voice Conversation"). */
  startLabel?: string;
}

const stateLabels: Record<BubbleState, { label: string; desc: string }> = {
  idle: { label: 'Ready', desc: 'Click to talk with your voice agent' },
  connecting: { label: 'Connecting…', desc: 'Joining LiveKit room and reserving agent' },
  waiting: { label: 'Waiting for the agent to join…', desc: 'Connected to the room. The runtime worker usually joins within a few seconds.' },
  listening: { label: 'Listening…', desc: 'Speak to the agent naturally' },
  thinking: { label: 'Thinking…', desc: 'Generating reply with LLM' },
  speaking: { label: 'Speaking', desc: 'Agent is speaking through TTS' },
  muted: { label: 'Microphone muted', desc: 'Click unmute to speak' },
  reconnecting: { label: 'Reconnecting…', desc: 'Restoring audio stream' },
  auth_required: { label: 'Authentication required', desc: 'Please verify your identity using the secure keypad or spoken digits' },
  tool_execution: { label: 'Executing banking tool…', desc: 'Calling banking gateway to process your request' },
  success: { label: 'Request completed', desc: 'Banking operation completed successfully' },
  error: { label: 'Connection error', desc: 'Failed to establish voice session' },
  ended: { label: 'Call ended', desc: 'Conversation completed' },
};

const orbStates: Record<BubbleState, OrbState> = {
  idle: 'ready',
  ended: 'ready',
  connecting: 'connecting',
  waiting: 'connecting',
  reconnecting: 'connecting',
  listening: 'live',
  thinking: 'live',
  speaking: 'live',
  muted: 'live',
  auth_required: 'live',
  tool_execution: 'live',
  success: 'live',
  error: 'error',
};

const pills: Record<OrbState, { label: string; dot: string }> = {
  ready: { label: 'Ready', dot: 'bg-muted' },
  connecting: { label: 'Connecting', dot: 'bg-warning animate-pulse' },
  live: { label: 'Live', dot: 'bg-success' },
  error: { label: 'Error', dot: 'bg-danger' },
};

export function VoiceBubble({
  state,
  audioLevel = 0,
  captionText = '',
  errorMessage,
  isMuted = false,
  onToggleMute,
  onEndCall,
  onSwitchToChat,
  onStartVoice,
  audioBlocked = false,
  onEnableAudio,
  micError,
  onRetryMic,
  compact = false,
  title = 'Live Voice Agent',
  descriptions,
  startLabel = 'Start Voice Conversation',
}: VoiceBubbleProps) {
  const [showCaptions, setShowCaptions] = useState(true);
  const orbState = orbStates[state];
  const info = stateLabels[state];
  const pill = pills[orbState];
  const inCall = orbState === 'connecting' || orbState === 'live';

  return (
    <div className={cn('flex flex-col items-center justify-between rounded-3xl', !compact && 'min-h-[480px]', 'border border-line bg-gradient-to-b from-surface to-canvas p-4 shadow-panel sm:p-6')}>
      {/* Top status bar */}
      <div className="flex w-full items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1.5 font-medium">
          <Volume2Icon className="h-3.5 w-3.5 text-accent" aria-hidden />
          {title}
        </span>
        <span
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 font-medium text-ink-soft"
        >
          <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', pill.dot)} />
          {pill.label}
        </span>
      </div>

      <AgentOrb state={orbState} level={audioLevel} label={`Voice agent: ${info.label}`} className={compact ? 'my-4' : 'my-8'} small={compact} />

      {/* State label & description */}
      <div className="text-center">
        <h3 className="text-xl font-semibold text-ink">{info.label}</h3>
        <p className="mt-1 max-w-sm text-sm text-muted">{errorMessage || descriptions?.[state] || info.desc}</p>
      </div>

      {inCall && audioBlocked && (
        <div role="alert" className="mt-4 flex w-full max-w-lg flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3 text-sm">
          <p className="min-w-0 flex-1 text-ink">Your browser paused the agent’s audio until you allow it.</p>
          <Button variant="primary" size="sm" className="rounded-full" onClick={onEnableAudio}>
            <Volume2Icon className="h-4 w-4" aria-hidden />
            Enable audio
          </Button>
        </div>
      )}

      {inCall && micError && (
        <div role="alert" className="mt-4 flex w-full max-w-lg flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-3 text-sm">
          <p className="flex min-w-0 flex-1 items-start gap-2 text-ink">
            <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            {micError}
          </p>
          {onRetryMic && (
            <Button variant="secondary" size="sm" className="rounded-full" onClick={onRetryMic}>
              <RotateCcwIcon className="h-4 w-4" aria-hidden />
              Try again
            </Button>
          )}
        </div>
      )}

      {/* Live Agent Captions */}
      {showCaptions && !compact && (
        <div className="mt-4 min-h-[50px] w-full max-w-lg rounded-2xl border border-line bg-surface/70 p-3 text-center text-sm text-ink-soft">
          {captionText ? (
            <p className="font-medium leading-relaxed text-ink">"{captionText}"</p>
          ) : (
            <p className="text-xs italic text-muted">Captions will stream here as the agent speaks…</p>
          )}
        </div>
      )}

      {/* Control bar */}
      <div className="mt-6 flex w-full flex-wrap items-center justify-center gap-2 border-t border-line pt-4 sm:gap-3">
        {inCall ? (
          <>
            <Button
              variant={isMuted ? 'danger' : 'secondary'}
              size="sm"
              className="rounded-full px-4"
              onClick={onToggleMute}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted ? <MicOffIcon className="h-4 w-4" aria-hidden /> : <MicIcon className="h-4 w-4" aria-hidden />}
              {isMuted ? 'Unmute' : 'Mute'}
            </Button>

            <Button variant="danger" size="sm" className="rounded-full px-4" onClick={onEndCall} title="End conversation">
              <PhoneOffIcon className="h-4 w-4" aria-hidden />
              End call
            </Button>
          </>
        ) : (
          <Button variant="primary" className="rounded-full px-5" onClick={onStartVoice}>
            {orbState === 'error' ? <RotateCcwIcon className="h-4 w-4" aria-hidden /> : <MicIcon className="h-4 w-4" aria-hidden />}
            {orbState === 'error' ? 'Try again' : startLabel}
          </Button>
        )}

        {!compact && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => setShowCaptions((v) => !v)}
            title="Toggle agent speech captions"
          >
            <SubtitlesIcon className="h-4 w-4" aria-hidden />
            {showCaptions ? 'Hide captions' : 'Show captions'}
          </Button>
        )}

        {onSwitchToChat && (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={onSwitchToChat} title="Switch to text chat">
            <MessageSquareIcon className="h-4 w-4" aria-hidden />
            Text chat
          </Button>
        )}
      </div>
    </div>
  );
}
