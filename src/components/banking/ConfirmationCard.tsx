import React, { useEffect, useId, useState } from 'react';
import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, LoaderCircleIcon, ShieldCheckIcon, TimerIcon, TriangleAlertIcon } from 'lucide-react';
import { formatMoney } from '../../utils/bankingFormat';
import type { ConfirmationCardState, ConfirmationPhase } from '../../hooks/useBankingChannel';
import { Button } from '../ui/Button';
import { cn } from '../../utils/styles';

const PHASE: Record<ConfirmationPhase, { label: string; icon: typeof CircleCheckIcon; tone: string }> = {
  ready: { label: 'Ready for your confirmation', icon: ShieldCheckIcon, tone: 'text-primary' },
  processing: { label: 'Processing', icon: LoaderCircleIcon, tone: 'text-info' },
  confirmed: { label: 'Completed', icon: CircleCheckIcon, tone: 'text-success' },
  failed: { label: 'Failed', icon: CircleXIcon, tone: 'text-danger' },
  unknown: { label: 'Outcome unknown', icon: TriangleAlertIcon, tone: 'text-danger' },
  cancelled: { label: 'Cancelled', icon: CircleDashedIcon, tone: 'text-muted' },
  expired: { label: 'No longer waiting', icon: CircleDashedIcon, tone: 'text-muted' },
};

const DETAIL: Partial<Record<ConfirmationPhase, string>> = {
  processing: 'Sent to the bank. Please wait and do not repeat the request.',
  unknown: 'The bank did not answer in time, so this may or may not have gone through. Please do not repeat it; a Service Manager can check.',
  cancelled: 'Nothing was sent to the bank.',
  expired: 'It was not confirmed in time, so nothing was sent.',
};

/**
 * A banking request waiting for the caller's explicit decision. The summary, charge and expiry are the gateway's
 * own; the buttons post straight to the gateway, so the assistant cannot confirm on the caller's behalf. "Completed"
 * appears only after the bank reported success.
 */
export function ConfirmationCard({ card, onDecide }: { card: ConfirmationCardState; onDecide: (decision: 'confirm' | 'cancel') => void }) {
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (card.phase !== 'ready') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [card.phase]);
  const remaining = Math.max(0, Math.ceil((card.expiresAt - now) / 1000));
  const phase: ConfirmationPhase = card.phase === 'ready' && remaining === 0 ? 'expired' : card.phase;
  const meta = PHASE[phase];
  const Icon = meta.icon;
  const message = card.message ?? DETAIL[phase];

  return (
    <section data-confirmation aria-labelledby={`${id}-title`} className="rounded-xl border-2 border-primary/40 bg-surface p-4 shadow-panel">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Bank request</p>
      <h3 id={`${id}-title`} className="mt-1 text-sm font-semibold text-ink">
        {card.summary}
      </h3>
      {card.charge && <p className="mt-1 text-[13px] text-ink-soft">Charge: {formatMoney(card.charge)}</p>}

      <p className={cn('mt-3 flex items-center gap-1.5 text-[13px] font-medium', meta.tone)} role="status" aria-live={phase === 'failed' || phase === 'unknown' ? 'assertive' : 'polite'}>
        <Icon className={cn('h-4 w-4', phase === 'processing' && 'animate-spin motion-reduce:animate-none')} aria-hidden />
        {meta.label}
        {phase === 'ready' && (
          <span className={cn('ml-auto flex items-center gap-1 font-normal', remaining <= 30 ? 'text-warning' : 'text-muted')}>
            <TimerIcon className="h-3 w-3" aria-hidden />
            {remaining}s to decide
          </span>
        )}
      </p>
      {message && <p className="mt-1 text-[13px] text-ink-soft">{message}</p>}
      {card.reference && <p className="mt-1 font-mono text-[12px] text-muted">Reference {card.reference}</p>}

      {phase === 'ready' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" className="h-11" onClick={() => onDecide('cancel')}>
            Cancel
          </Button>
          <Button variant="primary" className="h-11" onClick={() => onDecide('confirm')}>
            Confirm
          </Button>
        </div>
      )}
    </section>
  );
}
