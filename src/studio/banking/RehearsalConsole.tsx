import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { Choice, OneOf } from '../../ui/OneOf.tsx';
import AiOrb from '../preview/AiOrb.jsx';
import TraceView from '../trace/TraceView.jsx';
import { DEFAULT_BANK } from './assistantModel.ts';
import { evaluate, SCENARIOS } from './scenarios.ts';
import type { BankingAssistant } from './useBankingAssistant.ts';
import type { ConversationMode, RehearsalSession } from './useRehearsalSession.ts';
import AccountOverview from './AccountOverview.tsx';
import CallerPanel, { EnvironmentNotice } from './CallerPanel.tsx';
import { useStickyTop } from './useStickyTop.ts';
import ReplyCard from './ReplyCard.tsx';
import ScenarioPanel from './ScenarioPanel.tsx';
import { HostFaults, MockPhone, ToolRunner } from './RehearsalTools.tsx';
import { Chip, cn, inputClass, panelClass, segmentClass } from './ui.tsx';
import { CallAvatar, CallButton, CallHeader, callStateOf, toolProgress } from './VoiceCall.tsx';

// Weave Studio's banking assistant, on the Test page (the "Banking rehearsal" choice): the conversation by web chat or
// web voice on the left; the caller's secure banking (sign-in, keypad, accounts, confirmations), the scenarios and the
// trace in a side panel that scrolls on its own. It runs on the real gateway with its mock bank systems; the gateway
// decides sign-in, entitlements and confirmations, and the assistant speaks only from tool results.

type SideTab = 'banking' | 'scenarios' | 'trace';

const SECURE_LABEL: Record<string, string> = {
  pin: 'Phone PIN',
  nric: 'NRIC digits',
  otp: 'One-time password',
  current_pin: 'Current Phone PIN',
  new_pin: 'New Phone PIN',
  confirm_new_pin: 'New Phone PIN again',
};
const SUGGESTIONS = ["What's my balance?", 'Show my recent transactions', 'Did my cheque clear?', 'USD exchange rate', 'Speak to a person'];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// how close to the end of the conversation still counts as "reading the latest"
const NEAR_END = 48;

// ---- the conversation

