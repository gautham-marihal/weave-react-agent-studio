import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TriangleAlertIcon, XIcon } from 'lucide-react';
import type { AgentConfig } from '../../types/studio';
import type { CallFacts } from '../../models/replayFacts';
import { buildScenario, hasPersonalData, suggestTest, testProblems, toolNamesOf, type SuggestedCheck } from '../../models/replayTest';
import { queueChange, type DraftEdit } from '../../models/pendingChange';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { cn, inputClass } from '../../utils/styles';

interface KeepAsTestDialogProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  facts: CallFacts;
  /** The agent's saved draft, which the test is added to. */
  config: AgentConfig;
  call: { id: string; started_at: string };
  /** What should have happened, filled in by Fix this call. */
  expected?: string;
  /** Changes going into the draft with the test (Fix this call's), and how to say them. */
  withEdits?: { edits: DraftEdit[]; note: string };
}

const checkboxClass = 'mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]';

/** "Keep this call as a test": the caller's words (editable), the checks to keep, what should have happened. The test is
 *  put in the agent's draft like any other edit: nothing is saved until the draft is, and Undo takes it back. */
export function KeepAsTestDialog({ open, onClose, agentId, facts, config, call, expected = '', withEdits }: KeepAsTestDialogProps) {
  const navigate = useNavigate();
  const start = useMemo(() => suggestTest(facts, config, { callId: call.id, startedAt: call.started_at }), [facts, config, call.id, call.started_at]);
  const [id, setId] = useState(start.id);
  const [description, setDescription] = useState(start.description);
  const [channel, setChannel] = useState(start.channel);
  const [turns, setTurns] = useState(start.turns);
  const [checks, setChecks] = useState<SuggestedCheck[]>(start.checks);
  const [expectedText, setExpectedText] = useState(expected);
  const [never, setNever] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setId(start.id);
    setDescription(start.description);
    setChannel(start.channel);
    setTurns(start.turns);
    setChecks(start.checks);
    setExpectedText(expected);
    setNever([]);
  }, [open, start, expected]);

  const channels = (Array.isArray(config.channels) ? config.channels : []).filter((c) => c && c.id);
  const tools = toolNamesOf(config);
  const draft = { id, description, channel, turns, checks, expectedText, toolsNeverCalled: never };
  const problems = testProblems(draft, config);
  const personal = turns.some(hasPersonalData);

  const add = () => {
    if (problems.length) return;
    const scenario = buildScenario(draft);
    queueChange(agentId, {
      note: withEdits ? `${withEdits.note} Added the test “${scenario.id}”.` : `Added the test “${scenario.id}” to the draft.`,
      edits: [...(withEdits?.edits ?? []), { op: 'add_test', scenario }],
      target: { stage: 'build', focus: 'tests' },
    });
    onClose();
    navigate(`/agents/${encodeURIComponent(agentId)}/build`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Keep this call as a test"
      description="The caller’s words become a test scenario in the draft. From then on, every run checks that the agent still handles them this way."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={problems.length > 0} onClick={add}>
            {withEdits ? 'Put the changes and the test in the draft' : 'Add the test to the draft'}
          </Button>
        </>
      }>
      <div className="space-y-5">
        {start.warnings.length > 0 &&
        <ul className="space-y-1">
            {start.warnings.map((w) =>
          <li key={w} role="note" className="flex gap-2 text-[13px] text-ink-soft">
                <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                {w}
              </li>
          )}
          </ul>
        }
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">Test name</span>
            <input className={cn(inputClass, 'mt-1 font-mono')} value={id} onChange={(e) => setId(e.target.value)} spellCheck={false} aria-label="Test name" />
          </label>
          <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">Channel</span>
            <select className={cn(inputClass, 'mt-1')} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
              {!channels.some((c) => c.id === channel) && <option value={channel}>{channel || 'Choose…'}</option>}
              {channels.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">Why it is kept</span>
          <input className={cn(inputClass, 'mt-1')} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Why it is kept" />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-ink">What the caller says</legend>
          {personal && <p className="mt-1 text-xs text-warning">A number or an address is still in here. Edit it before keeping the test.</p>}
          <ol className="mt-2 space-y-2">
            {turns.map((text, index) =>
            <li key={index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{index + 1}</span>
                <input className={inputClass} value={text} aria-label={`Caller turn ${index + 1}`} onChange={(e) => setTurns(turns.map((t, i) => i === index ? e.target.value : t))} />
                <Button size="sm" variant="ghost" aria-label={`Remove turn ${index + 1}`} disabled={turns.length === 1} onClick={() => setTurns(turns.filter((_, i) => i !== index))}>
                  <XIcon className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            )}
          </ol>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-ink">What must hold afterwards</legend>
          {checks.length === 0 && <p className="mt-1 text-[13px] text-muted">Nothing in this call is plain enough to suggest. Say what should have happened below.</p>}
          <ul className="mt-2 space-y-2">
            {checks.map((c) =>
            <li key={c.id}>
                <label className="flex items-start gap-2.5">
                  <input type="checkbox" className={checkboxClass} checked={c.checked} onChange={(e) => setChecks(checks.map((x) => x.id === c.id ? { ...x, checked: e.target.checked } : x))} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{c.label}</span>
                    <span className="block text-xs text-muted">{c.why}</span>
                  </span>
                </label>
              </li>
            )}
          </ul>
        </fieldset>

        <label className="block">
          <span className="text-[13px] font-medium text-ink-soft">What should have happened? <span className="font-normal text-muted">(optional)</span></span>
          <textarea
            className={cn(inputClass, 'mt-1 min-h-[4rem]')}
            rows={2}
            value={expectedText}
            onChange={(e) => setExpectedText(e.target.value)}
            placeholder="For example: the agent offers to check the order again, and never promises a refund"
            aria-label="What should have happened" />
          <span className="mt-1 block text-xs text-muted">A reviewer model grades this, so a test with it needs a live run, which costs money.</span>
        </label>

        {tools.length > 0 &&
        <fieldset>
            <legend className="text-sm font-medium text-ink">The agent must never use… <span className="font-normal text-muted">(optional)</span></legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {tools.map((tool) =>
            <label key={tool} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs', never.includes(tool) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft')}>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[rgb(var(--accent))]" checked={never.includes(tool)} onChange={(e) => setNever(e.target.checked ? [...never, tool] : never.filter((t) => t !== tool))} />
                  {tool}
                </label>
            )}
            </div>
          </fieldset>
        }

        {problems.length > 0 &&
        <ul role="alert" className="space-y-0.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        }
        <p className="text-xs text-muted">The test goes into the draft as an unsaved edit: review it on the agent’s page, then Save. Undo takes it back.</p>
      </div>
    </Dialog>);
}
