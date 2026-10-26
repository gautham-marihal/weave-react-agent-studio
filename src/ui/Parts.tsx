import type { KeyboardEvent, ReactNode } from 'react';
import { Tabs } from 'radix-ui';

// The parts of a page to switch between (Radix Tabs): one Tab stop for the row, the arrows move along it (and round),
// Home and End go to the ends, and Enter or Space opens the part the keyboard is on (the arrows alone don't, so a part
// that changes the page's address is never opened by passing over it).
//   <Parts value onChange> holds a row and its panel, and draws no box of its own: the page lays out the row and the panel as before
//   <PartRow label items value>: the row (label names it for a screen reader; the open part has the class `on`, or activeClass)
//   <PartPanel value>: what the open part shows (a grid with the page's gap; `flow` for a page that isn't a grid)
export type Part = { id: string; label: ReactNode; badge?: ReactNode };

export function Parts({ value, onChange, children }: { value: string; onChange: (id: string) => void; children: ReactNode }) {
  return (
    <Tabs.Root className="rxParts" value={value} onValueChange={onChange} activationMode="manual">
      {children}
    </Tabs.Root>
  );
}

// A part can draw the page anew (another address; a part whose code loads first hides the page a moment), and the
// keyboard, which was on the part just chosen, would be left on nothing. For a few seconds after a choice, whenever it
// is left on nothing, the row's open part takes it back. It stops as soon as the keyboard goes anywhere else, or the
// pointer is pressed elsewhere.
function keepOnRow(label: string) {
  const until = Date.now() + 3000;
  let done = false;
  const stop = () => {
    done = true;
  };
  document.addEventListener('pointerdown', stop, { capture: true, once: true });
  const step = () => {
    const rows = [...document.querySelectorAll<HTMLElement>('[role="tablist"]')].filter((r) => r.getAttribute('aria-label') === label);
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if (done || Date.now() > until || (!lost && !rows.some((r) => r.contains(active)))) {
      document.removeEventListener('pointerdown', stop, { capture: true });
      return;
    }
    if (lost) {
      const open = rows.map((r) => r.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')).find((t) => t && t.getClientRects().length > 0);
      open?.focus({ preventScroll: true });
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function PartRow({
  label,
  items,
  value,
  className = '',
  activeClass = 'on',
}: {
  label: string;
  items: Part[];
  value: string;
  className?: string;
  activeClass?: string;
}) {
  const choosing = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') keepOnRow(label);
  };
  return (
    <Tabs.List className={className} aria-label={label} onKeyDown={choosing} onPointerDown={() => keepOnRow(label)}>
      {items.map((p) => (
        <Tabs.Trigger key={p.id} value={p.id} className={value === p.id ? activeClass : ''}>
          {p.label}
          {p.badge ? <b>{p.badge}</b> : null}
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  );
}

export function PartPanel({ value, className = '', children }: { value: string; className?: string; children: ReactNode }) {
  return (
    <Tabs.Content value={value} className={`rxPartPanel ${className}`}>
      {children}
    </Tabs.Content>
  );
}
