import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PauseIcon, PlayIcon, RadioIcon, RefreshCwIcon } from 'lucide-react';
import { useStudio } from '../contexts/StudioContext';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { StatusChip } from '../components/ui/StatusChip';
import { AgentPicker } from '../components/calls/AgentPicker';
import { LiveCard } from '../components/live/LiveCard';
import { WatchPanel } from '../components/live/WatchPanel';
import { useLiveBoard } from '../hooks/useLiveBoard';
import { boardSummary, changesToAnnounce, clock, type LiveCall } from '../models/live';
import { channelLabel } from '../models/calls';
import { callPath } from '../utils/routes';
import { formatShortDate } from '../utils/format';
import { cn, inputClass, pageClass } from '../utils/styles';

// The Live board: every call in progress across the workspace, what needs a look first, plus the calls that ended in
// the last ten minutes. Calls are found by asking each agent (GET /bots/{id}/calls?status=in_progress) every few
// seconds and followed on their stream as they are said. It only watches: nothing here changes a call.

const PRIVATE_KEY = 'weave_live_private';
const readPrivate = (): boolean => {
  try {
    return localStorage.getItem(PRIVATE_KEY) === '1';
  } catch {
    return false;
  }
};

function ago(ms: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return 'just now';
  return `${Math.round(s / 60)} min ago`;
}

