import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightIcon } from 'lucide-react';
import type { Agent } from '../../../types/studio';
import { Dialog } from '../../ui/Dialog';
import { ChangeList } from '../ChangeList';
import { plainChanges } from '../../../models/changes';
import { api } from '../../../api/client';
import type { Diff } from '../../../api/types';
import { inputClass } from '../../../utils/styles';

interface CompareDialogProps {
  open: boolean;
  onClose: () => void;
  agent: Agent;
  initialA: string;
  initialB: string;
}

/** Any two versions, or a version and the saved draft, compared by the server (GET /diff), in plain words. */
export function CompareDialog({ open, onClose, agent, initialA, initialB }: CompareDialogProps) {
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setA(initialA);
      setB(initialB);
    }
  }, [open, initialA, initialB]);

  useEffect(() => {
    if (!open || !a || !b) return;
    const controller = new AbortController();
    setDiff(null);
    setError(null);
    api
      .diff(agent.id, a, b, { signal: controller.signal })
      .then(setDiff)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'The server could not compare them.');
      });
    return () => controller.abort();
  }, [open, agent.id, a, b]);

  const summary = useMemo(() => plainChanges(diff?.changes ?? []), [diff]);
  const options = [{ value: 'draft', label: `Saved draft (rev ${agent.draft.revision})` }, ...agent.versions.map((v) => ({ value: v.version, label: v.version }))];
  const description = error ? 'The server could not compare them.' : diff ? `${summary.total} ${summary.total === 1 ? 'change' : 'changes'} in ${summary.groups.length} ${summary.groups.length === 1 ? 'part' : 'parts'}` : 'Asking the server…';

  return (
    <Dialog open={open} onClose={onClose} size="xl" title="Compare" description={description}>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">From</span>
          <select className={`${inputClass} mt-1 w-56 font-mono`} value={a} onChange={(e) => setA(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <ArrowRightIcon className="mb-2.5 h-4 w-4 text-muted" aria-hidden />
        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">To</span>
          <select className={`${inputClass} mt-1 w-56 font-mono`} value={b} onChange={(e) => setB(e.target.value)}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <p className="mb-4 text-xs text-muted">The draft here is what is saved on the server; unsaved edits are not included.</p>
      {error ?
      <p className="text-sm text-danger" role="alert">{error}</p> :
      diff ?
      <ChangeList summary={summary} emptyText="These two are the same (apart from version numbers and dates)." /> :

      <div className="space-y-2" aria-busy="true" aria-label="Loading">
          <div className="h-4 w-2/3 animate-pulse rounded bg-subtle" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-subtle" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-subtle" />
        </div>
      }
    </Dialog>);

}
