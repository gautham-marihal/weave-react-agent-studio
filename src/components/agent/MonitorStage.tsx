import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ListIcon,
  MessageSquareIcon,
  PhoneCallIcon,
  PhoneIcon,
  RefreshCwIcon,
  TableIcon,
} from 'lucide-react';
import type { DraftEditor } from '../../hooks/useDraftEditor';
import { Segmented } from '../ui/Segmented';
import { StatusChip } from '../ui/StatusChip';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
} from '../ui/accordion';
import { CallsTable, channelName, outcomeMeta } from '../calls/CallsTable';
import { formatDateTime, formatDuration, formatPercent, formatShortDate } from '../../utils/format';
import { api } from '../../api/client';
import { cn } from '../../utils/styles';
import type { CallRecord } from '../../types/studio';
import { agentPath, callPath } from '../../utils/routes';
import { useNewAlertCount } from '../../hooks/useAlerts';
import { AgentAlerts } from '../insights/AgentAlerts';
import { AlertsView } from '../insights/AlertsView';
import { MonitoringView } from '../insights/MonitoringView';
import { SpeedView } from '../insights/SpeedView';
import { summarizeCalls, toCallRecord } from '../../utils/callRecords';

type Period = '7' | '14' | '30';

type Scope = 'all' | 'live';

/** The API returns at most this many calls per request; the figures say when they rest on a capped list. */
const CALL_LIMIT = 50;

