import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ListIcon,
  MessageSquareIcon,
  PhoneCallIcon,
  PhoneIcon,
  RefreshCwIcon,
  SearchIcon,
  TableIcon,
} from 'lucide-react';
import { useStudio } from '../contexts/StudioContext';
import { CallsTable, channelName, outcomeMeta } from '../components/calls/CallsTable';
import { AgentPicker } from '../components/calls/AgentPicker';
import { Button } from '../components/ui/Button';
import { StatusChip } from '../components/ui/StatusChip';
import { Tooltip } from '../components/ui/Tooltip';
import { Accordion, AccordionContent, AccordionHeader, AccordionItem } from '../components/ui/accordion';
import { formatDateTime, formatDuration, formatShortDate } from '../utils/format';
import { cn, inputClass, pageClass } from '../utils/styles';
import { api } from '../api/client';
import type { CallChannel, CallOutcome } from '../types/studio';
import { callPath } from '../utils/routes';
import { toCallRecord } from '../utils/callRecords';
import { ALL_AGENTS_LIMIT, OUTCOME_STATUS, RANGES, channelLabel, channelsIn, isRange, outcomeHint } from '../models/calls';
import { useCalls } from '../hooks/useCalls';
import { isSandbox } from '../sandbox/mode';
import { SandboxNoteSlot } from '../sandbox/test/SandboxNoteSlot';
import { currentSearchParams } from '../utils/searchParams';

// Every call of one agent, or of all of them: who, when, how long, how it went. The time range, outcome, channel and
// caller are asked of the server (GET /bots/{id}/calls); older calls come with "Load more". The environment and the
// kind of channel narrow what was read. Opening a call shows everything that happened in it.

const CHANNEL_KINDS = Object.keys(channelName) as CallChannel[];
const isChannelKind = (v: string): v is CallChannel => (CHANNEL_KINDS as string[]).includes(v);
const isOutcome = (v: string): v is CallOutcome => v in outcomeMeta;

