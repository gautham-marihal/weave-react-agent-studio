import React from 'react';
import { AlertTriangleIcon, InfoIcon, RefreshCwIcon } from 'lucide-react';
import type { BalanceSnapshot } from './bankingAssistant';
import { Tooltip } from '../../components/ui/Tooltip';
import { cn } from '../../utils/styles';

const TERMS: Record<'available' | 'pending' | 'hold' | 'overdraft', string> = {
  available: 'What you can use now: the balance less holds and cheques still clearing.',
  pending: 'Cheques you deposited that have not cleared yet. They count in the balance but cannot be used yet.',
  hold: 'An amount the bank has set aside (earmarked), for example for a pending instruction.',
  overdraft: 'The overdraft facility on this account, as reported by the bank system.',
};

/** "-SGD 1,820.05" → { negative, text: "SGD 1,820.05" }: the sign becomes words and colour, never a lone minus. */
function amount(display: string) {
  const negative = display.trim().startsWith('-');
  return { negative, text: negative ? display.trim().slice(1) : display.trim() };
}

function Term({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-soft">
      {label}
      <Tooltip content={<span className="block max-w-[240px]">{help}</span>}>
        <button type="button" className="rounded text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`What is "${label}"? ${help}`}>
          <InfoIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tooltip>
    </span>
  );
}

function Money({ display, className }: { display: string; className?: string }) {
  const a = amount(display);
  return (
    <span className={cn('font-mono tabular-nums', a.negative && 'text-danger', className)}>
      {a.negative && <span className="sr-only">minus </span>}
      {a.negative ? `−${a.text}` : a.text}
    </span>
  );
}

/**
 * A balance exactly as the gateway returned it: current and available, then only the breakdown lines the bank
 * system reported. Debit balances are labelled in words; multi-currency accounts switch currency, never convert.
 */
export function BalanceCard({
  balance,
  onCurrency,
  onRefresh,
  busy,
  compact,
}: {
  balance: BalanceSnapshot;
  onCurrency?: (currency: string) => void;
  onRefresh?: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const current = amount(balance.current);
  const breakdown = [
    balance.pendingClearance ? { key: 'pending', label: 'Pending clearance', help: TERMS.pending, value: balance.pendingClearance } : null,
    balance.hold ? { key: 'hold', label: 'Hold amount', help: TERMS.hold, value: balance.hold } : null,
    balance.overdraftLimit ? { key: 'overdraft', label: 'Overdraft limit', help: TERMS.overdraft, value: balance.overdraftLimit } : null,
  ].filter((x): x is { key: string; label: string; help: string; value: string } => x !== null);

  return (
    <section aria-label={`Balance of ${balance.accountType} ${balance.ending}`} className={cn('rounded-xl border border-line bg-surface shadow-panel', compact ? 'p-3' : 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{balance.accountType}</p>
          <p className="font-mono text-[13px] text-ink-soft">•••• {balance.ending.replace(/\D/g, '')}</p>
        </div>
        {balance.currencies.length > 1 && onCurrency ? (
          <div role="group" aria-label="Currency" className="flex gap-1">
            {balance.currencies.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => c !== balance.currency && onCurrency(c)}
                disabled={busy}
                aria-pressed={c === balance.currency}
                className={cn(
                  'h-7 rounded-md border px-2 font-mono text-[12px] transition-colors motion-reduce:transition-none',
                  c === balance.currency ? 'border-primary bg-primary-soft text-ink' : 'border-line text-ink-soft hover:bg-subtle'
                )}
              >
                {c}
              </button>
            ))}
          </div>
        ) : (
          <span className="rounded-md bg-subtle px-2 py-0.5 font-mono text-[12px] text-ink-soft">{balance.currency}</span>
        )}
      </div>

      <div className="mt-3">
        <p className="text-[12px] text-ink-soft">{current.negative ? 'Current balance (debit)' : 'Current balance'}</p>
        <p className={cn('mt-0.5 font-semibold tracking-tight', compact ? 'text-xl' : 'text-2xl')}>
          <Money display={balance.current} />
        </p>
      </div>

      <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <dt>
            <Term label="Available balance" help={TERMS.available} />
          </dt>
          <dd className="font-medium text-ink">
            <Money display={balance.available} />
          </dd>
        </div>
        {breakdown.map((b) => (
          <div key={b.key} className="flex items-center justify-between gap-3">
            <dt>
              <Term label={b.label} help={b.help} />
            </dt>
            <dd className="text-ink">
              <Money display={b.value} />
            </dd>
          </div>
        ))}
      </dl>

      {balance.inDebit && (
        <p className="mt-3 flex gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12px] text-ink">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
          This account is overdrawn. The amount shown is a debit balance: money owed to the bank, not money available.
        </p>
      )}
      {balance.facilityNotice && (
        <p className="mt-2 flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-ink">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          Availability of balances for use is subject to the facility limits for omnibus and/or shared facilities.
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>Retrieved {new Date(balance.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} from the bank system</span>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={busy} className="inline-flex items-center gap-1 rounded px-1 text-ink-soft hover:text-ink disabled:opacity-50" aria-label="Refresh this balance">
            <RefreshCwIcon className={cn('h-3 w-3', busy && 'animate-spin motion-reduce:animate-none')} aria-hidden />
            Refresh
          </button>
        )}
      </div>
    </section>
  );
}
