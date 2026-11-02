import { useState } from 'react';
import { CheckCircle2Icon, ChevronDownIcon, CircleAlertIcon, CircleHelpIcon, RefreshCwIcon, XCircleIcon } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { cn } from '../../utils/styles';
import { API_BASE } from '../../api/client';
import type { HealthCheck, HealthState } from '../../utils/health';
import { useApiHealth } from '../../hooks/useApiHealth';
import { useLiveKitStatus, type LiveKitStatus } from '../../hooks/useLiveKitStatus';

const pillTone: Record<HealthState, string> = {
  unknown: 'border-line bg-subtle text-muted hover:bg-subtle/80',
  healthy: 'border-success/30 bg-success-soft text-success hover:bg-success-soft/80',
  degraded: 'border-warning/40 bg-warning-soft text-warning hover:bg-warning-soft/80',
  down: 'border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/80',
};

const dotTone: Record<HealthState, string> = {
  unknown: 'bg-muted',
  healthy: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-danger',
};

function pillText(check: HealthCheck, checking: boolean): string {
  if (check.state === 'unknown') return checking ? 'Checking API…' : 'API not checked';
  if (check.state === 'healthy') return `API OK · ${check.latencyMs} ms`;
  if (check.state === 'degraded') return 'API has a problem';
  return 'API unreachable';
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The API's state in the top bar, with details. The same answer feeds the strips across every page (hooks/useApiHealth). */
export function SystemHealthIndicator() {
  const [open, setOpen] = useState(false);
  const { check, checking, recheck: runCheck } = useApiHealth();
  const livekit = useLiveKitStatus();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-w-[8.5rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          pillTone[check.state]
        )}
        title="Is the Agent Builder API answering? Click for details."
        aria-label={`API status: ${pillText(check, checking)}. Show details.`}
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotTone[check.state], checking && 'animate-pulse')} aria-hidden />
        <span className="tabular-nums">{pillText(check, checking)}</span>
        <ChevronDownIcon className="h-3 w-3 opacity-60" aria-hidden />
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="System status"
        description="What the Studio could check from this browser, and when."
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => void runCheck()} disabled={checking}>
              <RefreshCwIcon className={cn('h-3.5 w-3.5', checking && 'animate-spin')} aria-hidden />
              Check again
            </Button>
            <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="divide-y divide-line rounded-lg border border-line bg-surface" aria-live="polite">
          <StatusRow
            state={check.state}
            title="Agent Builder API"
            technical={`GET ${API_BASE}/health`}
            detail={
              check.state === 'unknown'
                ? checking
                  ? 'Checking…'
                  : check.detail
                : `${check.detail} Checked at ${timeOf(check.checkedAt ?? Date.now())}.`
            }
            badge={check.latencyMs !== null ? `${check.latencyMs} ms` : undefined}
            loading={checking && check.state === 'unknown'}
          />
          <StatusRow {...liveKitRow(livekit)} title="Voice and chat rooms (LiveKit)" technical="POST /bots/{id}/sessions, then joining the room" />
        </div>

        {check.state === 'down' && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs">
            <p className="font-semibold text-danger">The API is not answering</p>
            <p className="mt-1 text-ink-soft">
              Saving drafts, publishing and test conversations will fail until it does. The API address is set on the server
              (<code className="font-mono">AGENT_BUILDER_URL</code>); this browser talks to it through{' '}
              <code className="font-mono">{API_BASE}</code>.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}

function liveKitRow(status: LiveKitStatus): Pick<StatusRowProps, 'state' | 'detail' | 'badge'> {
  if (status.state === 'ok') {
    return { state: 'healthy', detail: `The last test conversation joined its room at ${timeOf(status.at)}.`, badge: `${status.connectMs} ms` };
  }
  if (status.state === 'failed') {
    return { state: 'down', detail: `The last test conversation could not start (${timeOf(status.at)}): ${status.message}` };
  }
  return { state: 'unknown', detail: 'Not checked yet. It is checked when you start a test conversation.' };
}

interface StatusRowProps {
  state: HealthState;
  title: string;
  technical: string;
  detail: string;
  badge?: string;
  loading?: boolean;
}

function StatusRow({ state, title, technical, detail, badge, loading = false }: StatusRowProps) {
  const Icon = state === 'healthy' ? CheckCircle2Icon : state === 'degraded' ? CircleAlertIcon : state === 'down' ? XCircleIcon : CircleHelpIcon;
  const iconTone = state === 'healthy' ? 'text-success' : state === 'degraded' ? 'text-warning' : state === 'down' ? 'text-danger' : 'text-muted';
  return (
    <div className="flex items-start justify-between gap-3 p-3.5">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconTone)} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink" title={technical}>
            {title}
          </p>
          {loading ? (
            <div className="mt-1.5 h-3 w-48 animate-pulse rounded bg-subtle" aria-hidden />
          ) : (
            <p className="mt-1 break-words text-xs text-ink-soft">{detail}</p>
          )}
        </div>
      </div>
      {badge && <span className="shrink-0 rounded bg-subtle px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-soft">{badge}</span>}
    </div>
  );
}