function ConversationPanel({ session }: { session: RehearsalSession }) {
  const r = session.rehearsal;
  const { assistant, voice, mode } = r;
  const id = useId();
  const [draft, setDraft] = useState('');
  const [unseen, setUnseen] = useState(false);
  const secureRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const countRef = useRef(0);
  const { messages, thinking, activeTool, secureStep, identifierStep, spokenSecrets } = assistant;
  const lastId = messages[messages.length - 1]?.id;
  const isVoice = mode === 'voice';
  const started = r.live;
  const ended = !started && messages.length > 0;
  // By voice, the conversation is a call: its header above the messages, its controls in the bottom bar.
  const inCall = isVoice && (started || ended);
  const callState = callStateOf({ voice, live: started, starting: r.starting, thinking, activeTool, verifying: Boolean(secureStep || identifierStep) });
  const name = r.bankName || DEFAULT_BANK;

  // Follow the newest message while the reader is at the end of the conversation; someone reading further up stays
  // where they are, and a "new messages" button takes them down. What the caller sends always comes into view.
  const followIfReading = () => {
    const list = listRef.current;
    if (!list) return;
    followRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_END;
    if (followRef.current) setUnseen(false);
  };
  const toLatest = () => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    followRef.current = true;
    setUnseen(false);
  };
  useEffect(() => {
    const list = listRef.current;
    const added = messages.length > countRef.current;
    countRef.current = messages.length;
    if (!messages.length || (added && messages[messages.length - 1]?.role === 'customer')) followRef.current = true;
    if (!list) return;
    // instant, not smooth: a smooth scroll still on its way would read as the reader scrolling up
    if (followRef.current) list.scrollTop = list.scrollHeight;
    else if (added) setUnseen(true);
  }, [messages, thinking, voice.interim, isVoice]);

  // A new secure step starts with an empty field.
  useEffect(() => {
    if (secureRef.current) secureRef.current.value = '';
  }, [secureStep]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (secureStep) {
      const input = secureRef.current;
      const value = input?.value ?? '';
      if (input) input.value = ''; // cleared before the request goes out
      if (value.trim()) assistant.handle(value, 'chat');
      return;
    }
    if (!draft.trim()) return;
    assistant.handle(draft, 'chat');
    setDraft('');
  };

  // What is being heard: digits show as dots while a secret or an identifier is expected.
  const interim = secureStep || identifierStep ? voice.interim.replace(/\d/g, '•') : voice.interim;

  const conversation = (
    <div className="tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div
        ref={listRef}
        onScroll={followIfReading}
        className="tw-min-h-0 tw-flex-1 tw-space-y-2.5 tw-overflow-y-auto tw-bg-canvas tw-px-3 tw-py-4 sm:tw-px-4"
        role="log"
        aria-live="polite"
        aria-label={isVoice ? 'Live transcript' : 'Conversation'}
      >
        {messages.length === 0 && <p className="tw-m-0 tw-text-center tw-text-sm tw-text-muted">Connecting to the bank’s secure channel…</p>}
        {messages.map((m) => {
          const mine = m.role === 'customer';
          return (
            <div key={m.id} className={cn('tw-flex tw-animate-fade-up tw-flex-col motion-reduce:tw-animate-none', mine ? 'tw-items-end' : 'tw-items-start')}>
              <div
                className={cn(
                  'tw-max-w-[85%] tw-break-words tw-rounded-2xl tw-px-3.5 tw-pb-1.5 tw-pt-2 tw-text-md tw-leading-relaxed tw-shadow-sm [overflow-wrap:anywhere] sm:tw-max-w-[75%]',
                  mine
                    ? m.secure
                      ? 'tw-rounded-br-sm tw-border tw-border-dashed tw-border-line-strong tw-bg-surface tw-text-ink-soft'
                      : 'tw-rounded-br-sm tw-bg-accent-soft tw-text-ink'
                    : 'tw-rounded-bl-sm tw-border tw-border-solid tw-border-line tw-bg-surface tw-text-ink',
                )}
              >
                <span className={cn('tw-block', m.secure && 'tw-flex tw-items-center tw-gap-1.5 tw-italic')}>
                  {m.secure && <Icon name="lock" size={14} />}
                  <span className="srOnly">{mine ? 'You: ' : 'Assistant: '}</span>
                  {m.text}
                </span>
                <span className="tw-mt-0.5 tw-flex tw-justify-end tw-gap-1.5 tw-text-xs tw-text-muted">
                  {mine && m.via && <span>{m.via === 'voice' ? 'spoken' : m.via === 'chat' ? 'typed' : 'selected on screen'}</span>}
                  <time dateTime={new Date(m.at).toISOString()} className="tw-tabular-nums">
                    {timeOf(m.at)}
                  </time>
                </span>
              </div>
              {m.card && (
                <div className="tw-w-full tw-max-w-md">
                  <ReplyCard
                    card={m.card}
                    latest={m.id === lastId && started}
                    busy={thinking || assistant.busy || !started}
                    answered={m.answered}
                    onChoose={(purpose, choice, label) => assistant.choose(purpose, choice, label, m.id)}
                    onCurrency={assistant.balanceIn}
                  />
                </div>
              )}
            </div>
          );
        })}
        {interim && (
          <div className="tw-flex tw-flex-col tw-items-end" aria-hidden="true">
            <div className="tw-flex tw-max-w-[85%] tw-items-center tw-gap-1.5 tw-rounded-2xl tw-rounded-br-sm tw-border tw-border-dashed tw-border-accent-line tw-bg-accent-soft tw-px-3.5 tw-py-2 tw-text-md tw-text-ink tw-opacity-80 sm:tw-max-w-[75%]">
              <Icon name="mic" size={14} />
              {interim} …
            </div>
          </div>
        )}
        {thinking && (
          <div className="tw-flex tw-items-start">
            <div
              role="status"
              className="tw-flex tw-items-center tw-gap-2 tw-rounded-2xl tw-rounded-bl-sm tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3.5 tw-py-2.5 tw-text-sm tw-text-muted tw-shadow-sm"
            >
              <span className="tw-flex tw-items-center tw-gap-1" aria-hidden="true">
                <span className="tw-h-1.5 tw-w-1.5 tw-animate-bounce tw-rounded-full tw-bg-accent motion-reduce:tw-animate-none" />
                <span className="tw-h-1.5 tw-w-1.5 tw-animate-bounce tw-rounded-full tw-bg-accent [animation-delay:0.15s] motion-reduce:tw-animate-none" />
                <span className="tw-h-1.5 tw-w-1.5 tw-animate-bounce tw-rounded-full tw-bg-accent [animation-delay:0.3s] motion-reduce:tw-animate-none" />
              </span>
              {toolProgress(activeTool)}
            </div>
          </div>
        )}
      </div>
      {unseen && (
        <button
          type="button"
          onClick={toLatest}
          className="tw-absolute tw-bottom-3 tw-left-1/2 tw-flex -tw-translate-x-1/2 tw-items-center tw-gap-1.5 tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-3 tw-py-1.5 tw-text-xs tw-font-medium tw-text-ink tw-shadow-md hover:tw-border-accent"
        >
          <Icon name="chevronDown" size={14} />
          New messages
        </button>
      )}
    </div>
  );

  const secureForm = secureStep && (
    <form onSubmit={send}>
      <label htmlFor={`${id}-secure`} className="tw-mb-1.5 tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-font-medium tw-text-ink">
        <Icon name="key" size={14} />
        Secure entry · {SECURE_LABEL[secureStep] ?? 'Code'}
      </label>
      {spokenSecrets ? (
        <div className="tw-flex tw-gap-2">
          <input
            id={`${id}-secure`}
            ref={secureRef}
            type="password"
            inputMode="numeric"
            autoComplete={secureStep === 'otp' ? 'one-time-code' : 'off'}
            placeholder="Digits only. Sent straight to the bank, never shown."
            className={cn(inputClass, 'tw-flex-1 tw-font-mono tw-tracking-widest placeholder:tw-font-sans placeholder:tw-tracking-normal')}
            maxLength={12}
          />
          <Button type="submit" variant="primary" size="compact" disabled={thinking}>
            <Icon name="lock" size={14} />
            Send securely
          </Button>
        </div>
      ) : (
        <p className="tw-m-0 tw-rounded-control tw-border tw-border-solid tw-border-line tw-bg-subtle tw-px-3 tw-py-2 tw-text-sm tw-text-ink-soft">
          Use the secure keypad in the banking panel. Entering this in the conversation is turned off.
        </p>
      )}
      <p className="tw-m-0 tw-mt-1.5 tw-text-xs tw-text-muted">
        {voice.active && spokenSecrets
          ? 'You can also say the digits. They show as dots and go only to the bank’s secure entry.'
          : 'Or use the secure keypad in the banking panel.'}
      </p>
    </form>
  );

  const messageForm = (
    <>
      {!isVoice && (
        <div className="tw-mb-2 tw-flex tw-flex-wrap tw-gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={thinking}
              onClick={() => assistant.handle(s, 'chat')}
              className="tw-rounded-full tw-border tw-border-solid tw-border-line tw-bg-surface tw-px-2.5 tw-py-1 tw-text-xs tw-text-ink-soft hover:tw-border-accent hover:tw-text-ink disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={send} className="tw-flex tw-gap-2">
        <input
          type="text"
          value={draft}
          aria-label="Message the banking assistant"
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            identifierStep === 'phone_code'
              ? 'Type your 7-digit Phone Code'
              : identifierStep === 'account_number'
                ? 'Type your 12-digit account number'
                : isVoice
                  ? 'Or type a message during the call…'
                  : 'Type a message…'
          }
          inputMode={identifierStep ? 'numeric' : undefined}
          autoComplete="off"
          className={cn(inputClass, 'tw-flex-1 tw-rounded-full tw-px-4')}
        />
        <Button type="submit" variant="primary" size="compact" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </>
  );

  const endedNote = (
    <p role="status" className="tw-m-0 tw-text-sm tw-text-muted">
      {r.endedBy === 'transferred'
        ? 'The caller was handed to a Service Manager, so this conversation has ended (in the test environment no call is transferred). Start a new one to continue.'
        : r.endedBy === 'goodbye'
          ? 'The caller said goodbye, so this conversation has ended. Start a new one to continue.'
          : 'This conversation has ended. Start a new one to continue.'}
    </p>
  );

  // The call's controls: the microphone, hanging up, and the same conversation by chat (nothing restarts). Each control
  // has its own key, so one never turns into another through a colour transition.
  const callControls = (
    <div role="group" aria-label="Call controls" className="tw-flex tw-items-start tw-justify-center tw-gap-6 sm:tw-gap-10">
      {!started ? (
        <CallButton
          key="again"
          icon="phone"
          label="Call again"
          tone="primary"
          onClick={() => void r.newConversation()}
          disabled={r.starting || !voice.supported}
        />
      ) : voice.active ? (
        <CallButton key="mute" icon={voice.muted ? 'micOff' : 'mic'} label="Mute" pressed={voice.muted} onClick={voice.toggleMute} />
      ) : (
        <CallButton
          key="start"
          icon="mic"
          label={callState === 'connecting' ? 'Connecting…' : callState === 'error' ? 'Retry' : 'Start voice'}
          tone="primary"
          onClick={() => void voice.start()}
          disabled={callState === 'connecting' || !voice.supported}
        />
      )}
      {started && <CallButton icon="endCall" label="End call" tone="danger" onClick={r.end} />}
      <CallButton icon="chat" label="Switch to chat" onClick={() => r.setMode('chat')} />
    </div>
  );

  const bottomBar = (started || ended) && (
    <div className="tw-shrink-0 tw-space-y-3 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-bg-surface tw-p-3">
      {started && (secureForm || messageForm)}
      {ended && endedNote}
      {inCall && callState === 'error' && (
        <p role="alert" className="tw-m-0 tw-flex tw-items-start tw-gap-2 tw-text-sm tw-text-danger">
          <Icon name="alert" size={16} />
          {voice.error ?? 'Voice needs Chrome or Edge (browser speech recognition). You can keep typing.'}
        </p>
      )}
      {inCall && callControls}
    </div>
  );

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="tw-flex tw-h-[calc(100dvh-var(--console-top,0px)-24px)] tw-min-h-[440px] tw-min-w-0 tw-flex-col tw-overflow-hidden tw-rounded-card tw-border tw-border-solid tw-border-line tw-bg-surface lg:tw-h-auto lg:tw-min-h-0"
    >
      <div className="tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-4 tw-py-3">
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          <h3 id={`${id}-title`} className="tw-m-0 tw-text-md tw-font-semibold tw-text-ink">
            Talk to the banking assistant
          </h3>
          <Chip tone={started ? 'success' : 'neutral'} dot={started}>
            {started ? 'Live' : 'Not started'}
          </Chip>
        </div>
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          <OneOf className={segmentClass} label="Channel" value={mode} onChange={(v) => r.setMode(v as ConversationMode)}>
            <Choice value="chat">Web chat</Choice>
            <Choice value="voice">Web voice</Choice>
          </OneOf>
          {/* by voice, the call's own controls end it */}
          {started && !isVoice && (
            <Button type="button" size="compact" onClick={r.end}>
              <Icon name="stop" size={14} />
              End
            </Button>
          )}
          {(started || session.status === 'ended') && (
            <Button type="button" variant="secondary" size="compact" onClick={() => void r.newConversation()} disabled={r.starting}>
              <Icon name="undo" size={14} />
              New conversation
            </Button>
          )}
        </div>
      </div>

      {!started && messages.length === 0 ? (
        <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-px-6 tw-py-12 tw-text-center">
          {isVoice ? <CallAvatar state={r.starting ? 'connecting' : 'off'} size={96} /> : <AiOrb size={96} state={r.starting ? 'thinking' : 'idle'} />}
          {isVoice ? (
            <>
              <p className="tw-m-0 tw-mt-4 tw-text-lg tw-font-semibold tw-text-ink">{name}</p>
              <p role="status" className="tw-m-0 tw-mt-0.5 tw-text-sm tw-text-muted">
                {r.starting ? 'Connecting…' : 'Voice call · the assistant speaks first'}
              </p>
            </>
          ) : (
            <p className="tw-m-0 tw-mt-4 tw-text-lg tw-font-medium tw-text-ink">The assistant speaks first.</p>
          )}
          <p className="tw-m-0 tw-mt-1 tw-max-w-md tw-text-sm tw-text-muted">
            {isVoice
              ? 'Talk to the banking assistant with your microphone. What you both say prints as a chat while you talk, and you can type too.'
              : 'Chat with the banking assistant. Ask in your own words: balances, transactions, cheques, rates or a Service Manager.'}
          </p>
          <p className="tw-m-0 tw-mt-3 tw-max-w-md tw-text-xs tw-text-ink-soft">
            Sign-in, PIN and confirmations are decided by the banking gateway. PIN, NRIC and one-time passwords never appear in the conversation.
          </p>
          <Button type="button" variant="primary" className="tw-mt-5" onClick={() => void r.begin()} disabled={r.starting || (isVoice && !voice.supported)}>
            {isVoice && <Icon name="phone" size={16} />}
            {r.starting ? 'Connecting…' : isVoice ? (r.startError || voice.error ? 'Try the call again' : 'Start voice call') : 'Start chat conversation'}
          </Button>
          {isVoice && !voice.supported && (
            <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-muted">Voice needs Chrome or Edge (browser speech recognition). Web chat works in any browser.</p>
          )}
          {(r.startError || voice.error) && (
            <p role="alert" className="tw-m-0 tw-mt-3 tw-flex tw-max-w-md tw-items-start tw-gap-2 tw-text-left tw-text-sm tw-text-danger">
              <Icon name="alert" size={16} />
              {r.startError ?? voice.error}
            </p>
          )}
        </div>
      ) : (
        <>
          {inCall && <CallHeader name={name} state={callState} activeTool={activeTool} voice={voice} />}
          {conversation}
          {bottomBar}
        </>
      )}
    </section>
  );
}

