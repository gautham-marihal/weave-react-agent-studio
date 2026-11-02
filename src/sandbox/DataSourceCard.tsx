import { useState } from 'react';
import { DatabaseIcon, FlaskConicalIcon, RotateCcwIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { StatusChip } from '../components/ui/StatusChip';
import { cn } from '../utils/styles';
import { dataSource, sandboxIsForced, type DataSource } from './mode';
import { StartAgainDialog, SwitchSourceDialog } from './SwitchSourceDialog';

const SOURCES: { id: DataSource; label: string; icon: typeof DatabaseIcon; means: string }[] = [
  {
    id: 'live',
    label: 'Live',
    icon: DatabaseIcon,
    means: 'Agents are read from and saved to the Agent Builder API. Nothing is made up: tests, calls and deployments are real.',
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    icon: FlaskConicalIcon,
    means: 'Sample agents and calls kept in this browser only. Saving, publishing and deploying only pretend to, nothing goes live anywhere, and test replies are made up by simple rules.',
  },
];

/**
 * Settings' Data source card (Weave React's Settings › Data source): which source the studio runs on, what each means,
 * a switch (it asks first, then reloads) and, in Sandbox, "Start the sample data again".
 */
export function DataSourceCard() {
  const current = dataSource();
  const forced = sandboxIsForced();
  const [asking, setAsking] = useState<DataSource | null>(null);
  const [resetting, setResetting] = useState(false);

  return (
    <section aria-labelledby="data-source" className="mt-8 border-b border-line pb-8" data-testid="data-source">
      <h2 id="data-source" className="text-sm font-semibold text-ink">
        Data source
      </h2>
      <p className="mt-1 text-[13px] text-muted">Where the studio’s agents and calls come from. The top bar’s Live | Sandbox switch is the same choice.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {SOURCES.map((s) => {
          const on = s.id === current;
          const Icon = s.icon;
          return (
            <li
              key={s.id}
              data-source={s.id}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'flex flex-col rounded-lg border p-4',
                on ? (s.id === 'sandbox' ? 'border-warning/50 bg-warning-soft' : 'border-accent/40 bg-accent-soft/40') : 'border-line bg-surface'
              )}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon className={cn('h-4 w-4', s.id === 'sandbox' ? 'text-warning' : 'text-accent')} aria-hidden />
                {s.label}
                {on && <StatusChip tone={s.id === 'sandbox' ? 'warning' : 'accent'}>In use</StatusChip>}
              </p>
              <p className="mt-1 flex-1 text-[13px] leading-relaxed text-ink-soft">{s.means}</p>
              {!on && (
                <Button className="mt-3 self-start" size="sm" variant="secondary" disabled={forced && s.id === 'live'} onClick={() => setAsking(s.id)}>
                  Use {s.label}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {forced && <p className="mt-3 text-[13px] text-muted">This studio was built to run on sample data only (VITE_SANDBOX=true), so Live is not available here.</p>}
      {current === 'sandbox' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="text-[13px] text-ink-soft">Put back the sample agents, calls and team, and remove everything made in Sandbox.</p>
          <Button size="sm" variant="secondary" onClick={() => setResetting(true)}>
            <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
            Start the sample data again
          </Button>
        </div>
      )}
      <SwitchSourceDialog to={asking} onClose={() => setAsking(null)} />
      <StartAgainDialog open={resetting} onClose={() => setResetting(false)} />
    </section>
  );
}
