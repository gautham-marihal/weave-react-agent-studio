import { useState } from 'react';
import { Dialog } from '../components/ui/Dialog';
import { Button } from '../components/ui/Button';
import { LIVE_NOTE, SANDBOX_NOTE, setDataSource, type DataSource } from './mode';

/**
 * Asks before the studio switches to the other data source, then reloads onto it (the same question as the top bar's
 * switch). Used by Settings' Data source card and by the "Can't reach the server" strip.
 */
export function SwitchSourceDialog({ to, onClose }: { to: DataSource | null; onClose: () => void }) {
  return (
    <Dialog
      open={to !== null}
      onClose={onClose}
      title={to === 'sandbox' ? 'Switch to Sandbox?' : 'Switch to Live?'}
      description={to === 'sandbox' ? SANDBOX_NOTE : LIVE_NOTE}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {to && (
            <Button variant="primary" onClick={() => setDataSource(to)}>
              {to === 'sandbox' ? 'Use Sandbox' : 'Use Live'}
            </Button>
          )}
        </div>
      }
    >
      <p className="text-sm text-ink-soft">
        The studio reloads on {to === 'sandbox' ? 'the sample data' : 'the Agent Builder API'}. Unsaved edits are not carried over;
        {to === 'sandbox' ? ' nothing you do in Sandbox reaches the real API.' : ' sample agents stay in this browser for when you come back.'}
      </p>
    </Dialog>
  );
}

/** Asks before putting Sandbox back to its sample agents, calls and team, then reloads. */
export function StartAgainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const startAgain = async () => {
    setBusy(true);
    const { startSampleDataAgain } = await import('./sampleData');
    await startSampleDataAgain();
    window.location.reload();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start the sample data again?"
      description="Sandbox goes back to how it started: the sample agents, their calls and the sample team come back, and everything made or changed here is removed. Live is not touched."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void startAgain()} disabled={busy}>
            Start again
          </Button>
        </div>
      }
    >
      <p className="text-sm text-ink-soft">This can’t be undone.</p>
    </Dialog>
  );
}
