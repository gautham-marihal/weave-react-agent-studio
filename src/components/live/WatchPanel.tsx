import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLinkIcon, XIcon } from 'lucide-react';
import { useTraceRecords } from '../../hooks/useTraceRecords';
import { CallFacts, CallRecordBody } from '../calls/CallRecordBody';
import { maskCaller, type LiveCall } from '../../models/live';

// Watch one call beside the board: its facts and everything that happens in it, followed live. It only reads.
// Escape or the close button closes it; focus goes back where it was.
export function WatchPanel({
  agentId,
  callId,
  agentName,
  card,
  hideCaller,
  onOpen,
  onClose,
}: {
  agentId: string;
  callId: string;
  agentName: string;
  /** The call as the board sees it now (whether it ended), when it is still on the board. */
  card: LiveCall | null;
  hideCaller: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const data = useTraceRecords(agentId, callId);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus?.();
    };
  }, []);

  const ended = card ? card.status !== 'live' : data.call ? data.call.status !== 'in_progress' : false;
  const cutOff = card?.status === 'cut_off' || data.call?.status === 'unfinished';

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="watch-panel"
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-line bg-canvas shadow-overlay"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold text-ink">
              {agentName}
              {card?.caller ? ` · ${card.caller}` : ''}
            </h2>
            <p className="text-xs text-muted">Watching a call. Nothing here changes it.</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-subtle">
              <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
              Open call
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {ended && (
            <p role="status" className={cutOff ? 'rounded-lg bg-warning-soft px-3 py-2 text-xs text-ink-soft' : 'rounded-lg bg-success-soft px-3 py-2 text-xs text-ink-soft'}>
              {cutOff ? 'This call was cut off.' : 'This call has ended.'}
            </p>
          )}
          {/* on the board a number shows only its last digits; so it does here */}
          {data.call && <CallFacts call={{ ...data.call, caller: maskCaller(data.call.caller) }} data={data} className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line bg-surface p-4 text-xs sm:grid-cols-3" />}
          <CallRecordBody agentId={agentId} callId={callId} data={data} agentName={agentName} hideCaller={hideCaller} />
        </div>
      </div>
    </div>,
    document.body
  );
}
