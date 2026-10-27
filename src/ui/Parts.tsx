import type { KeyboardEvent, ReactNode } from 'react';
import { Tabs } from 'radix-ui';

// A page's parts to switch between (Radix Tabs): one Tab stop, arrows move (and wrap), Home and End go to the ends, and
// only Enter or Space opens a part, so a part that changes the address is never opened by passing over it.
//   <Parts value onChange>: holds a row and its panel, with no box of its own
//   <PartRow label items value>: the row (label names it for screen readers; the open part has `on`, or activeClass)
//   <PartPanel value>: the open part's content (a grid with the page's gap; `flow` for a page that isn't a grid)
export type Part = { id: string; label: ReactNode; badge?: ReactNode };

export function Parts({ value, onChange, children }: { value: string; onChange: (id: string) => void; children: ReactNode }) {
  return (
    <Tabs.Root className="rxParts" value={value} onValueChange={onChange} activationMode="manual">
      {children}
    </Tabs.Root>
  );
}

// Choosing a part can redraw the page (another address, or code loading), leaving focus on nothing. For a few seconds
// after a choice the row's open part takes focus back, until focus goes elsewhere or the pointer is pressed elsewhere.
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
