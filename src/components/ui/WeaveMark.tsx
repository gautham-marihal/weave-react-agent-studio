import React from 'react';
import { cn } from '../../utils/styles';

export function WeaveMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <img
      src="/icon.png"
      alt="Weave Studio"
      className={cn('shrink-0 rounded-md object-contain select-none', className)}
      draggable={false}
    />
  );
}