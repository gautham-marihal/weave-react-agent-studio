import React from 'react';
import { EyeIcon, MessageSquareIcon, MicIcon, PhoneIcon } from 'lucide-react';
import { channelLabel } from '../../models/calls';
import { clock, hiddenWords, type FlagTone, type LiveCall } from '../../models/live';
import { humanize } from '../../models/trace';
import { Button } from '../ui/Button';
import { cn } from '../../utils/styles';

const FLAG_TONE: Record<FlagTone, string> = {
  bad: 'bg-danger-soft text-danger',
  warn: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
};
const CARD_TONE: Record<string, string> = {
  bad: 'border-danger/50 shadow-[inset_3px_0_0_rgb(var(--danger))]',
  warn: 'border-warning/50 shadow-[inset_3px_0_0_rgb(var(--warning))]',
};

function ChannelIcon({ type }: { type: string }) {
  const Icon = type === 'web_chat' || type === 'whatsapp' || type === 'sms' ? MessageSquareIcon : type === 'web_voice' ? MicIcon : PhoneIcon;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}

// One call going on: who, where, how long, what needs a look, and the last few lines as they are said.
export function LiveCard({
  call,
  name,
  hideCaller,
  onWatch,
  onOpen,
}: {
  call: LiveCall;
  name: string;
  hideCaller: boolean;
  onWatch: (call: LiveCall) => void;
  onOpen: (call: LiveCall) => void;
}) {
  const lines = call.lines.slice(-3);
  const who = call.caller || (call.voice ? 'A caller' : 'A web visitor');
  const agentName = humanize(call.agent || 'agent');
  return (
    <article
      aria-label={`${name}: call from ${who}, ${clock(call.durationS)}`}
      data-attention={call.attention ? call.worst : undefined}
      className={cn('flex flex-col rounded-xl border border-line bg-surface shadow-panel', call.attention && CARD_TONE[call.worst])}
    >
      <header className="flex items-center gap-2 px-4 pt-3.5">
        <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-success" />
        <strong className="min-w-0 truncate text-sm font-semibold text-ink" data-testid="live-agent">
          {name}
        </strong>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
          <ChannelIcon type={call.channel.type} />
          {channelLabel(call.channel) || 'Call'}
        </span>
        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-ink-soft" title="How long it has run" data-testid="live-time">
          {clock(call.durationS)}
        </span>
      </header>
      <p className="px-4 pt-0.5 text-xs text-muted">
        {who}
        {call.agent ? (
          <>
            {' '}
            · with <span className="font-medium text-ink-soft">{agentName}</span>
          </>
        ) : null}
      </p>

      {call.flags.length > 0 && (
        <ul aria-label="What to know" className="flex flex-wrap gap-1.5 px-4 pt-2.5">
          {call.flags.slice(0, 3).map((f) => (
            <li key={f.id} title={f.detail || undefined} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', FLAG_TONE[f.tone])}>
              {f.label}
            </li>
          ))}
          {call.flags.length > 3 && <li className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">+{call.flags.length - 3}</li>}
        </ul>
      )}

      <ol aria-label="The last things said" className="mt-3 flex-1 space-y-1.5 border-t border-line px-4 py-3">
        {call.loading && !lines.length && <li className="text-xs text-muted">Reading the call…</li>}
        {!call.loading && !lines.length && <li className="text-xs text-muted">Just started: nothing said yet.</li>}
        {lines.map((l) => (
          <li key={l.seq} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[13px]" data-who={l.who}>
            <span className={cn('truncate text-xs font-medium', l.who === 'caller' ? 'text-info' : 'text-accent')}>
              {l.who === 'caller' ? 'Caller' : humanize(l.agent || call.agent || 'agent')}
            </span>
            <span className="line-clamp-2 text-ink" data-testid="live-line">
              {l.who === 'caller' && hideCaller ? <i className="text-muted">{hiddenWords(l)}</i> : l.text}
            </span>
          </li>
        ))}
        {call.thinking && (
          <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[13px]" aria-label="The agent is answering">
            <span className="truncate text-xs font-medium text-accent">{agentName}</span>
            <span aria-hidden className="flex items-center gap-1 pt-1">
              {[0, 150, 300].map((delay) => (
                <i key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
          </li>
        )}
      </ol>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => onWatch(call)}>
          <EyeIcon className="h-3.5 w-3.5" aria-hidden />
          Watch
        </Button>
        <button type="button" onClick={() => onOpen(call)} className="text-xs font-medium text-accent hover:underline">
          Open call
        </button>
      </footer>
    </article>
  );
}
