import { useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Tooltip } from 'radix-ui';

// A short tip beside a button (Radix Tooltip): for an icon with no words, or a button whose words need one more line.
// It shows when the pointer rests on the button or the keyboard reaches it (the browser's own `title` tip shows late,
// looks like no part of the studio, and never for the keyboard), and a screen reader reads it with the button.
// TipProvider, once around the app, sets the delays: the first tip after a moment, the next ones at once.
//   label: what the tip says (nothing: no tip)   side: where it shows ('bottom' unless said)   children: the one button it is about
//   hoverOnly: for a button that opens a menu or a panel, which is given the
//   keyboard back when that closes: its tip shows for the pointer only, so it
//   does not pop up each time the menu closes
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    // a tip holds nothing to point at, so it closes as soon as the pointer leaves its button (not after a grace moment for reaching the tip)
    <Tooltip.Provider delayDuration={350} skipDelayDuration={250} disableHoverableContent>
      {children}
    </Tooltip.Provider>
  );
}

export default function Tip({
  label,
  side = 'bottom',
  align = 'center',
  hoverOnly = false,
  children,
}: {
  label: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  hoverOnly?: boolean;
  children: ReactElement;
}) {
  const hovering = useRef(false);
  const [open, setOpen] = useState(false);
  if (!label) return children;
  const control = hoverOnly ? { open, onOpenChange: (next: boolean) => setOpen(next && hovering.current) } : {};
  return (
    <Tooltip.Root {...control}>
      <Tooltip.Trigger
        asChild
        onPointerEnter={() => {
          hovering.current = true;
        }}
        onPointerLeave={() => {
          hovering.current = false;
        }}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="rxTip rxLayer" side={side} align={align} sideOffset={6} collisionPadding={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
