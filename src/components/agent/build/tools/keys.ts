import type React from 'react';

/**
 * Keyboard moves for an item of an ordered list: Alt + ↑ / ↓ moves it while focus is inside it (the same move as the
 * buttons, for people who don't use a mouse).
 */
export function moveKeys(index: number, count: number, onMove: (to: number) => void) {
  return (e: React.KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const to = e.key === 'ArrowUp' ? index - 1 : index + 1;
    if (to < 0 || to >= count) return;
    e.preventDefault();
    onMove(to);
  };
}

export const linkButton = 'font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded disabled:opacity-50';
