import React, { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, DownloadIcon, RefreshCwIcon } from 'lucide-react';
import { useStudio } from '../contexts/StudioContext';
import { StatusChip } from '../components/ui/StatusChip';
import { channelName, outcomeMeta } from '../components/calls/CallsTable';
import { CallFacts, CallRecordBody } from '../components/calls/CallRecordBody';
import { CallActions } from '../components/replay/CallActions';
import { formatDateTime, formatDuration } from '../utils/format';
import { api } from '../api/client';
import { useSetBreadcrumbTitle } from '../contexts/BreadcrumbContext';
import { toCallRecord } from '../utils/callRecords';
import { outcomeHint } from '../models/calls';
import { useTraceRecords } from '../hooks/useTraceRecords';

// One call: who, when, how it went, and everything that happened in it (the same trace the Test stage shows). A call
// in progress is followed live. The records hold what the caller said.
export function CallDetail() {
  const { callId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { agents } = useStudio();

  // Which agent this call belongs to: the link says so (?agent=). Older links: a test room is named
  // test-<agent>-<hex>. Never a guess beyond that.
  const agentId = useMemo(() => {
    const fromLink = searchParams.get('agent');
    if (fromLink) return fromLink;
    const match = callId ? /^(?:test|session)-([a-z0-9_-]+)-[0-9a-f]+_/.exec(callId) : null;
    return match?.[1] ?? null;
  }, [callId, searchParams]);

  const data = useTraceRecords(agentId, callId ?? null);
  const call = useMemo(() => (data.call && agentId ? toCallRecord(data.call, agentId) : null), [data.call, agentId]);

  useSetBreadcrumbTitle(call ? `${call.caller} (${call.id.slice(0, 10)})` : null);

  const agent = agents.find((a) => a.id === (call?.agentId ?? agentId));
  const live = data.call?.status === 'in_progress';

  const handleBack = () => {
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof historyIndex === 'number' && historyIndex > 0) navigate(-1);
    else navigate('/calls', { replace: true });
  };

  if (!callId || !agentId) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-lg font-semibold text-ink">Call not found</h1>
        <p className="mt-1 text-sm text-muted">
          {callId ? 'This link does not say which agent the call belongs to. Open the call from the Calls list.' : 'Call record not found on the server.'}
        </p>
        <Link to="/calls" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Back to calls
        </Link>
      </div>
    );
  }

  if (data.loading) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <RefreshCwIcon className="mx-auto h-6 w-6 animate-spin text-muted" />
        <h1 className="mt-4 text-base font-semibold text-ink">Loading call details…</h1>
      </div>
    );
  }

  if (!call || !data.call) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-lg font-semibold text-ink">Call not found</h1>
        <p className="mt-1 text-sm text-muted">{data.error || 'Could not find this call record on the server.'}</p>
        <Link to="/calls" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          Back to calls
        </Link>
      </div>
    );
  }

  const envText =
    call.environment === 'test'
      ? 'Test conversation'
      : call.environment === 'other'
        ? `Ran on ${call.ref}`
        : call.environment.charAt(0).toUpperCase() + call.environment.slice(1);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-10">
      <button type="button" onClick={handleBack} className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            {call.caller}
            {live && (
              <StatusChip tone="success" dot>
                Live now
              </StatusChip>
            )}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
            <StatusChip tone={outcomeMeta[call.outcome].tone} title={outcomeHint(call.outcome, data.call.handoffs ?? 0)}>
              {outcomeMeta[call.outcome].label}
            </StatusChip>
            <span>{formatDateTime(call.started_at)}</span>
            <span>{formatDuration(call.duration_s)}</span>
            <span>{channelName[call.channel]}</span>
            <span>
              {envText} · <span className="font-mono">{call.version}</span>
            </span>
            {agent && (
              <Link to={`/agents/${agent.id}`} className="font-medium text-accent hover:underline">
                {agent.name}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Replay, fix this call, keep it as a test */}
          <CallActions agentId={call.agentId} callId={call.id} call={call} />
          <a
            href={api.downloadCallUrl(call.agentId, call.id)}
            download={`${call.id}.ndjson`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-subtle"
            title="Download the full call log (NDJSON)"
          >
            <DownloadIcon className="h-3.5 w-3.5 text-muted" />
            Download NDJSON
          </a>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
        <section aria-label="The call’s records" className="min-w-0">
          <CallRecordBody agentId={call.agentId} callId={call.id} data={data} agentName={agent?.name} callerName={call.caller} />
        </section>

        <aside aria-labelledby="meta-title" className="space-y-6">
          <div className="rounded-xl border border-line bg-surface p-5">
            <h2 id="meta-title" className="text-sm font-semibold text-ink">
              Call metadata
            </h2>
            <CallFacts call={data.call} data={data} className="mt-4 space-y-3 text-xs" />
            <dl className="mt-3 space-y-3 text-xs">
              <div>
                <dt className="text-muted">Room / ID</dt>
                <dd className="mt-0.5 break-all font-mono text-ink">{call.id}</dd>
              </div>
              <div>
                <dt className="text-muted">Started</dt>
                <dd className="mt-0.5 text-ink">{formatDateTime(call.started_at)}</dd>
              </div>
              <div>
                <dt className="text-muted">Agent</dt>
                <dd className="mt-0.5 text-ink">{agent?.name ?? call.agentId}</dd>
              </div>
              <div>
                <dt className="text-muted">Environment</dt>
                <dd className="mt-0.5 text-ink">{envText}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
