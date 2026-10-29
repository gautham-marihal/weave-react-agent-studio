import { useEffect, useId, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { formatMoney } from './format.ts';
import type { ConfirmationCardState, ConfirmationPhase } from './useBankingChannel.ts';
import { cn, secureClass, toneText, type Tone } from './ui.tsx';

const PHASE: Record<ConfirmationPhase, { label: string; icon: string; tone: Tone }> = {
  ready: { label: 'Ready for your confirmation', icon: 'shield', tone: 'accent' },
  processing: { label: 'Processing', icon: 'loader', tone: 'neutral' },
  confirmed: { label: 'Completed', icon: 'done', tone: 'success' },
  failed: { label: 'Failed', icon: 'failed', tone: 'danger' },
  unknown: { label: 'Outcome unknown', icon: 'alert', tone: 'danger' },
  cancelled: { label: 'Cancelled', icon: 'pending', tone: 'neutral' },
  expired: { label: 'No longer waiting', icon: 'pending', tone: 'neutral' },
};

const DETAIL: Partial<Record<ConfirmationPhase, string>> = {
  processing: 'Sent to the bank. Please wait and do not repeat the request.',
  unknown: 'The bank did not answer in time, so this may or may not have gone through. Please do not repeat it; a Service Manager can check.',
  cancelled: 'Nothing was sent to the bank.',
  expired: 'It was not confirmed in time, so nothing was sent.',
};

/**
 * A banking request waiting for the caller's explicit decision. The summary, charge and expiry are the gateway's
 * own; the buttons post straight to the gateway, so the agent cannot confirm on the caller's behalf. "Completed"
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
  const message = card.message ?? DETAIL[phase];

  return (
    <section data-confirmation aria-labelledby={`${id}-title`} className={secureClass}>
      <p className="tw-m-0 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted">Bank request</p>
      <h3 id={`${id}-title`} className="tw-mb-0 tw-mt-1 tw-text-md tw-font-semibold tw-text-ink">
        {card.summary}
      </h3>
      {card.charge && <p className="tw-mb-0 tw-mt-1 tw-text-sm tw-text-ink-soft">Charge: {formatMoney(card.charge)}</p>}

      <p
        className={cn('tw-mb-0 tw-mt-3 tw-flex tw-items-center tw-gap-1.5 tw-text-sm tw-font-medium', toneText[meta.tone])}
        role="status"
        aria-live={phase === 'failed' || phase === 'unknown' ? 'assertive' : 'polite'}
      >
        <Icon name={meta.icon} size={16} className={phase === 'processing' ? 'tw-animate-spin motion-reduce:tw-animate-none' : undefined} />
        {meta.label}
        {phase === 'ready' && (
          <span className={cn('tw-ml-auto tw-flex tw-items-center tw-gap-1 tw-font-normal', remaining <= 30 ? 'tw-text-warning' : 'tw-text-muted')}>
            <Icon name="timer" size={12} />
            {remaining}s to decide
          </span>
        )}
      </p>
      {message && <p className="tw-mb-0 tw-mt-1 tw-text-sm tw-text-ink-soft">{message}</p>}
      {card.reference && <p className="tw-mb-0 tw-mt-1 tw-font-mono tw-text-xs tw-text-muted">Reference {card.reference}</p>}

      {phase === 'ready' && (
        <div className="tw-mt-3 tw-grid tw-grid-cols-2 tw-gap-2">
          <Button type="button" variant="secondary" onClick={() => onDecide('cancel')}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => onDecide('confirm')}>
            Confirm
          </Button>
        </div>
      )}
    </section>
  );
}
