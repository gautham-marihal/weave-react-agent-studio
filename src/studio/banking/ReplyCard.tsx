import Icon from '../../ui/Icon.jsx';
import Tip from '../../ui/Tip.tsx';
import type { BalanceSnapshot, Card, ChoicePurpose } from './assistantModel.ts';
import { cn, toneBox, toneText, type Tone } from './ui.tsx';

// (Lines are <div>s, not <p>s: the Test tab styles a bubble's paragraphs as the bubble itself.)
// The structured part of a rehearsal reply, under its words in the conversation: a balance, a list, choices to tap,
// or an outcome notice. Every figure is the gateway's own (already formatted by it); nothing is computed here.

const TERMS = {
  available: 'What can be used now: the balance less holds and cheques still clearing.',
  pending: 'Cheques deposited that have not cleared yet. They count in the balance but cannot be used yet.',
  hold: 'An amount the bank has set aside (earmarked), for example for a pending instruction.',
  overdraft: 'The overdraft facility on this account, as reported by the bank system.',
};

const NOTICE_TONE: Record<'success' | 'warning' | 'danger' | 'info', { tone: Tone; icon: string }> = {
  success: { tone: 'success', icon: 'done' },
  info: { tone: 'neutral', icon: 'info' },
  warning: { tone: 'warning', icon: 'alert' },
  danger: { tone: 'danger', icon: 'failed' },
};

const cardClass = 'tw-mt-2 tw-rounded-card tw-border tw-border-solid tw-border-line tw-bg-surface tw-text-ink';

/** "-SGD 1,820.05": the sign becomes words and colour, never a lone minus. */
function Money({ display }: { display: string }) {
  const value = display.trim();
  const negative = value.startsWith('-');
  return (
    <span className={cn('tw-font-mono tw-tabular-nums', negative && 'tw-text-danger')}>
      {negative && <span className="srOnly">minus </span>}
      {negative ? `−${value.slice(1)}` : value}
    </span>
  );
}

function Term({ label, help }: { label: string; help: string }) {
  return (
    <span className="tw-inline-flex tw-items-center tw-gap-1 tw-text-ink-soft">
      {label}
      <Tip label={help}>
        <button type="button" className="tw-border-0 tw-bg-transparent tw-p-0 tw-text-muted hover:tw-text-ink" aria-label={`What is “${label}”? ${help}`}>
          <Icon name="info" size={13} />
        </button>
      </Tip>
    </span>
  );
}

