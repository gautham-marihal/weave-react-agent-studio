import React, { useContext, useEffect, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import Sheet, { DepthCtx } from '../Sheet.jsx';
import { isUnder, useForm } from '../ctx.js';

// A group of settings (a folding section, or a row opening a sheet), with the issue lines and delete button it draws.

// What is wrong with a field, in plain words, with a fix button where one is certain. The server's own sentence is in
// the tooltip, and shown with technical names on.
export function Issues({ pathKey, deep = false }) {
  const { exact, issuesUnder, describe, applyFix, technical } = useForm();
  const list = deep ? issuesUnder(pathKey) : exact.get(pathKey);
  if (!list?.length) return null;
  return list.map((issue, index) => {
    const d = describe(issue);
    return (
      <small
        key={index}
        className={`stFIssue ${issue.severity === 'error' ? 'stFErr' : 'stFWarn'}`}
        title={d.recognised ? `The server said: ${issue.message}` : undefined}
      >
        {d.text}
        {technical && d.recognised && <span className="stFRawIssue"> ({issue.message})</span>}
        {d.fixes.map((fix) => (
          <button type="button" key={fix.id} className="vxFix small" onClick={() => applyFix(fix)}>
            {fix.label}
          </button>
        ))}
      </small>
    );
  });
}

// The bin button beside a setting or a group: an icon, with the words for a screen reader and a tooltip.
export function DeleteButton({ what, onClick, disabled, small = false }) {
  return (
    <button
      type="button"
      className={`stFDel stFDelIcon ${small ? 'small' : ''}`}
      aria-label={`Delete ${what}`}
      title={`Delete ${what}`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="trash" size={small ? 15 : 16} />
    </button>
  );
}

// A focus request opens what holds it only while it is fresh: a sheet that was closed by hand does not open again when
// its screen is drawn again later.
const FRESH_FOCUS_MS = 2500;

// A group of settings: a folding section on the screen itself (depth 0), deeper a row opening a sheet (no nested boxes).
//   sub: the line under a row's title when it has no hint of its own
//   sortable: where a drag puts it, when the group is a list item that can be reordered (useSortableItem)
export function Group({ pathKey, title, hint, sub, tooltip, count, onRemove, defaultOpen = true, actions, children, flat = false, sortable = null }) {
  const { focus, countUnder } = useForm();
  const depth = useContext(DepthCtx);
  const drill = !flat && depth >= 1;
  const [open, setOpen] = useState(drill ? false : defaultOpen);
  useEffect(() => {
    if (focus && isUnder(focus.key, pathKey) && (!drill || !focus.nonce || Date.now() - focus.nonce < FRESH_FOCUS_MS)) setOpen(true);
  }, [focus, pathKey, drill]);
  const c = countUnder(pathKey);
  // a problem inside is never left behind a closed section (a row that opens a sheet shows the count instead)
  useEffect(() => {
    if (!drill && c.errors > 0) setOpen(true);
  }, [c.errors, drill]);
  const dots = (
    <>
      {c.errors > 0 && (
        <b className="stFDot err" title={`${c.errors} error${c.errors === 1 ? '' : 's'} inside`}>
          {c.errors}
        </b>
      )}
      {c.errors === 0 && c.warnings > 0 && (
        <b className="stFDot warn" title={`${c.warnings} warning${c.warnings === 1 ? '' : 's'} inside`}>
          {c.warnings}
        </b>
      )}
    </>
  );
  const remove = onRemove ? <DeleteButton what={title} onClick={onRemove} /> : null;
  if (drill) {
    const line = hint || sub;
    return (
      <section
        ref={sortable?.ref}
        style={sortable?.style}
        className={`stFGroup drill ${c.errors ? 'hasErr' : ''} ${sortable?.dragging ? 'isDragging' : ''}`}
        data-path={pathKey}
      >
        <header>
          <button
            type="button"
            className="stFGroupToggle"
            aria-expanded={open}
            aria-haspopup="dialog"
            title={tooltip || undefined}
            onClick={() => setOpen(true)}
          >
            <span className="stFDrillText">
              <strong>{title}</strong>
              {line && <span className="stFHint">{line}</span>}
            </span>
            {count != null && <em>{count}</em>}
            {dots}
            <Icon name="chevronRight" size={16} className="stFChev" />
          </button>
          {(actions || remove) && (
            <div className="stFGroupActions">
              {actions}
              {remove}
            </div>
          )}
        </header>
        {open && (
          <Sheet title={title} pathKey={pathKey} onClose={() => setOpen(false)} actions={remove}>
            <Issues pathKey={pathKey} />
            {children}
          </Sheet>
        )}
      </section>
    );
  }
  return (
    <section
      ref={sortable?.ref}
      style={sortable?.style}
      className={`stFGroup ${c.errors ? 'hasErr' : ''} ${flat ? 'flat' : ''} ${open ? 'open' : ''} ${sortable?.dragging ? 'isDragging' : ''}`}
      data-path={pathKey}
    >
      <header>
        <button type="button" className="stFGroupToggle" aria-expanded={open} title={tooltip || undefined} onClick={() => setOpen((v) => !v)}>
          <Icon name="chevronRight" size={16} className="stFChev" />
          <strong>{title}</strong>
          {hint && <span className="stFHint">{hint}</span>}
          {count != null && <em>{count}</em>}
          {dots}
        </button>
        {(actions || remove) && (
          <div className="stFGroupActions">
            {actions}
            {remove}
          </div>
        )}
      </header>
      {(open || flat) && (
        <div className="stFGroupBody">
          <Issues pathKey={pathKey} />
          <DepthCtx.Provider value={flat ? depth : depth + 1}>{children}</DepthCtx.Provider>
        </div>
      )}
    </section>
  );
}
