import React, { useMemo, useState } from 'react';
import { RefreshCwIcon } from 'lucide-react';
import type { CallSummaryItem } from '../../api/types';
import { useTraceRecords, CAP, type TraceRecords } from '../../hooks/useTraceRecords';
import { callerHint, channelLabel, countsLine, formatSeconds, statusOf, tokensOf } from '../../models/calls';
import { conversationOf, describeRecords } from '../../models/trace';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { StatusChip } from '../ui/StatusChip';
import { ConversationView } from './ConversationView';
import { TraceView } from './TraceView';

// The facts of one call, in a definition list: status, channel, caller, length, turns, version, model use.
export function CallFacts({ call, data, className }: { call: CallSummaryItem; data: Pick<TraceRecords, 'usage'>; className?: string }) {
  const status = statusOf(call.status);
  const tokens = tokensOf(data.usage);
  const rows: Array<[string, React.ReactNode]> = [
    ['Status', <StatusChip key="s" tone={status.tone} title={status.hint}>{status.label}</StatusChip>],
    ['Channel', channelLabel(call.channel) || '—'],
    ['Caller', call.caller || callerHint(call.channel)],
    ...(call.dialled ? [['Number dialled', call.dialled] as [string, React.ReactNode]] : []),
    ['Duration', formatSeconds(call.duration_s) || '—'],
    ['Turns', `${call.caller_turns ?? 0} from the caller, ${call.agent_turns ?? 0} from the agent`],
    ['Version', `${call.version || '—'}${call.ref && call.ref !== call.version ? ` (${call.ref})` : ''}`],
    ...(tokens.input || tokens.output ? [['Model use', `${tokens.input.toLocaleString()} in · ${tokens.output.toLocaleString()} out tokens`] as [string, React.ReactNode]] : []),
  ];
  return (
    <dl className={className ?? 'grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4'}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className="mt-0.5 break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const CONVERSATION_KINDS = ['user_said', 'agent_said'];

// A call's records two ways: everything that happened (the trace), or only what was said. Shared by a call's page and
// the Live board's Watch panel. `data` comes from useTraceRecords.
export function CallRecordBody({
  agentId,
  callId,
  data,
  agentName,
  callerName,
  hideCaller = false,
}: {
  agentId: string;
  callId: string;
  data: TraceRecords;
  agentName?: string;
  callerName?: string;
  hideCaller?: boolean;
}) {
  const [view, setView] = useState<'trace' | 'conversation'>('trace');
  const rows = useMemo(() => describeRecords(data.records), [data.records]);
  // with every record read, the conversation is lifted out of them; past the cap it is read on its own (kinds=…)
  const conversationOnly = useTraceRecords(agentId, callId, { kinds: CONVERSATION_KINDS, enabled: view === 'conversation' && data.truncated });
  const lines = useMemo(
    () => conversationOf(data.truncated ? conversationOnly.records : data.records),
    [data.truncated, conversationOnly.records, data.records]
  );
  const counts = countsLine(data.counts);

  if (data.loading) {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
        <RefreshCwIcon className="h-4 w-4 animate-spin" aria-hidden /> Reading the call…
      </p>
    );
  }
  if (data.error && !data.records.length) {
    return (
      <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        This call couldn’t be read. {data.error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {data.finalState && Object.keys(data.finalState).length > 0 && (
        <p className="text-xs text-muted">
          Final state: <code className="break-all font-mono text-ink-soft">{JSON.stringify(data.finalState)}</code>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="How to read this call"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'trace', label: 'What happened' },
            { value: 'conversation', label: 'Conversation' },
          ]}
        />
        {counts && <p className="text-xs text-muted">{counts}</p>}
      </div>

      {data.truncated && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-ink-soft">
          <span>
            Showing the first {data.records.length.toLocaleString()} records. This call has more; read the next {CAP.toLocaleString()}, or download the log for all
            of it.
          </span>
          <Button size="sm" variant="secondary" onClick={data.loadMore} disabled={data.loadingMore}>
            {data.loadingMore ? 'Reading…' : 'Load more records'}
          </Button>
        </div>
      )}
      {data.followProblem && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-4 py-2.5 text-xs text-ink-soft">
          <span>{data.followProblem}</span>
          <Button size="sm" variant="secondary" onClick={data.followAgain}>
            Follow again
          </Button>
        </div>
      )}

      {view === 'trace' ? (
        <TraceView
          rows={rows}
          live={data.following}
          title="What happened"
          emptyText="No records were written for this call."
          hideCaller={hideCaller}
          note="These records hold what the caller said. Anyone who can open Studio can read them."
        />
      ) : data.truncated && conversationOnly.loading ? (
        <p role="status" className="py-6 text-sm text-muted">
          Reading the conversation…
        </p>
      ) : (
        <ConversationView lines={lines} agentName={agentName} callerName={callerName} hideCaller={hideCaller} />
      )}
    </div>
  );
}
