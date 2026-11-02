import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CallChannel, CallOutcome, CallRecord } from '../../types/studio';
import { StatusChip, type ChipTone } from '../ui/StatusChip';
import { formatDuration, formatShortDate } from '../../utils/format';
import { callPath } from '../../utils/routes';

interface CallsTableProps {
  calls: CallRecord[];
  agentNames?: Record<string, string>;
}

export const outcomeMeta: Record<CallOutcome, {label: string;tone: ChipTone;}> = {
  resolved: { label: 'Resolved', tone: 'success' },
  handed_over: { label: 'Handed over', tone: 'info' },
  cut_off: { label: 'Cut off', tone: 'danger' },
  in_progress: { label: 'In progress', tone: 'neutral' }
};

export const channelName: Record<CallChannel, string> = { phone: 'Phone', web_chat: 'Web chat', web_voice: 'Web voice' };

export function CallsTable({ calls, agentNames }: CallsTableProps) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="px-4 py-2.5 font-medium">Started</th>
            {agentNames && <th scope="col" className="px-4 py-2.5 font-medium">Agent</th>}
            <th scope="col" className="px-4 py-2.5 font-medium">Caller</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Channel</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Where</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Length</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) =>
          <tr key={c.id} onClick={() => navigate(callPath(c.agentId, c.id))} className="cursor-pointer border-b border-line transition-colors duration-150 last:border-0 hover:bg-canvas">
              <td className="whitespace-nowrap px-4 py-3">
                <Link to={callPath(c.agentId, c.id)} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:underline">
                  {formatShortDate(c.started_at)}
                </Link>
              </td>
              {agentNames && <td className="px-4 py-3 text-ink-soft">{agentNames[c.agentId] ?? c.agentId}</td>}
              <td className="px-4 py-3">
                <p className="text-ink">{c.caller}</p>
                <p className="max-w-[260px] truncate text-xs text-muted">{c.summary}</p>
              </td>
              <td className="px-4 py-3 text-ink-soft">{channelName[c.channel]}</td>
              <td className="px-4 py-3">
                <span className="text-ink-soft">{c.environment === 'test' ? 'Test' : c.environment.charAt(0).toUpperCase() + c.environment.slice(1)}</span>{' '}
                <span className="font-mono text-xs text-muted">{c.version}</span>
              </td>
              <td className="px-4 py-3 text-ink-soft">{formatDuration(c.duration_s)}</td>
              <td className="px-4 py-3">
                <StatusChip tone={outcomeMeta[c.outcome].tone}>{outcomeMeta[c.outcome].label}</StatusChip>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>);

}