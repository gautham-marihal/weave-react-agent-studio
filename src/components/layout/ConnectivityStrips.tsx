import React, { useEffect, useRef, useState } from 'react';
import { CloudOffIcon, FlaskConicalIcon, RefreshCwIcon, WifiOffIcon } from 'lucide-react';
import { useStudio } from '../../contexts/StudioContext';
import { checkApiHealth, useApiHealth, useOnline } from '../../hooks/useApiHealth';
import { connectivityStrip } from '../../utils/health';
import { Button } from '../ui/Button';
import { isSandbox } from '../../sandbox/mode';
import { SwitchSourceDialog } from '../../sandbox/SwitchSourceDialog';

/**
 * A strip across every page while there is no network, or while the API does not answer, so an empty list is never
 * mistaken for "nothing there". The API is asked again every 15 s while it is down; Try again asks now and reloads
 * the agents.
 */
export function ConnectivityStrips() {
  const online = useOnline();
  const { check, checking } = useApiHealth();
  const { refreshAgents } = useStudio();
  const [retrying, setRetrying] = useState(false);
  const [offerSandbox, setOfferSandbox] = useState(false);
  const wasOnline = useRef(online);

  // Back on the network: ask the API at once instead of waiting for the next check.
  useEffect(() => {
    if (online && !wasOnline.current) void checkApiHealth();
    wasOnline.current = online;
  }, [online]);

  const strip = connectivityStrip(online, check.state);
  if (!strip) return null;

  if (strip === 'offline') {
    return (
      <div className="flex items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-2 text-[13px] text-ink sm:px-6" role="status">
        <WifiOffIcon className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p>
          <strong className="font-semibold">You’re offline.</strong> Changes can’t be saved and pages can’t load until the connection is back.
        </p>
      </div>
    );
  }

  const retry = async () => {
    setRetrying(true);
    try {
      await checkApiHealth();
      await refreshAgents();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-danger/30 bg-danger-soft px-4 py-2 text-[13px] text-ink sm:px-6" role="status">
      <CloudOffIcon className="h-4 w-4 shrink-0 text-danger" aria-hidden />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">Can’t reach the server.</strong> What you see may be out of date, and changes can’t be saved until it
        answers again. Weave Studio keeps trying every 15 seconds.
      </p>
      <Button size="sm" variant="secondary" onClick={() => void retry()} disabled={retrying || checking}>
        <RefreshCwIcon className={retrying ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden />
        Try again
      </Button>
      {/* with no server, the studio can still be tried on sample data in this browser (it asks first, then reloads) */}
      {!isSandbox() && (
        <>
          <Button size="sm" variant="ghost" onClick={() => setOfferSandbox(true)} title="Sample agents and calls kept in this browser; nothing reaches the real API">
            <FlaskConicalIcon className="h-3.5 w-3.5" aria-hidden />
            Use Sandbox instead
          </Button>
          <SwitchSourceDialog to={offerSandbox ? 'sandbox' : null} onClose={() => setOfferSandbox(false)} />
        </>
      )}
    </div>
  );
}
