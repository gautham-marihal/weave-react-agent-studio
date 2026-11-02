import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentConfig, Version } from '../../types/studio';
import type { CallFacts } from '../../models/replayFacts';
import { diagnoseCall, headline, type Severity } from '../../models/fixcallDiagnose';
import { applyFixes, fixApplied, fixesFor, type Fix } from '../../models/fixcallFixes';
import { queueChange, type DraftEdit } from '../../models/pendingChange';
import { plainChanges } from '../../models/changes';
import { diffConfigs } from '../../utils/diff';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { StatusChip, type ChipTone } from '../ui/StatusChip';
import { cn } from '../../utils/styles';
import { ReplayPanel } from '../replay/ReplayPanel';

interface FixCallDialogProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  facts: CallFacts;
  /** The call list's status (unfinished = cut off) and length. */
  call: { status: string; duration_s: number };
  /** The agent's saved draft, which the changes go into. */
  config: AgentConfig;
  versions: Version[];
  /** "Put in the draft with a test…": opens Keep as a test with these changes and what to check. */
  onWithTest: (change: { edits: DraftEdit[]; note: string; expected: string }) => void;
}

const severity: Record<Severity, { label: string; tone: ChipTone }> = {
  high: { label: 'Serious', tone: 'danger' },
  medium: { label: 'Worth fixing', tone: 'warning' },
  low: { label: 'Worth knowing', tone: 'neutral' },
};
const choiceClass = 'mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]';

/** "Fix this call": what went wrong (with evidence), changes suggested from a checklist and shown as sentences, the call
 *  replayed with them, then the changes put into the draft (with a test, if wanted). Nothing changes until the end. */
export function FixCallDialog({ open, onClose, agentId, facts, call, config, versions, onWithTest }: FixCallDialogProps) {
  const navigate = useNavigate();
  const findings = useMemo(() => diagnoseCall(facts, { call, config }), [facts, call, config]);
  const [chosen, setChosen] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [trying, setTrying] = useState(false);
  useEffect(() => {
    if (!open) return;
    setChosen(findings[0]?.id ?? '');
    setTicked([]);
    setTrying(false);
  }, [open, findings]);

  const finding = findings.find((f) => f.id === chosen) ?? null;
  const fixes = useMemo(() => (finding ? fixesFor(finding, config) : []), [finding, config]);
  const picked: Fix[] = useMemo(() => fixes.filter((f) => ticked.includes(f.id) && !fixApplied(config, f)), [fixes, ticked, config]);
  const candidate = useMemo(() => applyFixes(config, picked), [config, picked]);
  const sentences = useMemo(() => plainChanges(diffConfigs(config, candidate, [], { listsByPosition: true })), [config, candidate]);
  const note = `${picked.length === 1 ? 'Put a change' : `Put ${picked.length} changes`} from “Fix this call” in the draft.`;
  const change = { edits: picked.map((f) => f.edit), note };

  const choose = (id: string) => {
    setChosen(id);
    setTicked([]);
    setTrying(false);
  };
  const putInDraft = () => {
    if (!picked.length) return;
    queueChange(agentId, { ...change, target: { stage: 'build', section: 'agent' } });
    onClose();
    navigate(`/agents/${encodeURIComponent(agentId)}/build`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Fix this call"
      description={`${headline(findings)} These come from what was recorded in the call; nothing is guessed.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={putInDraft} disabled={!picked.length}>Put in the draft</Button>
          <Button variant="primary" onClick={() => onWithTest({ ...change, expected: picked.map((f) => f.expected).find(Boolean) ?? '' })} disabled={!picked.length}>
            Put in the draft with a test…
          </Button>
        </>
      }>
      <div className="space-y-6">
        <section aria-labelledby="fix-what">
          <h3 id="fix-what" className="text-sm font-medium text-ink">1. What went wrong</h3>
          {findings.length === 0 ?
          <p className="mt-2 text-[13px] text-muted">If the call still felt wrong, replay it or keep it as a test, and say there what should have happened.</p> :
          <ul role="radiogroup" aria-label="Findings" className="mt-2 divide-y divide-line rounded-lg border border-line">
              {findings.map((f) =>
            <li key={f.id}>
                  <label className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5', chosen === f.id && 'bg-accent-soft/40')}>
                    <input type="radio" name="fix-finding" className={choiceClass} checked={chosen === f.id} onChange={() => choose(f.id)} aria-label={f.title} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{f.title}</span>
                      {f.evidence.map((e, i) => <span key={i} className="block break-words text-xs text-muted">{e}</span>)}
                    </span>
                    <StatusChip tone={severity[f.severity].tone}>{severity[f.severity].label}</StatusChip>
                  </label>
                </li>
            )}
            </ul>
          }
        </section>

        {finding &&
        <section aria-labelledby="fix-change">
            <h3 id="fix-change" className="text-sm font-medium text-ink">2. What to change</h3>
            <p className="text-xs text-muted">Suggested from a checklist of common remedies, not by an AI. Tick the ones you want; each is shown as it would be written in the draft.</p>
            {fixes.length === 0 ?
          <p className="mt-2 text-[13px] text-muted">There is no ready-made change for this one. Keep the call as a test and fix it by hand.</p> :
          <ul aria-label="Changes" className="mt-2 space-y-2">
                {fixes.map((fix) => {
              const done = fixApplied(config, fix);
              return (
                <li key={fix.id}>
                      <label className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5', ticked.includes(fix.id) ? 'border-accent bg-accent-soft/40' : 'border-line', done && 'opacity-70')}>
                        <input
                      type="checkbox"
                      className={choiceClass}
                      checked={ticked.includes(fix.id) || done}
                      disabled={done}
                      aria-label={fix.title}
                      onChange={() => {
                        setTicked((old) => old.includes(fix.id) ? old.filter((x) => x !== fix.id) : [...old, fix.id]);
                        setTrying(false);
                      }} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-ink">{fix.title}</span>
                          <span className="block text-xs text-muted">{fix.why}</span>
                          <span className="mt-1 block text-xs italic text-ink-soft">{done ? 'Already in the draft.' : fix.change}</span>
                        </span>
                      </label>
                    </li>);
            })}
              </ul>
          }
          </section>
        }

        {picked.length > 0 &&
        <section aria-labelledby="fix-check">
            <h3 id="fix-check" className="text-sm font-medium text-ink">3. Check it</h3>
            <div className="mt-2 rounded-lg border border-line bg-subtle/50 p-3" aria-label="What changes in the draft">
              <p className="text-xs font-medium text-muted">In the draft</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-ink">
                {sentences.groups.flatMap((g) => g.items.map((item, i) => <li key={`${g.key}-${i}`}>{item.text}</li>))}
              </ul>
            </div>
            <div className="mt-3">
              {trying ?
            <ReplayPanel agentId={agentId} original={facts} versions={versions} draft={{ config: candidate, label: 'The draft with these changes' }} /> :
            <Button variant="secondary" size="sm" onClick={() => setTrying(true)}>Replay the call with these changes</Button>
            }
            </div>
          </section>
        }
      </div>
    </Dialog>);
}
