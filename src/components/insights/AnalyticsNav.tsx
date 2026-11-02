import React from 'react';
import { NavLink } from 'react-router-dom';
import { useStudio } from '../../contexts/StudioContext';
import { useNewAlertCount } from '../../hooks/useAlerts';
import { cn } from '../../utils/styles';

/** The pages of Analytics, as links; Alerts shows how many alerts nobody has looked at yet. */
export function AnalyticsNav() {
  const { agents } = useStudio();
  const fresh = useNewAlertCount(agents.map((a) => a.id));
  const items = [
    { to: '/analytics', label: 'Monitoring', end: true, count: 0 },
    { to: '/analytics/speed', label: 'Speed', end: false, count: 0 },
    { to: '/analytics/alerts', label: 'Alerts', end: false, count: fresh },
  ];
  return (
    <nav aria-label="Analytics" className="mt-4 flex flex-wrap gap-1 border-b border-line">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
            )
          }
        >
          {item.label}
          {item.count > 0 && (
            <span className="rounded-full bg-danger px-1.5 text-[10px] font-semibold leading-4 text-white">
              {item.count}
              <span className="sr-only"> new</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
