import { CopyIcon } from 'lucide-react';
import type { AgentConfig } from '../../../types/studio';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { PromptPreviewBody, WhatIfBar } from './agent/PromptPreview';
import { copyInstructions, usePromptPreview, useWhatIf } from './agent/promptPreviewState';

interface PromptPreviewModalProps {
  open: boolean;
  onClose: () => void;
  config: AgentConfig;
}

/**
 * The exact instructions an agent would get, built by the server (POST /preview/prompt) from what is in the editor now,
 * unsaved edits included. Agent, channel, time, the caller's number and state values are what-ifs. When the server
 * can't answer, the error is shown and nothing is put together in the browser instead.
 */
export function PromptPreviewModal({ open, onClose, config }: PromptPreviewModalProps) {
  const what = useWhatIf(config);
  const answer = usePromptPreview(config, what, open);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Prompt preview"
      description="The exact instructions the agent would get, built by the server from what is in the editor now (unsaved edits included)."
      footer={
      <>
          <Button variant="secondary" onClick={() => answer.data && void copyInstructions(answer.data.instructions)} disabled={!answer.data}>
            <CopyIcon className="h-4 w-4" aria-hidden />
            Copy instructions
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }>
      <div className="space-y-5">
        <WhatIfBar config={config} what={what} />
        <PromptPreviewBody answer={answer} />
      </div>
    </Dialog>);

}
