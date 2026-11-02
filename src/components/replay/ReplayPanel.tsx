import React, { useState } from 'react';
import { LoaderCircleIcon, PlayIcon } from 'lucide-react';
import { api } from '../../api/client';
import type { AgentConfig, Version } from '../../types/studio';
import type { CallFacts } from '../../models/replayFacts';
import type { ReplayComparison } from '../../models/replayCompare';
import { Button } from '../ui/Button';
import { cn, inputClass } from '../../utils/styles';
import { isSandbox } from '../../sandbox/mode';
import { SandboxNoteSlot } from '../../sandbox/test/SandboxNoteSlot';
import { ReplayCompare } from './ReplayCompare';
import { useReplayRun } from './useReplay';

interface ReplayPanelProps {
  agentId: string;
  original: CallFacts;
  versions: Version[];
  /** What "the draft" is here: the saved draft by default; Fix this call passes the draft with its changes. */
  draft?: { config: AgentConfig; label: string };
  /** Shown under a finished replay: "Keep this call as a test". */
  after?: React.ReactNode;
}

/** A replay Sandbox played in this browser: the comparison, what it was played to, and the words that say so. */
interface BrowserReplay {
  comparison: ReplayComparison;
  label: string;
  sourceLabel: string;
}

/** "What if it ran again?": the caller's words played to the draft or a published version on the runtime, and laid
 *  beside what happened. Nothing is saved, and no real caller is involved. In Sandbox there is no runtime: the call is
 *  played on Sandbox's imitation in this browser (free, so nothing asks about cost), or on its imitation runner. */
export function ReplayPanel({ agentId, original, versions, draft, after }: ReplayPanelProps) {
  const sandbox = isSandbox();
  const [target, setTarget] = useState('draft');
  const [costOk, setCostOk] = useState(false);
  const replay = useReplayRun(agentId);
  const [inBrowser, setInBrowser] = useState<BrowserReplay | null>(null);
  const draftLabel = draft?.label ?? 'The saved draft';
  const options = [{ value: 'draft', label: draftLabel }, ...versions.map((v, i) => ({ value: v.version, label: `Version ${v.version}${i === 0 ? ' (latest)' : ''}` }))];
  const labelOf = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  const [loadError, setLoadError] = useState<string | null>(null);

  const configFor = async (): Promise<AgentConfig | null> => {
    setLoadError(null);
    try {
      if (target === 'draft') return draft?.config ?? (await api.getDraft(agentId)).config;
      return (await api.getVersion(agentId, target)).config;
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'What to play it to could not be read.');
      return null;
    }
  };

  const run = async () => {
    setInBrowser(null);
    const config = await configFor();
    if (config) void replay.start(config, original, sandbox ? `${labelOf(target)} on the Sandbox imitation` : labelOf(target));
  };

  // Sandbox: played on the imitation in this browser (the module loads only in Sandbox).
  const runInBrowser = async () => {
    replay.reset();
    setInBrowser(null);
    const config = await configFor();
    if (!config) return;
    try {
      const { replayInBrowser } = await import('../../sandbox/replay/sandboxReplay');
      setInBrowser({ ...replayInBrowser(config, original), label: labelOf(target) });
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'The replay could not be played.');
    }
  };

  if (original.turns.length === 0)
    return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">The caller said nothing in this call, so there is nothing to replay.</p>;

  const busy = replay.phase === 'running';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-[13px] font-medium text-ink-soft">Play it to</span>
          <select
            className={cn(inputClass, 'mt-1 w-64')}
            value={target}
            disabled={busy}
            onChange={(e) => {
              setTarget(e.target.value);
              replay.reset();
              setInBrowser(null);
            }}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {sandbox ?
        <>
            <Button variant="primary" onClick={() => void runInBrowser()} disabled={busy}>
              <PlayIcon className="h-4 w-4" aria-hidden />Replay in the browser
            </Button>
            <Button variant="secondary" onClick={() => void run()} disabled={busy}>
              {busy ? <><LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />Replaying…</> : 'Replay on the Sandbox runner'}
            </Button>
          </> :
        <Button variant="primary" onClick={() => void run()} disabled={busy || !costOk}>
            {busy ? <><LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />Replaying…</> : <><PlayIcon className="h-4 w-4" aria-hidden />Replay on the runtime</>}
          </Button>
        }
      </div>
      {sandbox ?
      <SandboxNoteSlot kind="replay" /> :
      <label className="flex items-start gap-2 text-[13px] text-ink-soft">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" checked={costOk} onChange={(e) => setCostOk(e.target.checked)} />
        <span>
          Replaying uses the live language model, which costs money. The agent’s API calls are not made for real: in a replay nothing answers them, and they are listed afterwards.
        </span>
      </label>
      }
      {(loadError || replay.problem) &&
      <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">The replay didn’t run: {loadError || replay.problem}</p>
      }
      {busy && <p className="text-[13px] text-muted" role="status">The {sandbox ? 'Sandbox runner' : 'runtime'} is playing the caller’s {original.turns.length === 1 ? 'turn' : `${original.turns.length} turns`}…</p>}
      {inBrowser &&
      <>
          <ReplayCompare cmp={inBrowser.comparison} targetLabel={`Replay: ${inBrowser.label}`} sourceLabel={inBrowser.sourceLabel} />
          {after}
        </>
      }
      {replay.outcome &&
      <>
          <ReplayCompare cmp={replay.outcome.comparison} targetLabel={`Replay: ${replay.outcome.label}`} />
          {replay.outcome.unmocked.length > 0 &&
        <p className="rounded-lg border border-info/30 bg-info-soft p-3 text-[13px] text-ink-soft">
              The agent made requests nothing answered: <span className="font-mono text-xs">{replay.outcome.unmocked.join(', ')}</span>. In a test, add a mock for each so the answer is the same every time.
            </p>
        }
          {replay.outcome.notes.map((note, i) => <p key={i} className="text-xs text-muted">{note}</p>)}
          {after}
        </>
      }
    </div>);
}
