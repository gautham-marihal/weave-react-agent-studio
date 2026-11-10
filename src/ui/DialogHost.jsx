import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { subscribeDialogs } from './dialogs.js';
import Icon from './Icon.jsx';
import { backTo } from './layer.ts';
import Button from './Button.tsx';

// Draws the decision asked by askConfirm() or showNotice() (dialogs.js) as a Radix dialog above every other layer.
// While open it alone answers the keyboard: Escape or an outside click declines, Tab stays in its buttons (never a
// dialog under it), and closing returns focus to what had it.
export default function DialogHost() {
  const [dialog, setDialog] = useState(null);
  useEffect(() => subscribeDialogs(setDialog), []);
  if (!dialog) return null;
  return <Decision key={dialog.id} dialog={dialog} />;
}

// a dialog over another keeps its keys: the studio's dialogs and panels listen to the page and must not act on them
const keepKeys = (event) => {
  if (event.key === 'Tab' || event.key === 'Escape') event.stopPropagation();
};

function Decision({ dialog }) {
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const wordRef = useRef(null);
  // a word to type first (dialog.typeWord): the confirm button works once it is typed, in any case
  const [typed, setTyped] = useState('');
  const wordOk = !dialog.typeWord || typed.trim().toLowerCase() === dialog.typeWord.toLowerCase();
  const warning = dialog.warning;
  // what had focus when it was asked, to give it back to
  const [opener] = useState(() => document.activeElement);
  const danger = dialog.tone === 'danger';
  const notice = dialog.kind === 'notice';
  const decline = () => dialog.resolve(false);
  const accept = () => wordOk && dialog.resolve(true);

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
              // a word to type starts in its box; something that can't be undone starts on Cancel, so a stray Enter
              // doesn't do it
              event.preventDefault();
              (dialog.typeWord ? wordRef.current : danger && !notice ? cancelRef.current : confirmRef.current)?.focus({ preventScroll: true });
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
            {warning && (
              <div className="stNotice error decisionWarning" role="note">
                <span className="stNoticeIcon" aria-hidden="true">
                  <Icon name="alert" size={16} />
                </span>
                <div className="stNoticeBody">
                  {warning.title && <strong>{warning.title}</strong>}
                  <div>
                    {warning.text}
                    {Array.isArray(warning.items) && warning.items.length > 0 && (
                      <ul className="stPlain">
                        {warning.items.map((item, index) => (
                          <li key={index}>
                            {item.feature} {item.where && <code>{item.where}</code>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
            {dialog.typeWord && (
              <label className="stTypedConfirm decisionWord" htmlFor="decisionWord">
                <span>
                  Type <b>{dialog.typeWord}</b> {dialog.typeWordWhy || 'to continue'}
                </span>
                <input
                  ref={wordRef}
                  id="decisionWord"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      accept();
                    }
                  }}
                  placeholder={dialog.typeWord}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}
            <div className="decisionActions">
              {!notice && (
                <Button ref={cancelRef} type="button" onClick={decline}>
                  {dialog.cancelLabel}
                </Button>
              )}
              <button ref={confirmRef} type="button" className={danger ? 'dangerCta' : 'primaryCta'} onClick={accept} disabled={!wordOk}>
                {dialog.confirmLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
