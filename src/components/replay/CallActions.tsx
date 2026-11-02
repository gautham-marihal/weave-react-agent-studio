import React, { useEffect, useState } from 'react';
import { FlaskConicalIcon, RotateCcwIcon, WrenchIcon } from 'lucide-react';
import { api } from '../../api/client';
import type { AgentConfig, CallRecord } from '../../types/studio';
import type { DraftEdit } from '../../models/pendingChange';
import { useStudio } from '../../contexts/StudioContext';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FixCallDialog } from '../fixcall/FixCallDialog';
import { KeepAsTestDialog } from './KeepAsTestDialog';
import { ReplayPanel } from './ReplayPanel';
import { useCallFacts } from './useReplay';

interface CallActionsProps {
  agentId: string;
  callId: string;
  call: CallRecord;
}

type Open = null | 'replay' | 'fix' | 'test';

/** The agent's saved draft, read when first needed. */
function useSavedDraft(agentId: string, enabled: boolean) {
  const [state, setState] = useState<{ config: AgentConfig | null; error: string | null }>({ config: null, error: null });
  useEffect(() => {
    if (!enabled || state.config) return;
    const controller = new AbortController();
    api
      .getDraft(agentId, { signal: controller.signal })
      .then((d) => setState({ config: d.config, error: null }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ config: null, error: err instanceof Error ? err.message : 'The agent’s draft could not be read.' });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, enabled]);
  return state;
}

/** What can be done with a finished call: replay it, fix what went wrong, keep it as a test. Each starts from the
 *  call's records; fixing and keeping change the agent's draft, in the agent's own page, unsaved. */
export function CallActions({ agentId, callId, call }: CallActionsProps) {
  const { getAgent } = useStudio();
  const { can } = useAuth();
  const [open, setOpen] = useState<Open>(null);
  const [withFix, setWithFix] = useState<{ edits: DraftEdit[]; note: string; expected: string } | null>(null);
  const [used, setUsed] = useState(false);
  const records = useCallFacts(agentId, callId, used);
  const draft = useSavedDraft(agentId, used);
  const versions = getAgent(agentId)?.versions ?? [];
  const going = call.outcome === 'in_progress';
  const canEdit = can('edit');

  const show = (which: Open) => {
    setUsed(true);
    if (which !== 'test') setWithFix(null);
    setOpen(which);
  };
  const close = () => setOpen(null);
  const problem = records.error ? `The call’s records could not be read (${records.error}).` : draft.error ? `The agent’s draft could not be read (${draft.error}).` : null;
  const waiting = !problem && (!records.facts || !draft.config);
  const status = records.status || (call.outcome === 'cut_off' ? 'unfinished' : 'ended');

  const notReady = (title: string) =>
  <Dialog open onClose={close} title={title}>
      {problem ? <p role="alert" className="text-[13px] text-danger">{problem}</p> : <p className="text-[13px] text-muted" role="status">Reading the call’s records…</p>}
    </Dialog>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" aria-label="What to do with this call">
        <Button size="sm" variant="secondary" disabled={going} title={going ? 'The call is still going' : 'Play the caller’s words to the agent again'} onClick={() => show('replay')}>
          <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden />
          Replay
        </Button>
        <Button size="sm" variant="secondary" disabled={going || !canEdit} title={going ? 'The call is still going' : !canEdit ? 'Your role can’t change the agent' : 'See what went wrong and change the draft'} onClick={() => show('fix')}>
          <WrenchIcon className="h-3.5 w-3.5" aria-hidden />
          Fix this call
        </Button>
        <Button size="sm" variant="secondary" disabled={going || !canEdit} title={going ? 'The call is still going' : !canEdit ? 'Your role can’t change the agent' : 'Check this conversation every time the agent changes'} onClick={() => show('test')}>
          <FlaskConicalIcon className="h-3.5 w-3.5" aria-hidden />
          Keep as a test
        </Button>
      </div>

      {open === 'replay' && (
      records.facts ?
      <Dialog
        open
        onClose={close}
        size="xl"
        title="What if it ran again?"
        description="The caller’s words are played to the agent as it is now, or to a published version, and laid beside what happened. Nothing is saved, and no real caller is involved.">
            <ReplayPanel
          agentId={agentId}
          original={records.facts}
          versions={versions}
          after={canEdit &&
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Button variant="primary" size="sm" onClick={() => show('test')}>Keep this call as a test</Button>
                  <span className="text-xs text-muted">So the same conversation is checked every time the agent changes.</span>
                </div>
          } />
          </Dialog> :
      notReady('What if it ran again?'))
      }

      {open === 'fix' && (
      records.facts && draft.config ?
      <FixCallDialog
        open
        onClose={close}
        agentId={agentId}
        facts={records.facts}
        call={{ status, duration_s: call.duration_s }}
        config={draft.config}
        versions={versions}
        onWithTest={(change) => {
          setWithFix(change);
          setOpen('test');
        }} /> :
      notReady('Fix this call'))
      }

      {open === 'test' && (
      records.facts && draft.config && !waiting ?
      <KeepAsTestDialog
        open
        onClose={close}
        agentId={agentId}
        facts={records.facts}
        config={draft.config}
        call={{ id: call.id, started_at: call.started_at }}
        expected={withFix?.expected}
        withEdits={withFix ? { edits: withFix.edits, note: withFix.note } : undefined} /> :
      notReady('Keep this call as a test'))
      }
    </>);
}
