import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SearchIcon } from 'lucide-react';
import { ActivityAction } from '../../types/studio';
import { useStudio } from '../../contexts/StudioContext';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { StatusChip } from './StatusChip';
import { formatDateTime, timeAgo } from '../../utils/format';
import { cn, inputClass } from '../../utils/styles';

const actionMeta: Record<ActivityAction, { label: string; tone: 'accent' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  created: { label: 'Created', tone: 'accent' },
  saved: { label: 'Saved Draft', tone: 'neutral' },
  published: { label: 'Published Version', tone: 'info' },
  deployed: { label: 'Deployed to Env', tone: 'success' },
  rolled_back: { label: 'Rolled Back', tone: 'warning' },
  restored: { label: 'Restored Version', tone: 'danger' },
  exported: { label: 'Exported', tone: 'neutral' },
  imported: { label: 'Imported', tone: 'info' },
};

export function AuditTrailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activity, agents } = useStudio();
  const [filterAction, setFilterAction] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return activity
      .filter((a) => filterAction === 'all' || a.action === filterAction)
      .filter((a) => {
        if (!q) return true;
        const agent = agents.find((ag) => ag.id === a.agentId);
        return (
          a.who.toLowerCase().includes(q) ||
          a.agentId.toLowerCase().includes(q) ||
          (agent && agent.name.toLowerCase().includes(q)) ||
          a.detail.toLowerCase().includes(q)
        );
      });
  }, [activity, filterAction, searchQuery, agents]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Audit Trail & Release Accountability (FR-24)"
      description="Who saved, published and deployed each agent, as the server recorded it."
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-xs text-muted flex items-center gap-1.5">
            Names are the X-User label the gateway forwards. They are not verified.
          </span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by operator (e.g. Asha), agent ID, or change..."
              className={cn(inputClass, 'pl-9 text-xs')}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Action:</span>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className={cn(inputClass, 'w-auto py-1 text-xs')}
            >
              <option value="all">All Actions ({activity.length})</option>
              <option value="saved">Draft Saves</option>
              <option value="published">Publications</option>
              <option value="deployed">Deployments</option>
              <option value="rolled_back">Rollbacks</option>
              <option value="restored">Restorations</option>
            </select>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-line bg-surface">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted">
              No activity logs match the selected filter.
            </div>
          ) : (
            <div className="divide-y divide-line text-xs">
              {filtered.map((item) => {
                const agent = agents.find((ag) => ag.id === item.agentId);
                const meta = actionMeta[item.action] ?? { label: item.action, tone: 'neutral' };
                return (
                  <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-3 hover:bg-canvas">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <StatusChip tone={meta.tone} className="text-[10px]">
                          {meta.label}
                        </StatusChip>
                      </div>
                      <div>
                        <p className="font-medium text-ink">
                          <span className="text-accent-strong">{item.who}</span>{' '}
                          {item.action === 'saved' && 'saved draft for'}
                          {item.action === 'published' && 'published release of'}
                          {item.action === 'deployed' && 'deployed'}
                          {item.action === 'rolled_back' && 'rolled back'}
                          {item.action === 'restored' && 'restored'}{' '}
                          <Link
                            to={`/agents/${item.agentId}`}
                            onClick={onClose}
                            className="font-semibold text-ink underline"
                          >
                            {agent?.name ?? item.agentId}
                          </Link>
                        </p>
                        <p className="mt-0.5 text-muted">{item.detail}</p>
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-muted">
                      <p>{formatDateTime(item.at)}</p>
                      <p>{timeAgo(item.at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
