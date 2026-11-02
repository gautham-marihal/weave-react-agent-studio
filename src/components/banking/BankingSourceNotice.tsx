import React from 'react';
import type { BankingSource } from '../../api/gateway';
import { bankingStatus } from '../../models/bankingStatus';
import { StatusChip } from '../ui/StatusChip';

/** Where banking answers come from here, or why banking is not available (outside the Test stage). */
export function BankingSourceNotice({ source, className }: { source: BankingSource | null; className?: string }) {
  if (!source) return <p className={className ?? 'text-[13px] text-muted'} role="status">Finding the banking gateway…</p>;
  const status = bankingStatus(source);
  return (
    <p className={className ?? 'flex flex-wrap items-center gap-2 text-[13px] text-ink-soft'} data-banking-source={source.kind} role="status">
      <StatusChip tone={status.tone}>{status.chip}</StatusChip>
      <span>{status.text}</span>
    </p>
  );
}
