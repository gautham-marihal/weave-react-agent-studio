import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { subscribeDialogs } from './dialogs.js';
import { trapTab } from './useDialogFocus.js';
import Icon from './Icon.jsx';

// Draws the decision asked by askConfirm() or showNotice() (dialogs.js): a title, a sentence or two, and the buttons. It sits above every other
// layer (a drawer, a sheet, another dialog), and while it is open it alone answers the keyboard: Escape declines, Tab stays inside, and the
// dialog under it doesn't close too.
export default function DialogHost() {
  const [dialog, setDialog] = useState(null);
  useEffect(() => subscribeDialogs(setDialog), []);
  if (!dialog) return null;
  return <Decision key={dialog.id} dialog={dialog} />;
}

function Decision({ dialog }) {
  const box = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const danger = dialog.tone === 'danger';
  const notice = dialog.kind === 'notice';
  const decline = () => dialog.resolve(false);
  const accept = () => dialog.resolve(true);

  useEffect(() => {
    const before = document.activeElement;
    // something that can't be undone starts on Cancel, so a stray Enter doesn't do it
    (danger && !notice ? cancelRef.current : confirmRef.current)?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        decline();
      } else if (event.key === 'Tab') {
        event.stopPropagation();
        trapTab(event, box.current);
      }
    };
    // on the way down (capture), so the layers under it never see these keys
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before && before !== document.body && document.contains(before)) before.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per dialog (the host gives each its own key)
  }, []);

  return createPortal(
    <div
      className="createOverlay decisionOverlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) decline();
      }}
    >
      <section
        ref={box}
        className={`createModal decisionDialog ${danger ? 'danger' : ''}`}
        role={notice ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby="decisionTitle"
        aria-describedby={dialog.body ? 'decisionBody' : undefined}
      >
        <div className="decisionHead">
          <span className={`decisionIcon ${danger ? 'danger' : ''}`} aria-hidden="true">
            <Icon name={danger ? 'alert' : notice ? 'info' : 'help'} size={18} />
          </span>
          <div>
            <h2 id="decisionTitle">{dialog.title}</h2>
            {dialog.body && <p id="decisionBody">{dialog.body}</p>}
          </div>
        </div>
        <div className="decisionActions">
          {!notice && (
            <button ref={cancelRef} type="button" className="quietButton" onClick={decline}>
              {dialog.cancelLabel}
            </button>
          )}
          <button ref={confirmRef} type="button" className={danger ? 'dangerCta' : 'primaryCta'} onClick={accept}>
            {dialog.confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
