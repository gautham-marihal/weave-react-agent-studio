import React, { createContext, useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';

// How deep a group sits on its screen: depth 0 is drawn in place, deeper groups open in a sheet from the right, so a
// screen is never more than one box deep. Inside a sheet the count restarts.
export const DepthCtx = createContext(0);
// The titles of the sheets open around this one, outermost first: a sheet says where it is ("Conversation flow › When
// the caller goes quiet") and goes back.
const TrailCtx = createContext([]);

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

// A panel sliding in from the right with one group's settings; edits are ordinary form edits (Undo works). Done, Escape
// and the shade close it, focus returns to the row that opened it, and Tab stays inside.
export default function Sheet({ title, onClose, actions = null, children, pathKey }) {
  const trail = useContext(TrailCtx);
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector('.stFSheetBack, .stFSheetClose')?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      // an open list inside (a drop-down, a picker) closes first
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) return;
    event.stopPropagation();
    const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter(
      (el) => !el.disabled && el.tabIndex >= 0 && (typeof el.checkVisibility !== 'function' || el.checkVisibility()),
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const parent = trail[trail.length - 1];
  const level = trail.length;
  return createPortal(
    <div className="stFSheetLayer" style={{ zIndex: 5600 + level * 2 }} onKeyDown={onKeyDown}>
      <div className="stFSheetScrim" aria-hidden="true" onMouseDown={() => close.current()} />
      <aside className="stFSheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} data-sheet={pathKey}>
        <header className="stFSheetHead">
          {parent ? (
            <button type="button" className="stFSheetBack" onClick={() => close.current()} aria-label={`Back to ${parent}`}>
              <Icon name="chevronRight" size={16} className="flip" />
              <span>{parent}</span>
            </button>
          ) : null}
          <div className="stFSheetTitle">
            {trail.length > 1 && (
              <p className="stFSheetTrail" aria-hidden="true">
                {trail.slice(0, -1).join(' › ')}
              </p>
            )}
            <h3>{title}</h3>
          </div>
          <div className="stFSheetActions">
            {actions}
            <button type="button" className="stFSheetClose" aria-label={`Close ${title}`} onClick={() => close.current()}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>
        <div className="stFSheetBody">
          <TrailCtx.Provider value={[...trail, title]}>
            <DepthCtx.Provider value={0}>{children}</DepthCtx.Provider>
          </TrailCtx.Provider>
        </div>
        <footer className="stFSheetFoot">
          <span className="stMuted">Changes are part of the draft as you make them.</span>
          <Button type="button" variant="primary" size="compact" onClick={() => close.current()}>
            Done
          </Button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
