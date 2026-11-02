import React from 'react';
import { cn } from '../../utils/styles';

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'primary';

interface StatusChipProps {
  tone?: ChipTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
}

const tones: Record<ChipTone, string> = {
  neutral: 'bg-subtle text-ink-soft',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
  primary: 'bg-primary-soft text-primary'
};

export function StatusChip({ tone = 'neutral', dot = false, children, className, title }: StatusChipProps) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>
      
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>);

}