/** The calls tab: the period and scope filters, the numbers, and the recent calls as a list or a table. */
function MonitorCalls({ editor }: { editor: DraftEditor }) {
  const agent = editor.agent!;
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('7');
  const [scope, setScope] = useState<Scope>('all');

  const [fetchedCalls, setFetchedCalls] = useState<CallRecord[]>([]);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const realCalls = scope === 'live' ? fetchedCalls.filter((c) => c.environment !== 'test') : fetchedCalls;
  const [callsViewMode, setCallsViewMode] = useState<'accordion' | 'table'>('accordion');

  // Pagination for monitor calls
  const [callPage, setCallPage] = useState(1);
  const [callPageSize, setCallPageSize] = useState(5);

  // Calls in the chosen period (GET /calls?since=), newest first.
  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - Number(period) * 86_400_000).toISOString();
      const res = await api.listCalls(agent.id, { limit: CALL_LIMIT, since });
      setFetchedCalls(res.calls.map((c) => toCallRecord(c, agent.id)));
      setCapped(!!res.next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load the calls.');
    } finally {
      setLoading(false);
    }
  }, [agent.id, period]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  const summary = summarizeCalls(realCalls);
  const rate = (r: number | null) => (r === null ? '—' : formatPercent(r));
  const figures = [
    { key: 'calls', label: 'Calls', value: summary.calls.toLocaleString(), note: summary.inProgress ? `${summary.inProgress} still in progress` : undefined },
    { key: 'handover', label: 'Handed to a person', value: rate(summary.handoverRate), note: 'of calls that ended' },
    { key: 'cutoff', label: 'Cut off', value: rate(summary.cutoffRate), note: 'of calls that ended' },
    { key: 'tools', label: 'Tool failures', value: 'Not available yet', note: 'needs each call’s records' },
  ];

  const hasData = realCalls.length > 0;

  const totalCallPages = Math.max(1, Math.ceil(realCalls.length / callPageSize));
  const safeCallPage = Math.min(callPage, totalCallPages);
  const callStartIndex = (safeCallPage - 1) * callPageSize;
  const visibleCalls = realCalls.slice(callStartIndex, callStartIndex + callPageSize);


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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Which calls"
            options={[
              { value: 'all', label: 'All calls' },
              { value: 'live', label: 'Without test conversations' },
            ]}
            value={scope}
            onChange={setScope}
          />
          <Segmented
            label="Period"
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => void fetchCalls()} disabled={loading}>
          <RefreshCwIcon className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </div>

      {error ? (
        <div role="alert" className="mt-6 flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm">
          <p className="text-danger">Could not load the calls: {error}</p>
          <Button size="sm" variant="secondary" onClick={() => void fetchCalls()}>Try again</Button>
        </div>
      ) : !hasData && !loading ? (
        <div className="mt-6 rounded-xl border border-line bg-surface px-6 py-14 text-center">
          <p className="text-base font-medium text-ink">No calls for {agent.name} in the last {period} days</p>
          <p className="mt-1 text-sm text-muted">Test conversations and live calls show up here.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate(`/agents/${agent.id}/test`)}>
            Test this agent
          </Button>
        </div>
      ) : (
        <section aria-labelledby="health-title" className="mt-6 rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-6 py-5">
            <h2 id="health-title" className="sr-only">
              Health
            </h2>
            <p className="text-lg font-semibold text-ink">
              {realCalls.length} {realCalls.length === 1 ? 'call' : 'calls'} in the last {period} days
              {scope === 'live' ? ', without test conversations' : ''}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {capped
                ? `Only the newest ${CALL_LIMIT} calls are counted; there are more in this period.`
                : 'Every call in this period is counted.'}
              {realCalls.length > 0 && realCalls.length < 10 ? ' With this few calls, one call moves a share a lot.' : ''}
            </p>
          </div>
          <dl className="grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
            {figures.map((f) => (
              <div key={f.key} className="px-6 py-5">
                <dt className="text-xs font-medium text-muted">{f.label}</dt>
                <dd className="mt-1">
                  <span className={cn('font-semibold tracking-tight', f.key === 'tools' ? 'text-sm text-muted' : 'text-2xl text-ink')}>{f.value}</span>
                  {f.note && <span className="mt-0.5 block text-xs text-muted">{f.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {realCalls.length > 0 && (
        <section aria-labelledby="calls-title" className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 id="calls-title" className="text-sm font-semibold text-ink">
              Recent calls for {agent.name}
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-line bg-surface p-0.5">
                <Tooltip content="Accordion list view with reordering & expandable call logs" position="top">
                  <button
                    type="button"
                    onClick={() => setCallsViewMode('accordion')}
                    className={cn(
                      'p-1 rounded text-xs transition-colors',
                      callsViewMode === 'accordion' ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-ink'
                    )}
                    aria-label="Accordion view"
                  >
                    <ListIcon className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content="Table view" position="top">
                  <button
                    type="button"
                    onClick={() => setCallsViewMode('table')}
                    className={cn(
                      'p-1 rounded text-xs transition-colors',
                      callsViewMode === 'table' ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-ink'
                    )}
                    aria-label="Table view"
                  >
                    <TableIcon className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>

          {callsViewMode === 'table' ? (
            <div className="mt-3">
              <CallsTable calls={realCalls.slice(0, 10)} />
            </div>
          ) : (
            <div className="mt-3">
              <Accordion
                items={visibleCalls}
                pagination={{
                  page: safeCallPage,
                  pageSize: callPageSize,
                  totalItems: realCalls.length,
                  onPageChange: (p) => setCallPage(p),
                  onPageSizeChange: (s) => {
                    setCallPageSize(s);
                    setCallPage(1);
                  },
                  pageSizeOptions: [5, 10, 20],
                }}
              >
                {visibleCalls.map((call, idx) => {
                  const outcomeInfo = outcomeMeta[call.outcome];
                  const isFirst = idx === 0;
                  const isLast = idx === visibleCalls.length - 1;

                  return (
                    <AccordionItem
                      key={call.id}
                      id={call.id}
                      index={idx}
                      isFirst={isFirst}
                      isLast={isLast}
                    >
                      <AccordionHeader
                        id={call.id}
                        icon={getChannelIcon(call.channel)}
                        title={call.caller}
                        subtitle={
                          <span>
                            {formatShortDate(call.started_at)} · {formatDuration(call.duration_s)} ·{' '}
                            <span className="font-mono text-[11px]">{call.version}</span>
                          </span>
                        }
                        badge={
                          <div className="flex items-center gap-1.5">
                            <StatusChip tone={outcomeInfo.tone}>{outcomeInfo.label}</StatusChip>
                            <span className="text-[11px] rounded bg-subtle px-2 py-0.5 font-medium text-muted">
                              {channelName[call.channel]}
                            </span>
                          </div>
                        }
                        actions={
                          <Tooltip content="Inspect call transcript" position="top">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(callPath(call.agentId, call.id))}
                              className="h-8 px-2 text-xs"
                            >
                              <ExternalLinkIcon className="h-3.5 w-3.5 mr-1" />
                              <span>Details</span>
                            </Button>
                          </Tooltip>
                        }
                      />

                      <AccordionContent>
                        <div className="grid gap-6 md:grid-cols-[1.5fr_1fr]">
                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                              Summary
                            </h4>
                            <p className="mt-1.5 text-sm font-medium text-ink leading-relaxed">
                              {call.summary}
                            </p>
                            <div className="mt-4 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => navigate(callPath(call.agentId, call.id))}
                              >
                                <span>Open Full Transcript</span>
                                <ArrowRightIcon className="h-3.5 w-3.5 ml-1" />
                              </Button>
                              <a
                                href={api.downloadCallUrl(call.agentId, call.id)}
                                download={`${call.id}.ndjson`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle transition-colors"
                              >
                                <DownloadIcon className="h-3.5 w-3.5 text-muted" />
                                <span>Download Log</span>
                              </a>
                            </div>
                          </div>

                          <div className="rounded-lg border border-line bg-surface p-3 text-xs space-y-1.5">
                            <h4 className="font-semibold text-ink">Metadata</h4>
                            <div className="flex justify-between py-1 border-b border-line/50">
                              <span className="text-muted">ID:</span>
                              <span className="font-mono text-ink text-[11px]">{call.id.slice(0, 16)}…</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-line/50">
                              <span className="text-muted">Started:</span>
                              <span className="text-ink">{formatDateTime(call.started_at)}</span>
                            </div>
                            <div className="flex justify-between py-1">
                              <span className="text-muted">Environment:</span>
                              <span className="text-ink capitalize">{call.environment}</span>
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
type MonitorView = 'calls' | 'health' | 'speed' | 'alerts';
const VIEWS: { id: MonitorView; label: string }[] = [
  { id: 'calls', label: 'Calls' },
  { id: 'health', label: 'Health' },
  { id: 'speed', label: 'Speed' },
  { id: 'alerts', label: 'Alerts' },
];

/**
 * The agent's Monitor stage: its calls, how it is doing (Health), how fast it answers (Speed) and what is wrong now
 * (Alerts), each at /agents/:id/monitor[/health|/speed|/alerts]. What is wrong now also shows above every view.
 */
export function MonitorStage({ editor }: { editor: DraftEditor }) {
  const agent = editor.agent;
  const rest = (useParams()['*'] ?? '').split('/');
  const view: MonitorView = VIEWS.some((v) => v.id === rest[1]) ? (rest[1] as MonitorView) : 'calls';
  const agentId = agent?.id ?? '';
  const agentName = agent?.name ?? '';
  const bots = useMemo(() => (agentId ? [{ id: agentId, name: agentName }] : []), [agentId, agentName]);
  const fresh = useNewAlertCount([agentId]);
  if (!agent) return null;
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-10">
      <nav aria-label="Monitor" className="flex flex-wrap gap-1 border-b border-line">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            to={agentPath(agent.id, v.id === 'calls' ? 'monitor' : `monitor/${v.id}`)}
            aria-current={view === v.id ? 'page' : undefined}
            data-view={v.id}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              view === v.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {v.label}
            {v.id === 'alerts' && fresh > 0 && (
              <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold leading-4 text-white">
                {fresh}
                <span className="sr-only"> new</span>
              </span>
            )}
          </Link>
        ))}
      </nav>
      {view !== 'alerts' && (
        <div className="mt-5 empty:hidden">
          <AgentAlerts botId={agent.id} />
        </div>
      )}
      <div className="mt-5">
        {view === 'calls' && <MonitorCalls editor={editor} />}
        {view === 'health' && <MonitoringView bots={bots} agentOnly />}
        {view === 'speed' && <SpeedView bots={bots} agentOnly />}
        {view === 'alerts' && <AlertsView bots={bots} botId={agent.id} />}
      </div>
    </div>
  );
}
