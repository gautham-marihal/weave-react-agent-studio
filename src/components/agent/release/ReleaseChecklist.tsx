import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleCheckIcon, CircleXIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { AgentConfig, ValidationReport } from '../../../types/studio';
import { Button } from '../../ui/Button';
import { StatusChip } from '../../ui/StatusChip';
import { buildChecklist, knowledgeRows, POLICY_NOTE, verdict, type CheckState } from '../../../models/releaseChecklist';
import { targetPath } from '../../../models/agentPages';
import { useKnowledgeAt, useTestRuns } from '../../../hooks/useReleaseData';
import { useSecretKeys } from '../../../hooks/useProviders';
import { useBankingSource } from '../../../hooks/useBankingSource';
import { isBankingAgent } from '../../../models/bankingAgent';
import { cn } from '../../../utils/styles';

interface ReleaseChecklistProps {
  agentId: string;
  config: AgentConfig | null | undefined;
  report: ValidationReport | null | undefined;
  /** The version being checked; leave out for the draft. */
  version?: { version: string; checksum?: string };
  /** Compact: the Publish dialog's short form, without the policy note. */
  compact?: boolean;
  /** Called before following a line's action (to close the dialog it sits in). */
  onNavigate?: () => void;
}

const marks: Record<CheckState, { icon: React.ElementType; className: string }> = {
  ok: { icon: CircleCheckIcon, className: 'text-success' },
  warn: { icon: TriangleAlertIcon, className: 'text-warning' },
  bad: { icon: CircleXIcon, className: 'text-danger' },
  info: { icon: InfoIcon, className: 'text-muted' },
};
const verdictTone = { ok: 'success', warn: 'warning', bad: 'danger' } as const;

/** "Is it safe to put this live?" for a published version (deploying) or the draft (publishing). It informs only. */
export function ReleaseChecklist({ agentId, config, report, version, compact = false, onNavigate }: ReleaseChecklistProps) {
  const navigate = useNavigate();
  const hasTests = Array.isArray(config?.tests) && config.tests.length > 0;
  const hasKnowledge = Array.isArray(config?.knowledge) && config.knowledge.length > 0;
  const runs = useTestRuns(agentId, hasTests);
  const knowledge = useKnowledgeAt(agentId, hasKnowledge ? version?.version ?? 'draft' : '');
  const keys = useSecretKeys();
  const banking = useBankingSource(isBankingAgent(config));
  const rows = useMemo(() => (knowledge.data ? knowledgeRows(knowledge.data) : null), [knowledge.data]);
  const items = useMemo(
    () => buildChecklist({ config, report, version, runs: runs.data ?? [], knowledge: rows, keys, target: version ? 'version' : 'draft', banking }),
    [config, report, version, runs.data, rows, keys, banking]
  );
  const loading = (hasTests && runs.loading && !runs.data) || (hasKnowledge && knowledge.loading && !knowledge.data);
  const summary = verdict(items);
  const unread = [runs.error && 'the test runs', knowledge.error && 'the knowledge'].filter(Boolean);

  return (
    <section aria-label="Release checklist" data-verdict={summary.state} className="rounded-lg border border-line">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h3 className="text-sm font-medium text-ink">Is it safe to put this live?</h3>
        {loading ? <span className="text-xs text-muted" role="status">Checking…</span> : <StatusChip tone={verdictTone[summary.state]}>{summary.text}</StatusChip>}
      </header>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const Mark = marks[item.state].icon;
          const action = item.action;
          return (
            <li key={item.id} data-check={item.id} className="flex items-start gap-2.5 px-3 py-2.5">
              <Mark className={cn('mt-0.5 h-4 w-4 shrink-0', marks[item.state].className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">
                  <span className="font-medium">{item.label}:</span> {item.text}
                </p>
                {item.note && <p className="text-xs text-muted">{item.note}</p>}
                {!compact && item.detail && item.detail.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {item.detail.map((d, i) => <li key={i} className="break-words">{d}</li>)}
                  </ul>
                )}
              </div>
              {action && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onNavigate?.();
                    navigate(targetPath(agentId, action.target));
                  }}>
                  {action.label}
                </Button>
              )}
            </li>);
        })}
      </ul>
      {unread.length > 0 && (
        <p role="note" className="border-t border-line px-3 py-2 text-xs text-warning">
          Couldn’t read {unread.join(' or ')}, so those lines are missing. That doesn’t mean they pass.
        </p>
      )}
      {!compact && <p className="border-t border-line px-3 py-2 text-xs text-muted">{POLICY_NOTE}</p>}
    </section>);
}
