import React from 'react';
import { cn } from '../../utils/styles';

export type BadgeVariant = 'success' | 'danger' | 'neutral' | 'outline' | 'warning';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
  mono?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-success-soft text-success border border-success/20',
  danger: 'bg-danger-soft text-danger border border-danger/20',
  neutral: 'bg-subtle text-ink-soft border border-line',
  outline: 'bg-transparent text-ink border border-line-strong font-mono',
  warning: 'bg-warning-soft text-warning border border-warning/20',
};

export function Badge({
  variant = 'neutral',
  dot = false,
  mono = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium select-none whitespace-nowrap transition-colors',
        mono && 'font-mono',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  );
}
