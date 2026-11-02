import React from 'react';
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, XCircleIcon } from 'lucide-react';
import type { Card, ChoicePurpose } from './bankingAssistant';
import { cn } from '../../utils/styles';
import { BalanceCard } from './BalanceCard';

const NOTICE = {
  success: { icon: CheckCircle2Icon, box: 'border-success/30 bg-success-soft', icon_: 'text-success' },
  info: { icon: InfoIcon, box: 'border-line bg-subtle', icon_: 'text-muted' },
  warning: { icon: AlertTriangleIcon, box: 'border-warning/30 bg-warning-soft', icon_: 'text-warning' },
  danger: { icon: XCircleIcon, box: 'border-danger/30 bg-danger-soft', icon_: 'text-danger' },
} as const;

/** The structured part of an assistant reply: a balance, a list, choices to tap, or an outcome notice. */
export function MessageCard({
  card,
  latest,
  busy,
  onChoose,
  onCurrency,
}: {
  card: Card;
  /** Choices are answerable only on the latest message. */
  latest: boolean;
  busy: boolean;
  onChoose: (purpose: ChoicePurpose, id: string, label: string) => void;
  onCurrency: (accountRef: string, currency: string) => void;
}) {
  switch (card.kind) {
    case 'balance':
      return <BalanceCard balance={card.balance} compact busy={busy} onCurrency={card.balance.accountRef ? (c) => onCurrency(card.balance.accountRef as string, c) : undefined} />;
    case 'list':
      return (
        <section aria-label={card.title} className="rounded-xl border border-line bg-surface shadow-panel">
          <h4 className="border-b border-line px-3 py-2 text-[12px] font-semibold text-ink">{card.title}</h4>
          <ul className="divide-y divide-line">
            {card.items.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate text-ink">{item.primary}</span>
                  {item.secondary && <span className="block truncate text-[12px] text-muted">{item.secondary}</span>}
                </span>
                {item.amount && (
                  <span className={cn('shrink-0 font-mono tabular-nums', item.tone === 'credit' ? 'text-success' : item.tone === 'debit' ? 'text-ink' : 'text-ink-soft')}>
                    {item.tone === 'credit' ? '+' : ''}
                    {item.amount.replace(/^-/, '−')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {card.footnote && <p className="border-t border-line px-3 py-2 text-[12px] text-muted">{card.footnote}</p>}
        </section>
      );
    case 'choices':
      return (
        <div role="group" aria-label="Choose one" className="flex flex-wrap gap-2">
          {card.options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={!latest || busy}
              onClick={() => onChoose(card.purpose, o.id, o.label)}
              className="min-h-[40px] rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-left text-[13px] text-ink shadow-sm transition-colors hover:border-primary hover:bg-primary-soft disabled:cursor-default disabled:opacity-60 disabled:hover:border-line-strong disabled:hover:bg-surface motion-reduce:transition-none"
            >
              <span className="block font-medium">{o.label}</span>
              {o.hint && <span className="block text-[11px] text-muted">{o.hint}</span>}
            </button>
          ))}
        </div>
      );
    case 'notice': {
      const style = NOTICE[card.tone];
      const Icon = style.icon;
      return (
        <div className={cn('flex gap-2 rounded-lg border px-3 py-2 text-[13px]', style.box)}>
          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.icon_)} aria-hidden />
          <span>
            <span className="block font-medium text-ink">{card.title}</span>
            {card.text && <span className="block text-ink-soft">{card.text}</span>}
          </span>
        </div>
      );
    }
  }
}
