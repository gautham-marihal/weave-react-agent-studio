import React, { useContext, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';
import Tip from '../../ui/Tip.tsx';
import { SidebarFolded } from '../../ui/sidebarFolded.ts';
import { navigate, routeHref } from '../route.js';
import { PAGE_GROUPS } from './pages.js';
import { revealIn } from '../../ui/scrollEdges.js';

// The agent's menu in the sidebar, in the order the work is done: its overview, then building it, testing and launching
// it, watching it, and its settings. While it is not ready, a card at the top says how far along it is and opens the
// next step. Beside a page: a number when the checks found problems there (`counts`), a ring when one of the steps to
// get ready is done there and is still to do (from `plan`), a dot while a test conversation runs (`dots`). When the
// sidebar is folded to pictures the names go and stay as tooltips.
export default function AgentNav({ botId, page, counts = {}, dots = {}, plan = null, onStep }) {
  const folded = useContext(SidebarFolded);
  const [slot, setSlot] = useState(null);
  // drawn in the sidebar's own slot while that is on screen; above the page where there is none (a narrow window, a test)
  useLayoutEffect(() => {
    const wide = window.matchMedia ? window.matchMedia('(min-width: 901px)') : { matches: true, addEventListener() {}, removeEventListener() {} };
    const pick = () => setSlot(wide.matches ? document.getElementById('agentNavSlot') : null);
    pick();
    wide.addEventListener?.('change', pick);
    return () => wide.removeEventListener?.('change', pick);
  }, []);
  // in a short window the sidebar scrolls: the page that is open is brought into view in it
  useEffect(() => {
    revealIn(slot?.closest('.sideNav'), 'button.on');
  }, [slot, page]);

  // the steps still to do, by the page where each is done
  const todo = {};
  (plan?.steps || [])
    .filter((s) => s.state === 'todo' || s.state === 'blocked')
    .forEach((s) => {
      todo[s.page] = [...(todo[s.page] || []), s.label];
    });
  const showSetup = !!(plan && plan.total && plan.next);
  const pct = plan?.total ? Math.round((plan.done / plan.total) * 100) : 0;

  const menu = (
    <nav className="nlNav" aria-label="Agent pages">
      {showSetup && (
        <button type="button" className="nlSetup" onClick={() => onStep?.(plan.next)} title={`Next: ${plan.next.label}`}>
          <span className="nlSetupHead">
            <strong>Getting it ready</strong>
            <span>
              {plan.done} of {plan.total}
            </span>
          </span>
          <span className="nlSetupBar" role="progressbar" aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.done} aria-label="Steps done">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="nlSetupNext">
            <span>Next: {plan.next.label}</span>
            <Icon name="arrowRight" size={14} />
          </span>
        </button>
      )}
      {PAGE_GROUPS.map((group) => (
        <div key={group.id} className={`nlNavGroup ${group.bare ? 'bare' : ''}`} role="group" aria-label={group.label}>
          {!group.bare && <span className="nlNavHead">{group.label}</span>}
          {group.pages.map((p) => {
            const toDo = todo[p.id] || [];
            return (
              <Tip key={p.id} label={toDo.length ? `${p.label}: ${toDo.join(', ').toLowerCase()} still to do` : folded ? p.label : null} side="right">
                <button
                  type="button"
                  data-page={p.id}
                  className={page === p.id ? 'on' : ''}
                  aria-current={page === p.id ? 'page' : undefined}
                  onClick={() => navigate(routeHref(botId, p.id), { guard: false })}
                >
                  <span className="nlNavIcon" aria-hidden="true">
                    <Icon name={p.icon} size={17} />
                  </span>
                  <span className="nlNavLabel">{p.label}</span>
                  {counts[p.id] > 0 ? (
                    <b className="nlNavCount" title={`${counts[p.id]} to fix`}>
                      {counts[p.id]}
                    </b>
                  ) : toDo.length ? (
                    <i className="nlNavTodo" aria-label={`${toDo.length} step${toDo.length === 1 ? '' : 's'} to do`} />
                  ) : null}
                  {dots[p.id] && <i className="nlNavDot" />}
                </button>
              </Tip>
            );
          })}
        </div>
      ))}
    </nav>
  );
  return slot ? createPortal(menu, slot) : menu;
}
