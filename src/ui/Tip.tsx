import { useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Tooltip } from 'radix-ui';

// A short tip beside a button (Radix Tooltip), for icon-only buttons or one more line. Unlike `title` it shows
// promptly, on hover and keyboard focus, in the studio's look, and a screen reader reads it with the button.
// TipProvider, once around the app, sets the delays: the first tip after a moment, the next ones at once.
//   label: what the tip says (nothing: no tip)   side: where it shows ('bottom' unless given)
//   hoverOnly: for a button that opens a menu or panel and gets focus back, so the tip doesn't pop up each time
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    // a tip has nothing to click, so it closes as the pointer leaves its button (no grace moment to reach the tip)
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