/** A balance exactly as the gateway returned it; multi-currency accounts switch currency, never convert. */
export function BalanceCard({
  balance,
  busy,
  onCurrency,
  onRefresh,
}: {
  balance: BalanceSnapshot;
  busy: boolean;
  onCurrency?: (currency: string) => void;
  /** Asks the bank again (the account overview's card). */
  onRefresh?: () => void;
}) {
  const lines = [
    balance.pendingClearance && { key: 'pending', label: 'Pending clearance', help: TERMS.pending, value: balance.pendingClearance },
    balance.hold && { key: 'hold', label: 'Hold amount', help: TERMS.hold, value: balance.hold },
    balance.overdraftLimit && { key: 'overdraft', label: 'Overdraft limit', help: TERMS.overdraft, value: balance.overdraftLimit },
  ].filter((line): line is { key: string; label: string; help: string; value: string } => Boolean(line));

  return (
    <section aria-label={`Balance of ${balance.accountType} ${balance.ending}`} className={cn(cardClass, 'tw-p-3')}>
      <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-2">
        <div className="tw-min-w-0">
          <div className="tw-m-0 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-muted">{balance.accountType}</div>
          <div className="tw-m-0 tw-font-mono tw-text-sm tw-text-ink-soft">•••• {balance.ending.replace(/\D/g, '')}</div>
        </div>
        {balance.currencies.length > 1 && onCurrency ? (
          <div role="group" aria-label="Currency" className="tw-flex tw-gap-1">
            {balance.currencies.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => c !== balance.currency && onCurrency(c)}
                disabled={busy}
                aria-pressed={c === balance.currency}
                className={cn(
                  'tw-h-7 tw-rounded-control tw-border tw-border-solid tw-px-2 tw-font-mono tw-text-xs',
                  c === balance.currency
                    ? 'tw-border-accent tw-bg-accent-soft tw-text-ink'
                    : 'tw-border-line tw-bg-transparent tw-text-ink-soft hover:tw-bg-subtle',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        ) : (
          <span className="tw-rounded-control tw-bg-subtle tw-px-2 tw-py-0.5 tw-font-mono tw-text-xs tw-text-ink-soft">{balance.currency}</span>
        )}
      </div>
      <div className="tw-mb-0 tw-mt-3 tw-text-xs tw-text-ink-soft">
        {balance.current.trim().startsWith('-') ? 'Current balance (debit)' : 'Current balance'}
      </div>
      <div className="tw-m-0 tw-text-xl tw-font-semibold">
        <Money display={balance.current} />
      </div>
      <dl className="tw-mb-0 tw-mt-3 tw-space-y-1.5 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-pt-3 tw-text-sm">
        {[{ key: 'available', label: 'Available balance', help: TERMS.available, value: balance.available }, ...lines].map((line) => (
          <div key={line.key} className="tw-flex tw-items-center tw-justify-between tw-gap-3">
            <dt>
              <Term label={line.label} help={line.help} />
            </dt>
            <dd className="tw-m-0 tw-text-ink">
              <Money display={line.value} />
            </dd>
          </div>
        ))}
      </dl>
      {balance.inDebit && (
        <div className={cn('tw-mb-0 tw-mt-3 tw-rounded-control tw-border tw-border-solid tw-px-3 tw-py-2 tw-text-xs', toneBox.danger)}>
          This account is overdrawn. The amount shown is a debit balance: money owed to the bank, not money available.
        </div>
      )}
      {balance.facilityNotice && (
        <div className={cn('tw-mb-0 tw-mt-2 tw-rounded-control tw-border tw-border-solid tw-px-3 tw-py-2 tw-text-xs', toneBox.warning)}>
          Availability of balances for use is subject to the facility limits for omnibus and/or shared facilities.
        </div>
      )}
      <div className="tw-mt-3 tw-flex tw-items-center tw-justify-between tw-gap-2 tw-text-xs tw-text-muted">
        <span>
          Retrieved {new Date(balance.retrievedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} from the bank system
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            aria-label="Refresh this balance"
            className="tw-inline-flex tw-items-center tw-gap-1 tw-border-0 tw-bg-transparent tw-px-1 tw-text-xs tw-text-ink-soft hover:tw-text-ink disabled:tw-opacity-50"
          >
            <Icon name="refresh" size={12} className={busy ? 'tw-animate-spin motion-reduce:tw-animate-none' : undefined} />
            Refresh
          </button>
        )}
      </div>
    </section>
  );
}

export default function ReplyCard({
  card,
  latest,
  busy,
  onChoose,
  onCurrency,
  answered,
}: {
  card: Card;
  /** Choices can be answered on the latest reply only. */
  latest: boolean;
  /** The option already chosen on this reply, if any. */
  answered?: string;
  busy: boolean;
  onChoose: (purpose: ChoicePurpose, id: string, label: string) => void;
  onCurrency: (accountRef: string, currency: string) => void;
}) {
  switch (card.kind) {
    case 'balance': {
      const ref = card.balance.accountRef;
      return <BalanceCard balance={card.balance} busy={busy} onCurrency={ref ? (c) => onCurrency(ref, c) : undefined} />;
    }
    case 'list':
      return (
        <section aria-label={card.title} className={cardClass}>
          <h4 className="tw-m-0 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2 tw-text-xs tw-font-semibold">{card.title}</h4>
          <ul className="tw-m-0 tw-list-none tw-p-0">
            {card.items.map((item, i) => (
              <li
                key={i}
                className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-3 tw-py-2 tw-text-sm last:tw-border-b-0"
              >
                <span className="tw-min-w-0">
                  <span className="tw-block tw-truncate">{item.primary}</span>
                  {item.secondary && <span className="tw-block tw-truncate tw-text-xs tw-text-muted">{item.secondary}</span>}
                </span>
                {item.amount && (
                  <span
                    className={cn(
                      'tw-shrink-0 tw-font-mono tw-tabular-nums',
                      item.tone === 'credit' ? 'tw-text-success' : item.tone === 'debit' ? 'tw-text-ink' : 'tw-text-ink-soft',
                    )}
                  >
                    {item.tone === 'credit' ? '+' : ''}
                    {item.amount.replace(/^-/, '−')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {card.footnote && (
            <div className="tw-m-0 tw-border-0 tw-border-t tw-border-solid tw-border-line tw-px-3 tw-py-2 tw-text-xs tw-text-muted">{card.footnote}</div>
          )}
        </section>
      );
    case 'choices':
      return (
        <div role="group" aria-label={answered ? 'Chosen' : 'Choose one'} className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-2">
          {card.options.map((o) => {
            const chosen = answered === o.id;
            return (
              <button
                key={o.id}
                type="button"
                // answered once: the question is settled, so the card closes (the chosen one stays marked)
                disabled={!latest || busy || Boolean(answered)}
                aria-pressed={answered ? chosen : undefined}
                onClick={() => onChoose(card.purpose, o.id, o.label)}
                className={cn(
                  'tw-min-h-10 tw-rounded-control tw-border tw-border-solid tw-px-3 tw-py-1.5 tw-text-left tw-text-sm tw-text-ink disabled:tw-cursor-default',
                  chosen
                    ? 'tw-border-accent tw-bg-accent-soft'
                    : 'tw-border-line-strong tw-bg-surface hover:tw-border-accent hover:tw-bg-accent-soft disabled:tw-opacity-60 disabled:hover:tw-border-line-strong disabled:hover:tw-bg-surface',
                )}
              >
                <span className="tw-flex tw-items-center tw-gap-1.5 tw-font-medium">
                  {chosen && <Icon name="check" size={14} />}
                  {o.label}
                </span>
                {o.hint && <span className="tw-block tw-text-xs tw-text-muted">{o.hint}</span>}
              </button>
            );
          })}
        </div>
      );
    case 'notice': {
      const { tone, icon } = NOTICE_TONE[card.tone];
      return (
        <div className={cn('tw-mt-2 tw-flex tw-gap-2 tw-rounded-control tw-border tw-border-solid tw-px-3 tw-py-2 tw-text-sm', toneBox[tone])}>
          <span className={cn('tw-mt-0.5 tw-shrink-0', toneText[tone])}>
            <Icon name={icon} size={16} />
          </span>
          <span>
            <span className="tw-block tw-font-medium tw-text-ink">{card.title}</span>
            {card.text && <span className="tw-block tw-text-ink-soft">{card.text}</span>}
          </span>
        </div>
      );
    }
  }
}
