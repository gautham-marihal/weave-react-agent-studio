import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { subscribeDialogs } from './dialogs.js';
import Icon from './Icon.jsx';
import { backTo } from './layer.ts';

// Draws the decision asked by askConfirm() or showNotice() (dialogs.js): a title, a sentence or two, and the buttons (a
// Radix Dialog, an alert dialog for a decision). It sits above every other layer (a drawer, a sheet, another dialog),
// and while it is open it alone answers the keyboard: Escape or a click outside it declines, Tab goes round its own
// buttons (and never reaches a dialog under it, which keeps the keyboard in itself too), and closing it gives the
// keyboard back to what had it.
export default function DialogHost() {
  const [dialog, setDialog] = useState(null);
  useEffect(() => subscribeDialogs(setDialog), []);
  if (!dialog) return null;
  return <Decision key={dialog.id} dialog={dialog} />;
}

// the keys of a dialog over another stay in it: the studio's own dialogs and panels listen to the page, and must not act on a key meant for this one
const keepKeys = (event) => {
  if (event.key === 'Tab' || event.key === 'Escape') event.stopPropagation();
};

function Decision({ dialog }) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  // what had the keyboard when it was asked, to give it back to
  const [opener] = useState(() => document.activeElement);
  const danger = dialog.tone === 'danger';
  const notice = dialog.kind === 'notice';
  const decline = () => dialog.resolve(false);
  const accept = () => dialog.resolve(true);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && decline()}>
      <Dialog.Portal>
        <Dialog.Overlay className="createOverlay decisionOverlay">
          <Dialog.Content
            className={`createModal decisionDialog ${danger ? 'danger' : ''}`}
            role={notice ? 'dialog' : 'alertdialog'}
            aria-modal="true"
            {...(dialog.body ? {} : { 'aria-describedby': undefined })}
            onKeyDown={keepKeys}
            onEscapeKeyDown={(event) => event.stopPropagation()}
            onCloseAutoFocus={backTo(opener)}
            onOpenAutoFocus={(event) => {
              // something that can't be undone starts on Cancel, so a stray Enter doesn't do it
              event.preventDefault();
              (danger && !notice ? cancelRef.current : confirmRef.current)?.focus({ preventScroll: true });
            }}
          >
            <div className="decisionHead">
              <span className={`decisionIcon ${danger ? 'danger' : ''}`} aria-hidden="true">
                <Icon name={danger ? 'alert' : notice ? 'info' : 'help'} size={18} />
              </span>
              <div>
                <Dialog.Title asChild>
                  <h2 id="decisionTitle">{dialog.title}</h2>
                </Dialog.Title>
                {dialog.body && (
                  <Dialog.Description asChild>
                    <p id="decisionBody">{dialog.body}</p>
                  </Dialog.Description>
                )}
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
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
