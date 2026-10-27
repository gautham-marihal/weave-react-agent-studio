import React from 'react';
import { navigate, routeHref } from '../../route.js';
import { PAGES, STAGES } from '../pages.js';

// Monitor's pages (Calls, Monitoring, Questions, Speed) as tabs above the open page, styled like Build's views.
const MONITOR = STAGES.find((stage) => stage.id === 'monitor').pages.map((id) => PAGES.find((p) => p.id === id));

export default function MonitorTabs({ botId, page, children }) {
  return (
    <>
      <nav aria-label="Monitor" className="segmented tw-mb-6 tw-w-fit">
        {MONITOR.map((p) => (
          <button
            key={p.id}
            type="button"
            data-page={p.id}
            aria-current={page === p.id ? 'page' : undefined}
            aria-pressed={page === p.id}
            onClick={() => navigate(routeHref(botId, p.id), { guard: false })}
          >
            {p.label}
          </button>
        ))}
      </nav>
      {children}
    </>
  );
}
