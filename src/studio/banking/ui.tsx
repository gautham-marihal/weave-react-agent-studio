import type { ComponentProps } from 'react';

// The small pieces the banking surfaces share, in the workspace's Tailwind (tw-, the app's own colour tokens).

export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

/** A text field or select in the banking surfaces. */
export const inputClass =
  'tw-w-full tw-rounded-control tw-border tw-border-solid tw-border-line-strong tw-bg-surface tw-px-3 tw-py-2 tw-text-md tw-text-ink disabled:tw-cursor-not-allowed disabled:tw-opacity-60';

/** The box a section of the banking panel sits in. */
export const panelClass = 'tw-rounded-card tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-4';

/** A surface only the bank can draw (secure keypad, confirmation): set apart so a chat message cannot imitate it. */
export const secureClass = 'tw-rounded-card tw-border-2 tw-border-solid tw-border-accent-line tw-bg-surface tw-p-4 tw-shadow-md';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const CHIP: Record<Tone, string> = {
  neutral: 'tw-border-line tw-bg-subtle tw-text-muted',
  success: 'tw-border-success-line tw-bg-success-soft tw-text-success',
  warning: 'tw-border-warning-line tw-bg-warning-soft tw-text-warning',
  danger: 'tw-border-danger-line tw-bg-danger-soft tw-text-danger',
  accent: 'tw-border-accent-line tw-bg-accent-soft tw-text-accent-ink',
};

/** A tone's soft box (notices, outcome cards). */
export const toneBox: Record<Tone, string> = {
  neutral: 'tw-border-line tw-bg-subtle',
  success: 'tw-border-success-line tw-bg-success-soft',
  warning: 'tw-border-warning-line tw-bg-warning-soft',
  danger: 'tw-border-danger-line tw-bg-danger-soft',
  accent: 'tw-border-accent-line tw-bg-accent-soft',
};

/** A tone's text colour. */
export const toneText: Record<Tone, string> = {
  neutral: 'tw-text-muted',
  success: 'tw-text-success',
  warning: 'tw-text-warning',
  danger: 'tw-text-danger',
  accent: 'tw-text-accent-ink',
};

/** A small label for a state. The words carry the meaning; the colour only helps. */
export function Chip({ tone = 'neutral', dot = false, className, children, ...rest }: ComponentProps<'span'> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        'tw-inline-flex tw-items-center tw-gap-1 tw-whitespace-nowrap tw-rounded-full tw-border tw-border-solid tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium',
        CHIP[tone],
        className,
      )}
      {...rest}
    >
      {dot && <i aria-hidden="true" className="tw-h-1.5 tw-w-1.5 tw-rounded-full tw-bg-current" />}
      {children}
    </span>
  );
}

/** A row of choices (OneOf) in the app's segmented look, kept where it is written: the preview's look (loaded later, on demand) reorders it. */
export const segmentClass = 'pvModes !tw-order-none tw-self-start';
