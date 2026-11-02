import React, { useMemo, useState } from 'react';
import { Segmented } from '../ui/Segmented';
import { useTestConversations } from '../../hooks/useTestConversations';
import { minutesText, testConversationStats } from '../../models/home';
import { formatDuration } from '../../utils/format';

// The conversations people had with their agents' drafts on the Test page, counted from the real call records (calls
// whose ref is the draft). Named so they are never read as the agents' traffic.

type Range = '7' | '30';

export function TestConversationStats({ agentIds }: { agentIds: string[] }) {
  const [range, setRange] = useState<Range>('7');
  const { calls, loading, failed, partial } = useTestConversations(agentIds);
  const days = Number(range);
  const stats = useMemo(() => testConversationStats(calls, days, Date.now()), [calls, days]);
  const when = `past ${days} days`;

  const tiles = [
    { title: 'Conversations', value: String(stats.count), note: stats.count ? `In the ${when}` : `None in the ${when}` },
    { title: 'Average length', value: stats.count ? formatDuration(Math.round(stats.avgSec)) : '—', note: 'From start to end' },
    { title: 'Minutes', value: minutesText(stats.minutes), note: 'Talking with your drafts' },
    { title: 'Messages', value: String(stats.messages), note: 'What you said or typed' },
  ];

  return (
    <section aria-labelledby="test-conversations" className="mt-10" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="test-conversations" className="text-sm font-semibold text-ink">
            Your test conversations
          </h2>
          <p className="mt-0.5 text-xs text-muted">Conversations with your agents’ drafts on the Test page. Real calls are on the Calls page.</p>
        </div>
        <Segmented
          label="Time range"
          size="sm"
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: 'Past 7 days' },
            { value: '30', label: 'Past 30 days' },
          ]}
        />
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.title} className="rounded-lg border border-line bg-surface p-4">
            <dt className="text-xs font-medium text-muted">{t.title}</dt>
            <dd className="mt-1">
              {loading ? (
                <span className="block h-7 w-12 animate-pulse rounded bg-subtle" aria-hidden />
              ) : (
                <span className="block text-2xl font-semibold tabular-nums text-ink" data-stat={t.title}>
                  {t.value}
                </span>
              )}
              <span className="mt-0.5 block text-xs text-muted">{t.note}</span>
            </dd>
          </div>
        ))}
      </dl>
      {!loading && (failed.length > 0 || partial) && (
        <p className="mt-2 text-xs text-warning" role="status">
          {failed.length > 0 && `The calls of ${failed.length === 1 ? '1 agent' : `${failed.length} agents`} could not be read, so they are left out. `}
          {partial && 'Some agents had more calls than were read; the numbers count the newest ones.'}
        </p>
      )}
    </section>
  );
}