export function Live() {
  const { agents } = useStudio();
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);
  const [agent, setAgent] = useState('');
  const [channel, setChannel] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [hideCaller, setHideCaller] = useState(readPrivate);
  const [watching, setWatching] = useState<{ bot: string; id: string } | null>(null);
  const [allEnded, setAllEnded] = useState(false);
  const board = useLiveBoard(agents, { paused });
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name || a.id])), [agents]);

  const changePrivate = (on: boolean) => {
    setHideCaller(on);
    try {
      localStorage.setItem(PRIVATE_KEY, on ? '1' : '0');
    } catch {
      /* kept for this visit only */
    }
  };

  const live = board.calls.filter((c) => c.status === 'live');
  const ended = board.calls.filter((c) => c.status !== 'live').sort((a, b) => (b.endedAtMs || 0) - (a.endedAtMs || 0));
  const sum = boardSummary(board.calls);
  const channels = [...new Set(board.calls.map((c) => c.channel.type).filter(Boolean))];
  const matches = (c: LiveCall) => (!agent || c.bot === agent) && (!channel || c.channel.type === channel);
  const shown = live.filter((c) => matches(c) && (!onlyAttention || c.attention));
  const shownEnded = ended.filter(matches);
  const filtered = Boolean(agent || channel || onlyAttention);

  // what a screen reader hears: a new call, a call that needs a look, a call that ended (at most every few seconds)
  const [announce, setAnnounce] = useState('');
  const before = useRef<Record<string, LiveCall> | null>(null);
  const lastSaid = useRef(0);
  useEffect(() => {
    const now = Object.fromEntries(board.calls.map((c) => [c.key, c]));
    if (!before.current) {
      before.current = now;
      return;
    }
    // spoke a moment ago: held back, then compared with what was there when it last spoke, so nothing is missed
    if (Date.now() - lastSaid.current <= 4000) return;
    const said = changesToAnnounce(before.current, now, names);
    if (said.length) {
      setAnnounce(said.join('. '));
      lastSaid.current = Date.now();
    }
    before.current = now;
  }, [board.calls, names]);

  const open = watching ? board.calls.find((c) => c.bot === watching.bot && c.id === watching.id) ?? null : null;
  const openCall = (bot: string, id: string) => navigate(callPath(bot, id));
  // why it isn't watching: paused, no agent yet, or the tab is out of sight (it resumes when the tab is back)
  const status = paused
    ? 'Paused'
    : !agents.length
      ? 'No agents to watch yet'
      : !board.watching
        ? 'Waiting for the tab to be shown again'
        : board.checkedAt
          ? `Watching ${agents.length} agent${agents.length === 1 ? '' : 's'} · checked ${ago(Date.parse(board.checkedAt), board.nowMs)}`
          : 'Looking for calls…';
  const on = !paused && board.watching;

  return (
    <div className={pageClass}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Live</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Calls going on right now, as they are said, with what needs a look first. It only watches: nothing here changes a call.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="live-status" className={cn('inline-flex items-center gap-1.5 text-xs', on ? 'text-ink-soft' : 'text-muted')}>
            <span aria-hidden className={cn('h-2 w-2 rounded-full', on ? 'animate-pulse bg-success' : 'bg-line-strong')} />
            {status}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void board.refresh()} disabled={!on || board.checking}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', board.checking && 'animate-spin')} aria-hidden />
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <PlayIcon className="h-3.5 w-3.5" aria-hidden /> : <PauseIcon className="h-3.5 w-3.5" aria-hidden />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      {board.errors.map((e) => (
        <p key={e.botId} role="alert" className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink-soft">
          Could not check {names[e.botId] ?? e.botId}, so its calls may be missing: {e.message} It is tried again every few seconds.
        </p>
      ))}

      <div role="group" aria-label="Right now" className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums text-ink" data-testid="live-count">
            {sum.live}
          </p>
          <p className="text-xs text-muted">{sum.live === 1 ? 'Call now' : 'Calls now'}</p>
        </div>
        <button
          type="button"
          aria-pressed={onlyAttention}
          onClick={() => setOnlyAttention((v) => !v)}
          title="Show only the calls that need a look"
          className={cn(
            'rounded-xl border bg-surface px-4 py-3 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            onlyAttention ? 'border-accent' : 'border-line'
          )}
        >
          <p className={cn('text-2xl font-semibold tabular-nums', sum.attention ? 'text-danger' : 'text-ink')}>{sum.attention}</p>
          <p className="text-xs text-muted">{sum.attention === 1 ? 'Needs a look' : 'Need a look'}</p>
        </button>
        <a href="#live-ended" className="rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:bg-subtle">
          <p className="text-2xl font-semibold tabular-nums text-ink">{sum.ended}</p>
          <p className="text-xs text-muted">Ended in the last 10 min</p>
        </a>
      </div>

      <div role="group" aria-label="Filter the board" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <AgentPicker
          agents={agents.map((a) => ({ id: a.id, name: a.name, note: sum.byAgent[a.id] ? `${sum.byAgent[a.id].live} now` : undefined }))}
          value={agent}
          onChange={setAgent}
        />
        <select aria-label="Channel" className={cn(inputClass, 'w-auto py-1.5')} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          {channels.map((type) => (
            <option key={type} value={type}>
              {channelLabel({ type })}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-soft">
          <Toggle checked={onlyAttention} onChange={setOnlyAttention} label="Only what needs a look" />
          Only what needs a look
        </label>
        <label
          className="inline-flex items-center gap-2 text-[13px] text-ink-soft"
          title="For a screen others can see: callers’ words are hidden. Phone numbers always show only their last digits. Kept in this browser."
        >
          <Toggle checked={hideCaller} onChange={changePrivate} label="Hide what callers say" />
          Hide what callers say
          <span className="text-xs text-muted">(kept in this browser)</span>
        </label>
      </div>

      <section aria-labelledby="live-calls" className="mt-5">
        <h2 id="live-calls" className="sr-only">
          Calls in progress
        </h2>
        {shown.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="live-grid">
            {shown.map((c) => (
              <LiveCard
                key={c.key}
                call={c}
                name={names[c.bot] || c.bot}
                hideCaller={hideCaller}
                onWatch={(call) => setWatching({ bot: call.bot, id: call.id })}
                onOpen={(call) => openCall(call.bot, call.id)}
              />
            ))}
          </div>
        ) : !board.checkedAt && on ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-44 animate-pulse rounded-xl border border-line bg-subtle" />
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-line p-12 text-center">
            <RadioIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
            <p className="mt-2 text-sm font-medium text-ink">{live.length && filtered ? 'No call matches' : !agents.length ? 'No agents to watch' : 'No calls right now'}</p>
            <p className="mt-1 text-xs text-muted">
              {live.length && filtered
                ? `${live.length} call${live.length === 1 ? ' is' : 's are'} going on; none matches what is picked above.`
                : agents.length
                  ? 'A call shows here the moment it starts, and its words as they are said. This page checks every few seconds.'
                  : 'Create an agent, and its calls show here while they happen.'}
            </p>
          </div>
        )}
      </section>

      <section id="live-ended" aria-labelledby="live-ended-title" className="mt-8">
        <h2 id="live-ended-title" className="text-sm font-semibold text-ink">
          Ended in the last 10 minutes
        </h2>
        {shownEnded.length === 0 ? (
          <p className="mt-2 text-xs text-muted">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface" data-testid="live-ended">
            {shownEnded.slice(0, allEnded ? 60 : 8).map((c) => {
              const extra = c.flags.find((f) => f.tone !== 'info' && f.id !== 'cut_off') || c.flags.find((f) => f.id === 'handed_over');
              return (
                <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                  <StatusChip tone={c.status === 'cut_off' ? 'danger' : 'success'}>{c.status === 'cut_off' ? 'Cut off' : 'Ended'}</StatusChip>
                  <span className="font-medium text-ink">{names[c.bot] || c.bot}</span>
                  <span className="text-xs text-muted">
                    {channelLabel(c.channel)} · {clock(c.durationS)}
                    {extra ? ` · ${extra.label}` : ''}
                  </span>
                  <span className="ml-auto text-xs text-muted">{c.endedAtMs ? ago(c.endedAtMs, board.nowMs) : c.startedAt ? formatShortDate(c.startedAt) : ''}</span>
                  <button type="button" onClick={() => openCall(c.bot, c.id)} className="text-xs font-medium text-accent hover:underline">
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {shownEnded.length > 8 && (
          <button type="button" aria-expanded={allEnded} onClick={() => setAllEnded((v) => !v)} className="mt-2 text-xs font-medium text-accent hover:underline">
            {allEnded ? 'Show fewer' : `Show all ${shownEnded.length}`}
          </button>
        )}
      </section>

      <div className="sr-only" aria-live="polite" role="status" data-testid="live-announce">
        {announce}
      </div>

      {watching && (
        <WatchPanel
          key={`${watching.bot}/${watching.id}`}
          agentId={watching.bot}
          callId={watching.id}
          agentName={names[watching.bot] || watching.bot}
          card={open}
          hideCaller={hideCaller}
          onOpen={() => openCall(watching.bot, watching.id)}
          onClose={() => setWatching(null)}
        />
      )}
    </div>
  );
}
