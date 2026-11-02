import { useState } from 'react';
import { DatabaseIcon, FlaskConicalIcon } from 'lucide-react';
import { Dialog } from '../components/ui/Dialog';
import { Button } from '../components/ui/Button';
import { cn } from '../utils/styles';
import { LIVE_NOTE, SANDBOX_NOTE, dataSource, sandboxIsForced, setDataSource, type DataSource } from './mode';

const LABEL: Record<DataSource, string> = { live: 'Live', sandbox: 'Sandbox' };

/**
 * The top bar's data source: Live (the Agent Builder API) or Sandbox (sample data in this browser). Switching asks
 * first, then reloads the studio onto the other source, so nothing made in one is ever saved to the other.
 */
export function DataSourceSwitch({ compact = false }: { compact?: boolean }) {
  const current = dataSource();
  const forced = sandboxIsForced();
  const [asking, setAsking] = useState<DataSource | null>(null);
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    setResetting(true);
    // the sample agents and calls, the samples hidden from Home and the sample team all start again (sampleData.ts)
    const { startSampleDataAgain } = await import('./sampleData');
    await startSampleDataAgain();
    window.location.reload();
  };

  return (
    <>
      <div
        role="group"
        aria-label="Data source"
        title={current === 'sandbox' ? SANDBOX_NOTE : LIVE_NOTE}
        className={cn('inline-flex shrink-0 rounded-lg border p-0.5', current === 'sandbox' ? 'border-warning/40 bg-warning-soft' : 'border-line bg-subtle')}
      >
        {(['live', 'sandbox'] as DataSource[]).map((source) => {
          const active = source === current;
          const Icon = source === 'live' ? DatabaseIcon : FlaskConicalIcon;
          return (
            <button
              key={source}
              type="button"
              aria-pressed={active}
              disabled={forced && source === 'live'}
              onClick={() => setAsking(source)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50',
                active && source === 'live' && 'bg-surface text-ink shadow-sm',
                active && source === 'sandbox' && 'bg-surface text-warning shadow-sm',
                !active && 'text-muted hover:text-ink'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className={cn(compact ? 'sr-only' : 'max-sm:sr-only')}>{LABEL[source]}</span>
            </button>
          );
        })}
      </div>

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking === current ? `You are in ${LABEL[current]}` : `Switch to ${asking ? LABEL[asking] : ''}?`}
        description={asking === 'sandbox' ? SANDBOX_NOTE : LIVE_NOTE}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div>
              {current === 'sandbox' && (
                <Button variant="secondary" size="sm" onClick={() => void reset()} disabled={resetting}>
                  Start the sample data again
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAsking(null)}>
                {asking === current ? 'Close' : 'Cancel'}
              </Button>
              {asking && asking !== current && (
                <Button variant="primary" onClick={() => setDataSource(asking)}>{asking === 'sandbox' ? 'Use Sandbox' : 'Use Live'}</Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-2 text-sm text-ink-soft">
          {asking && asking !== current && (
            <p>
              The studio reloads on {asking === 'sandbox' ? 'the sample data' : 'the Agent Builder API'}. Unsaved edits are not carried over;
              {asking === 'sandbox' ? ' nothing you do in Sandbox reaches the real API.' : ' sample agents stay in this browser for when you come back.'}
            </p>
          )}
          {asking === current && current === 'sandbox' && <p>Starting again puts back the sample agents and calls, and removes everything made here.</p>}
          {forced && <p>This studio was built to run on sample data only (VITE_SANDBOX=true), so Live is not available here.</p>}
        </div>
      </Dialog>
    </>
  );
}