/** Whether the digits of a PIN, NRIC or OTP may also come through the conversation (they always may on the keypad). */
function EntrySetting({ assistant }: { assistant: BankingAssistant }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className={panelClass}>
      <h3 id={`${id}-title`} className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-md tw-font-semibold tw-text-ink">
        <Icon name="key" size={16} />
        PIN and OTP entry
      </h3>
      <p className="tw-m-0 tw-mt-0.5 tw-text-xs tw-text-muted">The secure keypad always works. Callers can also type or say the digits in the conversation.</p>
      <div className="tw-mt-2">
        <OneOf
          className={segmentClass}
          label="PIN and OTP entry"
          value={assistant.spokenSecrets ? 'conversation' : 'keypad'}
          onChange={(v) => assistant.setSpokenSecrets(v === 'conversation')}
        >
          <Choice value="conversation">Keypad, typed or spoken</Choice>
          <Choice value="keypad">Keypad only</Choice>
        </OneOf>
      </div>
      <p className="tw-m-0 tw-mt-2 tw-text-xs tw-text-muted">
        Digits from the conversation go straight to the gateway’s secure entry and show as dots. Spoken digits pass through the browser’s speech service.
        Production follows its approved policy (keypad).
      </p>
    </section>
  );
}

// ---- the console

export default function RehearsalConsole({ session }: { session: RehearsalSession }) {
  const r = session.rehearsal;
  const { assistant, channel, panelChannel, call, live } = r;
  const [tab, setTab] = useState<SideTab>('banking');
  const sideRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  // the studio's pinned bars cover the top of the window; the console fits the height left below them
  const stickyTop = useStickyTop();

  // A conversation starting brings the whole console into view, just under the pinned bars.
  useEffect(() => {
    if (live) consoleRef.current?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [live, call?.call_id]);

  // When the bank needs the caller (keypad, confirmation, sign-in done), show the Banking tab and bring it into view.
  const attention = `${assistant.secureStep ?? ''}|${channel.confirmation?.id ?? ''}:${channel.confirmation?.phase ?? ''}|${channel.state?.auth.state ?? ''}`;
  useEffect(() => {
    if (!live) return undefined;
    setTab('banking');
    const frame = window.requestAnimationFrame(() => {
      const box = sideRef.current;
      const target =
        box?.querySelector<HTMLElement>('[aria-label="On-screen digits"]')?.closest('section') ??
        box?.querySelector<HTMLElement>('[data-confirmation]') ??
        null;
      if (!box || !target) return;
      const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12;
      box.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [attention, live]);

  const profile = channel.state?.profile ?? null;
  const accounts = profile?.accounts ?? [];
  const defaultAccountRef = assistant.selectedAccount ?? (accounts.length === 1 ? (accounts[0]?.account_ref ?? null) : null);
  const passed = useMemo(() => SCENARIOS.filter((s) => evaluate(s.id, r.runEvents).status === 'passed').length, [r.runEvents]);

  return (
    <div className="tw-space-y-5">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-3">
          <span
            className="tw-flex tw-h-10 tw-w-10 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-card tw-bg-accent-soft tw-text-accent-ink"
            aria-hidden="true"
          >
            <Icon name="bank" size={20} />
          </span>
          <div className="tw-min-w-0">
            <p className="tw-m-0 tw-truncate tw-text-lg tw-font-semibold tw-text-ink">{r.bankName}</p>
            <p className="tw-m-0 tw-truncate tw-text-xs tw-text-muted">Virtual banking assistant · rule-based, answers only from the banking gateway</p>
          </div>
        </div>
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
          {/* said, never hidden: a test environment's balances must not be taken for real ones */}
          {call && <EnvironmentNotice hosts={call.hosts} policyApproved={channel.state?.policy_approved ?? true} />}
          {call && live && (
            <span className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-muted">
              <i className="tw-h-2 tw-w-2 tw-rounded-full tw-bg-accent" aria-hidden="true" />
              Session <code>{call.call_id.slice(10, 18)}</code>
            </span>
          )}
        </div>
      </div>

      <div
        ref={consoleRef}
        style={{ '--console-top': `${stickyTop}px` } as CSSProperties}
        className="tw-grid tw-scroll-mt-[calc(var(--console-top,0px)+12px)] tw-gap-6 lg:tw-h-[calc(100dvh-var(--console-top,0px)-24px)] lg:tw-min-h-[480px] lg:tw-grid-cols-[minmax(0,1fr)_400px] lg:tw-grid-rows-[minmax(0,1fr)]"
      >
        <ConversationPanel session={session} />

        <aside aria-label="Banking side panel" className="tw-flex tw-min-h-0 tw-min-w-0 tw-flex-col tw-gap-3">
          <OneOf className={segmentClass} label="Side panel" value={tab} onChange={(v) => setTab(v as SideTab)}>
            <Choice value="banking">Banking</Choice>
            <Choice value="scenarios">
              Scenarios {passed}/{SCENARIOS.length}
            </Choice>
            <Choice value="trace">Trace{session.records.length ? ` (${session.records.length})` : ''}</Choice>
          </OneOf>
          <div
            ref={sideRef}
            tabIndex={0}
            aria-label="Banking side panel content"
            className="tw-space-y-3 lg:tw-min-h-0 lg:tw-flex-1 lg:tw-overflow-y-auto lg:tw-pr-1"
          >
            {tab === 'banking' &&
              (live && call ? (
                <>
                  <div className={panelClass}>
                    <CallerPanel
                      channel={panelChannel}
                      heading="Secure banking"
                      showProfile={false}
                      showEnvironment={false}
                      preferredMethod={
                        assistant.identifierStep === 'phone_code' ? 'phonecode_pin' : assistant.identifierStep === 'account_number' ? 'account_nric_otp' : null
                      }
                      onAskForPerson={() => assistant.handle('I would like to speak to a Service Manager.', 'screen')}
                      onRequestCallback={() => assistant.handle('Please arrange a call back.', 'screen')}
                    />
                  </div>
                  {profile && (
                    <AccountOverview
                      callId={call.call_id}
                      profile={profile}
                      selected={assistant.selectedAccount}
                      balances={assistant.balances}
                      busy={assistant.thinking}
                      onSelect={assistant.selectAccount}
                      onCurrency={assistant.balanceIn}
                      onSignOut={() => void channel.restart()}
                      record={assistant.record}
                    />
                  )}
                  <MockPhone callId={call.call_id} />
                  <EntrySetting assistant={assistant} />
                </>
              ) : (
                <div className={panelClass}>
                  <h3 className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-md tw-font-semibold tw-text-ink">
                    <span className="tw-text-success">
                      <Icon name="shield" size={16} />
                    </span>
                    Secure banking
                  </h3>
                  <p className="tw-m-0 tw-mt-1 tw-text-sm tw-text-ink-soft">
                    Sign-in, the secure keypad, your accounts and confirmations appear here once the conversation starts.
                  </p>
                  <ul className="tw-mb-0 tw-mt-3 tw-space-y-2 tw-pl-5 tw-text-xs tw-text-muted">
                    <li>Verified by the banking gateway, never by the assistant.</li>
                    <li>PIN, NRIC and one-time passwords go only to secure entry.</li>
                    <li>Test logins are under Scenarios.</li>
                  </ul>
                </div>
              ))}
            {tab === 'scenarios' && (
              <>
                <ScenarioPanel events={r.runEvents} onReset={r.resetRunEvents} />
                {live && call && <HostFaults callId={call.call_id} />}
                {live && call && <ToolRunner callId={call.call_id} defaultAccountRef={defaultAccountRef} />}
              </>
            )}
            {tab === 'trace' && (
              <div className={panelClass}>
                <TraceView
                  records={session.records}
                  live={live}
                  compact
                  title="What happened"
                  emptyText={live ? 'Waiting for the first record…' : 'Start a conversation to see what the gateway does.'}
                  note="What was said, and what the banking gateway did (tools, sign-in, bank requests). No runtime or model took part."
                />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
