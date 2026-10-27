import React from 'react';
import Icon from './Icon.jsx';

// Something the address names that isn't there (a deleted agent, a missing page): what it is, why, and the way back.
// Drawn like a broken page's panel (ui/ErrorBoundary.jsx), with a calmer icon.
export default function NotFound({ title, text, actionLabel, onAction, children = null }) {
  return (
    <div className="pageCrash notFound" role="status">
      <span className="pageCrashIcon neutral" aria-hidden="true">
        <Icon name="search" size={20} />
      </span>
      <h1>{title}</h1>
      {text && <p>{text}</p>}
      <div className="pageCrashActions">
        <button type="button" className="primaryCta" onClick={onAction}>
          {actionLabel}
        </button>
        {children}
      </div>
    </div>
  );
}
