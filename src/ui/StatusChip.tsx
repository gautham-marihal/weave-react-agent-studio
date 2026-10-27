import type { ComponentProps } from 'react';

// A small coloured label for a state ("Valid", "Live", "Draft"). The words carry the meaning; the colour only helps.

export type ChipTone = 'good' | 'bad' | 'review' | 'draft' | 'dev' | 'live';

interface StatusChipProps extends ComponentProps<'span'> {
  tone: ChipTone;
}

export default function StatusChip({ tone, className, ...rest }: StatusChipProps) {
  return <span className={['stPill', tone, className].filter(Boolean).join(' ')} {...rest} />;
}
