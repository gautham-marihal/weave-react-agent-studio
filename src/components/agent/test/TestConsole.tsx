import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BotIcon, CircleAlertIcon, LandmarkIcon, MicIcon, RotateCcwIcon, SendHorizontalIcon, SquareIcon } from 'lucide-react';
import { isWebChannel, type AgentConfig, type ChannelType } from '../../../types/studio';
import type { TestSession } from '../../../hooks/useTestSession';
import { Button } from '../../ui/Button';
import { StatusChip } from '../../ui/StatusChip';
import { Segmented } from '../../ui/Segmented';
import { ChatForm } from './ChatForm';
import { VoiceBubble } from './VoiceBubble';
import { AgentSelector } from './AgentSelector';
import { GATEWAY_CONNECTION, usesGateway } from '../../../models/bankingTools';
import { cn, easeOut, inputClass } from '../../../utils/styles';

interface TestConsoleProps {
  session: TestSession;
  config: AgentConfig;
  revision: number;
  /** Saves pending edits; resolves false if the draft could not be saved. */
  onBeforeStart: () => Promise<boolean>;
  hasUnsaved: boolean;
  currentAgentId?: string;
  onSwitchAgent?: (agentId: string) => void;
  /** What to talk to: "draft" (default), "latest", a version or an environment. Only the draft is saved first. */
  target?: string;
  /** The chip naming what is talked to, e.g. "draft · rev 4" or "v0.1.1 · Development". */
  targetChip?: string;
  /** The config whose web channels are offered (a version's own, when talking to a version). */
  channelsConfig?: AgentConfig;
  /** Controls beside the title (the "Talk to" picker). */
  toolbar?: React.ReactNode;
  /** Shown under the conversation while it runs or after it ended (media buttons, "make a scenario"). */
  footer?: React.ReactNode;
  /** A narrower layout for the test panel beside other pages. */
  compact?: boolean;
}

const defaultSuggestions = ['When is my bill due?', 'Can I speak to a person?', 'Please call me back', 'Thanks, goodbye'];
const bankingSuggestions = ['What is my account balance?', 'Show my recent transactions', 'Can I speak to a person?', 'Thanks, goodbye'];