/** A value that changes only once it has stopped changing for `ms` (typing a number). */
function useSettled<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function Calls() {
  const { agents, loading: agentsLoading } = useStudio();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const agent = params.get('agent') ?? '';
  const rangeParam = params.get('range');
  const range = isRange(rangeParam) ? rangeParam : '7d';
  const channel = params.get('channel') ?? '';
  const outcomeParam = params.get('outcome') ?? '';
  const outcome = isOutcome(outcomeParam) ? outcomeParam : '';
  const env = params.get('env') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Number(params.get('size') ?? '10') || 10;
  const [viewMode, setViewMode] = useState<'accordion' | 'table'>('accordion');
  // the caller box is typed into; the server is asked once typing stops
  const [callerText, setCallerText] = useState(params.get('caller') ?? '');
  const caller = useSettled(callerText.trim());

  const setParam = (changes: Record<string, string>) => {
    const next = currentSearchParams();
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('caller') ?? '') !== caller) setParam({ caller });
    // only when the settled text changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caller]);

  const agentIds = useMemo(() => agents.map((a) => a.id), [agents]);
  const agentNames = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const filters = useMemo(
    () => ({
      range,
      caller,
      // a kind of channel (Phone, Web chat, Web voice) narrows what was read; a channel by its id is asked of the server
      channel: channel && !isChannelKind(channel) ? channel : '',
      status: outcome ? OUTCOME_STATUS[outcome] : '',
    }),
    [range, caller, channel, outcome]
  );
  const list = useCalls({ agentIds, agentId: agent, filters });

  const records = useMemo(() => list.calls.map((c) => toCallRecord(c, c.bot || agent)), [list.calls, agent]);
  const handoffsById = useMemo(() => Object.fromEntries(list.calls.map((c) => [`${c.bot}/${c.id}`, c.handoffs ?? 0])), [list.calls]);
  const channels = useMemo(() => channelsIn(list.calls), [list.calls]);

  // newest first, as the server sends them
  const filtered = useMemo(
    () =>
      records
        // resolved and handed over are both "ended" to the server: told apart here by hand-overs
        .filter((c) => !outcome || c.outcome === outcome)
        .filter((c) => !channel || !isChannelKind(channel) || c.channel === channel)
        .filter((c) => !env || c.environment === env),
    [records, outcome, channel, env]
  );

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const startIndex = (safePage - 1) * pageSize;
  const visible = filtered.slice(startIndex, startIndex + pageSize);
  const selectCls = cn(inputClass, 'w-auto py-1.5');
  const narrowed = Boolean(outcome || channel || caller || env);

  const getChannelIcon = (ch: string) => {
    switch (ch) {
      case 'phone':
        return <PhoneIcon className="h-4 w-4 text-accent" />;
      case 'web_chat':
        return <MessageSquareIcon className="h-4 w-4 text-info" />;
      default:
        return <PhoneCallIcon className="h-4 w-4 text-success" />;
    }
  };

  const rangeLabel = (RANGES.find((r) => r.id === range)?.label ?? '').toLowerCase();
  const emptyTitle = agents.length === 0 ? 'No calls yet' : narrowed ? 'No calls match these filters' : 'No calls found';
  const emptyText =
    agents.length === 0
      ? 'Once you have an agent, every conversation it has is listed here, with what was said and what the agent did.'
      : narrowed
        ? 'Clear a filter or try a longer time range.'
        : range !== 'all'
          ? `Nothing in the ${rangeLabel}. Try a longer time range. Trying an agent out makes a call too.`
          : 'Nothing has called yet. Trying an agent out makes a call too.';

  const loadMoreBar = list.hasMore && (
    <div className="mt-4 flex flex-col items-center gap-1">
      <Button variant="secondary" size="sm" onClick={list.loadMore} disabled={list.loadingMore}>
        {list.loadingMore && <RefreshCwIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        {list.loadingMore ? 'Loading…' : 'Load more calls'}
      </Button>
      <p className="text-xs text-muted">Older calls in the {rangeLabel || 'range'} are still on the server.</p>
    </div>
  );

  return (
    <div className={pageClass}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Calls</h1>
          <p className="mt-1 text-sm text-muted">
            {isSandbox() ? 'Sample calls kept in this browser, and the test conversations you had in Sandbox.' : 'Live and recorded conversations from the Agent Builder API.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-line bg-surface p-0.5">
            <Tooltip content="A list whose rows open to show each call" position="top">
              <button
                type="button"
                onClick={() => setViewMode('accordion')}
                aria-pressed={viewMode === 'accordion'}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  viewMode === 'accordion' ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                <ListIcon className="h-3.5 w-3.5" />
                <span>Accordions</span>
              </button>
            </Tooltip>
            <Tooltip content="Compact table grid view" position="top">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-pressed={viewMode === 'table'}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  viewMode === 'table' ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                <TableIcon className="h-3.5 w-3.5" />
                <span>Table</span>
              </button>
            </Tooltip>
          </div>

          <Button variant="secondary" size="sm" onClick={list.reload} disabled={list.loading || list.refreshing}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', (list.loading || list.refreshing) && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <p role="note" className="mt-4 text-xs text-muted">
        These records hold what callers said. Anyone who can open Studio can read every call of every agent.
      </p>
      <SandboxNoteSlot kind="calls" className="mt-2" />

      <div role="group" aria-label="Filter the calls" className="mt-4 flex flex-wrap items-center gap-2">
        <AgentPicker
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
          value={agent}
          onChange={(id) => setParam({ agent: id })}
          allLabel={agents.length > ALL_AGENTS_LIMIT ? `All agents (the first ${ALL_AGENTS_LIMIT})` : 'All agents'}
        />
        <select aria-label="When" className={selectCls} value={range} onChange={(e) => setParam({ range: e.target.value === '7d' ? '' : e.target.value })}>
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select aria-label="Outcome" className={selectCls} value={outcome} onChange={(e) => setParam({ outcome: e.target.value })}>
          <option value="">All outcomes</option>
          {Object.entries(outcomeMeta).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select aria-label="Channel" className={selectCls} value={channel} onChange={(e) => setParam({ channel: e.target.value })}>
          <option value="">All channels</option>
          <optgroup label="Kind of channel">
            {CHANNEL_KINDS.map((k) => (
              <option key={k} value={k}>
                {channelName[k]}
              </option>
            ))}
          </optgroup>
          {(channels.length > 0 || (channel && !isChannelKind(channel))) && (
            <optgroup label="Channel">
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                  {c.type ? ` (${channelLabel({ type: c.type })})` : ''}
                </option>
              ))}
              {channel && !isChannelKind(channel) && !channels.some((c) => c.id === channel) && <option value={channel}>{channel}</option>}
            </optgroup>
          )}
        </select>
        <select aria-label="Environment" className={selectCls} value={env} onChange={(e) => setParam({ env: e.target.value })}>
          <option value="">All environments</option>
          <option value="production">Production</option>
          <option value="staging">Staging</option>
          <option value="development">Development</option>
          <option value="test">Test conversations</option>
        </select>
        <div className="relative w-full max-w-[13rem]">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Caller"
            inputMode="tel"
            value={callerText}
            onChange={(e) => setCallerText(e.target.value)}
            placeholder="Caller’s number"
            className={cn(inputClass, 'py-1.5 pl-9')}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 font-medium text-muted">Saved filters:</span>
        {[
          { label: 'All', on: !outcome && !channel, set: { outcome: '', channel: '' } },
          { label: 'Handovers only', on: outcome === 'handed_over', set: { outcome: 'handed_over', channel: '' } },
          { label: 'Cut off only', on: outcome === 'cut_off', set: { outcome: 'cut_off', channel: '' } },
          { label: 'Web voice calls', on: channel === 'web_voice', set: { channel: 'web_voice', outcome: '' } },
        ].map((chip) => (
          <button
            key={chip.label}
            type="button"
            aria-pressed={chip.on}
            onClick={() => setParam(chip.set)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 font-medium transition-colors',
              chip.on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-soft hover:bg-subtle'
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {list.skipped > 0 && (
        <p role="note" className="mt-6 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-xs text-ink-soft">
          Showing the first {ALL_AGENTS_LIMIT} agents. The API lists calls one agent at a time, so “All agents” asks each one. Choose an agent to see the
          others.
        </p>
      )}
      {list.errors.length > 0 && (
        <p role="alert" className="mt-6 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink-soft">
          Calls for {list.errors.map((e) => agentNames[e.botId] ?? e.botId).join(', ')} could not be loaded, so this list is incomplete. (
          {list.errors[0].message})
        </p>
      )}

      {/* while another list is read (a filter changed) the last one stays, dimmed */}
      <div
        aria-busy={list.loading || list.refreshing || undefined}
        data-testid="calls-list"
        className={cn('transition-opacity duration-150', list.refreshing && 'pointer-events-none opacity-50')}
      >
        {(list.loading || agentsLoading) && records.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-lg border border-line bg-surface p-12 text-center">
            <p className="text-sm font-medium text-ink">Loading calls from API…</p>
          </div>
        ) : filtered.length === 0 ? (
          <>
            <div className="mt-6 rounded-lg border border-line bg-surface p-12 text-center">
              <p className="text-sm font-medium text-ink">{emptyTitle}</p>
              <p className="mt-1 text-xs text-muted">{emptyText}</p>
            </div>
            {loadMoreBar}
          </>
        ) : viewMode === 'table' ? (
          <>
            <div className="mt-4">
              <CallsTable calls={visible} agentNames={agentNames} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
              <span>
                Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filtered.length)} of {filtered.length} calls{list.hasMore ? ' read so far' : ''}
              </span>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Calls per page"
                  className={cn(inputClass, 'w-auto py-1 text-xs')}
                  value={pageSize}
                  onChange={(e) => setParam({ size: e.target.value, page: '' })}
                >
                  {[5, 10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n} per page
                    </option>
                  ))}
                </select>
                {pages > 1 && (
                  <>
                    <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setParam({ page: String(safePage - 1) })} aria-label="Previous page">
                      <ChevronLeftIcon className="h-4 w-4" />
                    </Button>
                    <span className="px-2 font-medium text-ink">
                      {safePage} / {pages}
                    </span>
                    <Button size="sm" variant="secondary" disabled={safePage >= pages} onClick={() => setParam({ page: String(safePage + 1) })} aria-label="Next page">
                      <ChevronRightIcon className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            {loadMoreBar}
          </>
        ) : (
          <div className="mt-5">
            <Accordion
              items={visible}
              enableReordering={false}
              enableDragAndDrop={false}
              pagination={{
                page: safePage,
                pageSize,
                totalItems: filtered.length,
                onPageChange: (p: number) => setParam({ page: String(p) }),
                onPageSizeChange: (n: number) => setParam({ size: String(n), page: '' }),
                pageSizeOptions: [5, 10, 20, 50],
              }}
            >
              {visible.map((call, idx) => {
                const agentName = agentNames[call.agentId] ?? call.agentId;
                const outcomeInfo = outcomeMeta[call.outcome];
                return (
                  <AccordionItem key={call.id} id={call.id} index={idx} isFirst={idx === 0} isLast={idx === visible.length - 1}>
                    <AccordionHeader
                      id={call.id}
                      icon={getChannelIcon(call.channel)}
                      title={call.caller}
                      subtitle={
                        <span>
                          {agentName} · {formatShortDate(call.started_at)} · {formatDuration(call.duration_s)} ·{' '}
                          <span className="font-mono text-[11px]">{call.version}</span>
                        </span>
                      }
                      badge={
                        <div className="flex items-center gap-1.5">
                          <StatusChip tone={outcomeInfo.tone} title={outcomeHint(call.outcome, handoffsById[`${call.agentId}/${call.id}`])}>
                            {outcomeInfo.label}
                          </StatusChip>
                          <span className="rounded bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">{channelName[call.channel]}</span>
                        </div>
                      }
                      actions={
                        <Tooltip content="Open call detail view" position="top">
                          <Button size="sm" variant="ghost" onClick={() => navigate(callPath(call.agentId, call.id))} className="h-8 px-2 text-xs">
                            <ExternalLinkIcon className="mr-1 h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Details</span>
                          </Button>
                        </Tooltip>
                      }
                    />

                    <AccordionContent>
                      <div className="grid gap-6 md:grid-cols-[1.5fr_1fr]">
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Call Summary</h4>
                          <p className="mt-1.5 text-sm font-medium leading-relaxed text-ink">{call.summary}</p>

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="primary" onClick={() => navigate(callPath(call.agentId, call.id))}>
                              <span>Open Transcript</span>
                              <ArrowRightIcon className="ml-1 h-3.5 w-3.5" />
                            </Button>
                            <a
                              href={api.downloadCallUrl(call.agentId, call.id)}
                              download={`${call.id}.ndjson`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-subtle"
                              title="Download full NDJSON call log"
                            >
                              <DownloadIcon className="h-3.5 w-3.5 text-muted" />
                              <span>Download NDJSON</span>
                            </a>
                          </div>
                        </div>

                        <div className="space-y-2 rounded-lg border border-line bg-surface/70 p-4 text-xs">
                          <h4 className="font-semibold text-ink">Metadata</h4>
                          <div className="flex justify-between border-b border-line/50 py-1">
                            <span className="text-muted">Room / ID:</span>
                            <span className="max-w-[150px] truncate font-mono text-[11px] text-ink">{call.id}</span>
                          </div>
                          <div className="flex justify-between border-b border-line/50 py-1">
                            <span className="text-muted">Timestamp:</span>
                            <span className="text-ink">{formatDateTime(call.started_at)}</span>
                          </div>
                          <div className="flex justify-between border-b border-line/50 py-1">
                            <span className="text-muted">Duration:</span>
                            <span className="font-medium text-ink">{formatDuration(call.duration_s)}</span>
                          </div>
                          <div className="flex justify-between py-1">
                            <span className="text-muted">Environment:</span>
                            <span className="font-medium capitalize text-ink">{call.environment}</span>
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
            {loadMoreBar}
          </div>
        )}
      </div>
    </div>
  );
}
