import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';
import { navigate, routeHref } from '../route.js';
import { PAGE_GROUPS } from './pages.js';

// The agent's menu in the sidebar: one level, three groups, a picture and a name for each page. `counts` puts a number beside a page (problems to fix),
// `dots` a dot (a test conversation running). When the sidebar is folded to pictures the names go and stay as tooltips.
export default function AgentNav({ botId, page, counts = {}, dots = {} }) {
  const [slot, setSlot] = useState(null);
  // drawn in the sidebar's own slot while that is on screen; above the page where there is none (a narrow window, a test)
  useLayoutEffect(() => {
    const wide = window.matchMedia ? window.matchMedia('(min-width: 901px)') : { matches: true, addEventListener() {}, removeEventListener() {} };
    const pick = () => setSlot(wide.matches ? document.getElementById('agentNavSlot') : null);
    pick();
    wide.addEventListener?.('change', pick);
    return () => wide.removeEventListener?.('change', pick);
  }, []);
  const menu = (
    <nav className="nlNav" aria-label="Agent pages">
      {PAGE_GROUPS.map((group) => (
        <div key={group.id} className="nlNavGroup" role="group" aria-label={group.label}>
          <span className="nlNavHead">{group.label}</span>
          {group.pages.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.label}
              data-page={p.id}
              className={page === p.id ? 'on' : ''}
              aria-current={page === p.id ? 'page' : undefined}
              onClick={() => navigate(routeHref(botId, p.id), { guard: false })}
            >
              <span className="nlNavIcon" aria-hidden="true">
                <Icon name={p.icon} size={18} />
              </span>
              <span className="nlNavLabel">{p.label}</span>
              {counts[p.id] > 0 && (
                <b className="nlNavCount" title={`${counts[p.id]} to fix`}>
                  {counts[p.id]}
                </b>
              )}
              {dots[p.id] && <i className="nlNavDot" />}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
  return slot ? createPortal(menu, slot) : menu;
}
