import React from 'react';
import { Link } from 'react-router-dom';
import { AudioLinesIcon, ChevronRightIcon, PhoneIcon, PlugIcon } from 'lucide-react';

// Shortcuts to the shared library, each opening its own tab of the Library page.
const actions = [
  { to: '/library?tab=voices', icon: AudioLinesIcon, title: 'Explore voices', text: 'Find a voice that fits' },
  { to: '/library?tab=numbers', icon: PhoneIcon, title: 'Phone numbers', text: 'Numbers people call your agents on' },
  { to: '/library?tab=integrations', icon: PlugIcon, title: 'Integrations', text: 'Systems your agents’ tools can call' },
];

export function QuickActions() {
  return (
    <section aria-labelledby="quick-actions">
      <h2 id="quick-actions" className="text-sm font-semibold text-ink">
        Workspace tools
      </h2>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {actions.map((a) => (
          <li key={a.to}>
            <Link
              to={a.to}
              className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden>
                <a.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{a.title}</span>
                <span className="block truncate text-xs text-muted">{a.text}</span>
              </span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
