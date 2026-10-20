import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';

// A panel that slides in from the right and keeps the page where it was. The keyboard goes into it (to the close button), Tab stays inside it, Escape
// closes it (an open list inside it closes first), and closing puts the keyboard back on whatever opened it.
export default function Drawer({ title, icon, onClose, children, footer = null, width = 'normal', label }) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector('.nlDrawerClose')?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const keepFocusInside = (event) => {
    if (event.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]')].filter(
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
  return createPortal(
    <>
      {/* on click, not on press: closing on the press would let the release land on whatever is under the scrim, so one click would both close the
          panel and open that (a menu item, a button) */}
      <div className="nlScrim" aria-hidden="true" onClick={onClose} />
      <aside className={`nlDrawer ${width}`} role="dialog" aria-modal="true" aria-label={label || title} ref={ref} onKeyDown={keepFocusInside}>
        <header className="nlDrawerHead">
          {icon && (
            <span className="nlDrawerIcon" aria-hidden="true">
              <Icon name={icon} size={18} />
            </span>
          )}
          <h2>{title}</h2>
          <button type="button" className="nlDrawerClose" aria-label={`Close ${title}`} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="nlDrawerBody">{children}</div>
        {footer && <footer className="nlDrawerFoot">{footer}</footer>}
      </aside>
    </>,
    document.body,
  );
}

// A drawer whose edits wait for "Done": it works on a copy of the draft, and only Done puts the copy into the draft (Cancel and Escape leave the draft as it
// was). `children` is a function of (config, set, stagedEditor): the first two for a part that edits a config the way the Simple view does, the last for the
// settings form, which wants an editor.
export function StagedDrawer({ editor, title, icon, onClose, children, width, doneLabel = 'Done', initial }) {
  const [draft, setDraft] = useState(() => (initial ? initial(editor.parsed.value) : editor.parsed.value));
  const original = editor.parsed.value;
  const latest = useRef({ draft, onClose, editor });
  latest.current.onClose = onClose;
  latest.current.editor = editor;
  // a change is kept in the ref at once, so a panel that changes the copy and then finishes in the same breath (deleting what it shows) finishes with the change
  const setCopy = useCallback((next) => {
    latest.current.draft = next;
    setDraft(next);
  }, []);
  const staged = useMemo(
    () => ({ ...editor, parsed: { ...editor.parsed, value: draft, error: null }, setValue: setCopy, dirty: false }),
    [editor, draft, setCopy],
  );
  const changed = JSON.stringify(draft) !== JSON.stringify(original);
  // puts the copy into the draft and closes; stable, so a panel can hold on to it
  const done = useCallback(() => {
    const { draft: d, onClose: close, editor: e } = latest.current;
    if (JSON.stringify(d) !== JSON.stringify(e.parsed.value)) e.setValue(d);
    close();
  }, []);
  return (
    <Drawer
      title={title}
      icon={icon}
      onClose={onClose}
      width={width}
      footer={
        <>
          <button type="button" className="quietButton" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primaryCta compactCta" onClick={done}>
            {changed ? doneLabel : 'Close'}
          </button>
        </>
      }
    >
      {children(
        draft,
        (next) => {
          if (next && next !== latest.current.draft) setCopy(next);
        },
        staged,
        { done },
      )}
    </Drawer>
  );
}