export function TestConsole({
  session,
  config,
  revision,
  onBeforeStart,
  hasUnsaved,
  currentAgentId,
  onSwitchAgent,
  target = 'draft',
  targetChip,
  channelsConfig,
  toolbar,
  footer,
  compact = false,
}: TestConsoleProps) {
  const isBanking = usesGateway(config);
  const gatewayTools = (config.tools ?? []).filter((t) => t.connection === GATEWAY_CONNECTION).length;
  const extras = session.extras;
  const suggestions = extras?.suggestions ?? (isBanking ? bankingSuggestions : defaultSuggestions);
  // One tab per web channel type the draft has enabled; the server is asked for that channel by its id.
  const webChannels = ((channelsConfig ?? config).channels ?? []).filter((c) => c.enabled && isWebChannel(c.type));
  const channelTypes = [...new Set(webChannels.map((c) => c.type))];
  const [picked, setSelected] = useState<ChannelType>(channelTypes[0] ?? 'web_chat');
  // A version may not have the channel picked for the draft: fall back to one it has.
  const selected: ChannelType = channelTypes.includes(picked) || !channelTypes.length ? picked : channelTypes[0];
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const { status, messages, typing, channel, bubbleState, audioLevel, latestCaption, error, endReason, isMuted } = session;
  const live = status === 'live';
  const active = live || status === 'connecting' || status === 'waiting';
  const settingUp = saving || status === 'connecting' || status === 'waiting';
  // The conversation is shown on its own tab; the other tab shows its start screen.
  const showing = status !== 'idle' && channel === selected;
  // Sandbox's imitation has no microphone: a voice channel is played as typed text. A Sandbox banking conversation
  // speaks and listens through the browser's speech service when it has one.
  const words = session.sandbox;
  const isVoice = selected === 'web_voice' && (!words || Boolean(extras?.voice));

  // A reply streams into its message, so follow its text as well as new messages.
  const lastText = messages[messages.length - 1]?.text;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, lastText, typing]);

  // The session runs the saved draft, so start only once the server has the latest edits.
  const start = async () => {
    if (settingUp) return;
    // Unlock audio inside this click, before saving and connecting take it out of the click.
    session.primeAudio();
    setSaving(true);
    let saved = false;
    try {
      // Only the draft needs saving first: a version or an environment runs what was published.
      saved = target === 'draft' && !words ? await onBeforeStart() : true;
    } finally {
      setSaving(false);
    }
    if (saved) await session.start(selected, webChannels.find((c) => c.type === selected)?.id, target);
  };

  const switchTab = (next: ChannelType) => {
    if (next === selected) return;
    if (active) session.stop();
    setSelected(next);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || !live) return;
    session.send(draft);
    setDraft('');
  };

  const conversation = (
    <div
      ref={listRef}
      className={cn('min-h-0 space-y-3 overflow-y-auto px-4 py-5', isVoice ? 'max-h-[360px] min-h-[160px] lg:max-h-none lg:flex-1' : 'flex-1')}
      aria-live="polite"
      aria-label={isVoice ? 'Live transcript' : 'Conversation'}
    >
      {words && (status === 'connecting' || status === 'waiting') && <p className="text-center text-[13px] text-muted">{words.starting}</p>}
      {!words && !isVoice && status === 'connecting' && <p className="text-center text-[13px] text-muted">Connecting to the LiveKit room…</p>}
      {!words && !isVoice && status === 'waiting' && <p className="text-center text-[13px] text-muted">Waiting for the agent to join…</p>}
      {isVoice && messages.length === 0 && (
        <p className="text-center text-[13px] text-muted">What you and the agent say prints here as you talk.</p>
      )}
      {messages.map((m) =>
        m.from === 'system' ? (
          <p key={m.id} className="py-2 text-center text-[13px] text-muted">
            {m.text}
          </p>
        ) : (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: easeOut }}
            className={cn('flex flex-col', m.from === 'user' ? 'items-end' : 'items-start')}
          >
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm',
                m.from === 'user' ? 'bg-accent text-accent-ink rounded-br-sm' : 'bg-subtle text-ink border border-line rounded-bl-sm',
                m.partial && 'opacity-80'
              )}
            >
              {m.sandbox && words && (
                <span className="mb-0.5 block">
                  <span title={words.replyTagTitle} className="rounded bg-warning-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">
                    {words.replyTag}
                  </span>
                </span>
              )}
              <p>
                {m.text}
                {m.partial && <span aria-hidden> …</span>}
              </p>
              {m.via && <span className="mt-1 block text-[11px] opacity-75">{m.via === 'voice' ? 'spoken' : 'typed'}</span>}
            </div>
            {m.from === 'agent' && extras?.underMessage(m)}

            {m.form && (
              <div className="mt-3 w-full max-w-md">
                <ChatForm form={m.form} accepted={m.formStatus === 'accepted'} onSubmit={(vals) => session.submitForm(m.id, m.form!, vals)} />
              </div>
            )}
          </motion.div>
        )
      )}
      {typing && (
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.3s]" />
          <span>Agent is generating response…</span>
        </div>
      )}
    </div>
  );

  const composer = active && (
    <div className="border-t border-line p-3">
      {extras?.composerNote}
      {!isVoice && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!live}
              onClick={() => session.send(s)}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft hover:border-accent hover:text-ink transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink-soft"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={draft}
          disabled={!live}
          aria-label="Message"
          onChange={(e) => setDraft(e.target.value)}
          placeholder={!live ? 'Waiting for the agent to join…' : (extras?.placeholder ?? (isVoice ? 'Or type a message during the call…' : 'Type a message…'))}
          className={cn(inputClass, 'flex-1 disabled:cursor-not-allowed disabled:opacity-60')}
        />
        <Button variant="primary" type="submit" disabled={!live || !draft.trim()} aria-label="Send">
          <SendHorizontalIcon className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );

  return (
    <section
      aria-labelledby={compact ? 'console-title-dock' : 'console-title'}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden bg-surface',
        compact ? 'h-full min-h-0' : 'min-h-[560px] rounded-xl border border-line lg:h-[720px]'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={compact ? 'console-title-dock' : 'console-title'} className="text-sm font-semibold text-ink">
            {target === 'draft' ? 'Talk to your draft' : 'Talk to the agent'}
          </h2>
          {toolbar}
          {currentAgentId && onSwitchAgent && (
            <AgentSelector
              currentAgentId={currentAgentId}
              onSelect={(id) => {
                if (active) session.stop();
                onSwitchAgent(id);
              }}
            />
          )}
          <StatusChip className="font-mono">{targetChip ?? `draft · rev ${revision}`}</StatusChip>
          {words ? (
            <StatusChip tone="warning">{words.chip}</StatusChip>
          ) : (
            <StatusChip tone={live ? 'success' : 'neutral'}>{live ? 'Live · Real API' : 'Real LiveKit'}</StatusChip>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {channelTypes.length > 0 && (
            <Segmented
              size="sm"
              label="Channel"
              options={channelTypes.map((c) => ({ value: c, label: c === 'web_chat' ? 'Web chat' : 'Web voice' }))}
              value={selected}
              onChange={switchTab}
            />
          )}
          {showing && active && (
            <Button size="sm" variant="ghost" onClick={session.stop}>
              <SquareIcon className="h-3.5 w-3.5" aria-hidden />
              End
            </Button>
          )}
          {showing && (
            <Button size="sm" variant="secondary" onClick={start} disabled={settingUp}>
              <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
              New conversation
            </Button>
          )}
        </div>
      </div>

      {!showing ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-3 py-1 text-xs font-medium text-ink-soft">
            {isBanking ? <LandmarkIcon className="h-3.5 w-3.5 text-accent" aria-hidden /> : <BotIcon className="h-3.5 w-3.5" aria-hidden />}
            <span>{config.agent?.name || 'This agent'}</span>
            {gatewayTools > 0 && (
              <span className="text-muted">
                · {gatewayTools} banking gateway {gatewayTools === 1 ? 'tool' : 'tools'}
              </span>
            )}
          </div>

          <p className="text-base font-semibold text-ink">The agent speaks first.</p>
          <p className="mt-1 max-w-sm text-sm text-muted">
            {words
              ? words.intro
              : isVoice
              ? 'Talk to the live runtime worker over LiveKit. What you both say prints as a chat while you talk, and you can type too.'
              : 'Chat with the live runtime worker over LiveKit. Replies stream in as the agent writes them.'}
          </p>

          {selected === 'web_voice' && extras?.voiceMissing && (
            <p role="note" className="mt-3 flex max-w-md items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/60 px-3 py-2 text-left text-[13px] text-ink-soft">
              <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              {extras.voiceMissing}
            </p>
          )}

          {hasUnsaved && target === 'draft' && (
            <p className="mt-3 text-[13px] text-ink-soft">
              {words ? words.unsaved : 'You have unsaved changes. Tests use the saved draft, so you’ll be asked to save first.'}
            </p>
          )}
          <Button variant="primary" className="mt-5" onClick={start} disabled={settingUp}>
            {isVoice ? <MicIcon className="h-4 w-4" aria-hidden /> : null}
            Start {isVoice ? 'voice' : 'chat'} test
          </Button>
        </div>
      ) : isVoice ? (
        <>
          <div className={cn('p-4 pb-0', compact && 'p-3 pb-0')}>
            <VoiceBubble
              compact
              title={extras?.voice?.title}
              descriptions={extras?.voice?.descriptions}
              state={bubbleState}
              audioLevel={audioLevel}
              captionText={latestCaption}
              errorMessage={error ?? endReason ?? undefined}
              audioBlocked={session.audioBlocked}
              onEnableAudio={session.enableAudio}
              micError={session.micError}
              onRetryMic={session.retryMic}
              isMuted={isMuted}
              onToggleMute={session.toggleMute}
              onEndCall={session.stop}
              onStartVoice={start}
            />
          </div>
          {conversation}
          {composer}
          {footer}
        </>
      ) : (
        <>
          {status === 'error' && error && (
            <div role="alert" className="mx-4 mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
              <p className="flex min-w-0 flex-1 items-start gap-2 text-ink">
                <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                {error}
              </p>
              <Button size="sm" variant="secondary" onClick={start} disabled={settingUp}>
                <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
                Try again
              </Button>
            </div>
          )}
          {conversation}
          {composer}
          {footer}
        </>
      )}
    </section>
  );
}
