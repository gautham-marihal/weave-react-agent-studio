import React, { useState } from 'react';
import Icon from './Icon.jsx';

// A page that breaks while drawing says so and offers a way on; the menu and top bar keep working. A page whose
// files are gone (a newer studio was released while the tab was open) asks for a reload, since a retry can't help.
//   resetKey: when it changes (another page is opened), the page is drawn again

const STALE = /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i;
export const isStaleBuild = (error) => STALE.test(String(error?.message || error || ''));

export function CrashPanel({ error, onRetry, full = false }) {
  const [copied, setCopied] = useState(false);
  const stale = isStaleBuild(error);
  const details = `${error?.name || 'Error'}: ${error?.message || String(error)}\n${window.location.href}\n${new Date().toISOString()}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={`pageCrash ${full ? 'full' : ''}`} role="alert">
      <span className="pageCrashIcon" aria-hidden="true">
        <Icon name={stale ? 'sparkle' : 'alert'} size={20} />
      </span>
      <h1>{stale ? 'A new version of Weave is available' : full ? 'Weave couldn’t open' : 'This page couldn’t be shown'}</h1>
      <p>
        {stale
          ? 'Weave was updated while this tab was open. Reload to continue; your saved work is kept.'
          : full
            ? 'Something went wrong while opening the studio. Reload to try again; your saved work is kept.'
            : 'Something went wrong while showing it. The rest of the studio still works, and your saved work is kept.'}
      </p>
      <div className="pageCrashActions">
        {stale || full ? (
          <button type="button" className="primaryCta" onClick={() => window.location.reload()}>
            Reload
          </button>
        ) : (
          <>
            <button type="button" className="primaryCta" onClick={onRetry}>
              Try again
            </button>
            <button
              type="button"
              className="quietButton"
              onClick={() => {
                window.location.hash = '#/home';
              }}
            >
              Go to Home
            </button>
          </>
        )}
      </div>
      {!stale && (
        <details className="pageCrashDetails">
          <summary>Details for support</summary>
          <pre>{details}</pre>
          <button type="button" className="quietButton" onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            {copied ? 'Copied' : 'Copy details'}
          </button>
        </details>
      )}
    </div>
  );
}

export class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Weave page error:', error, info?.componentStack);
  }

  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashPanel error={this.state.error} full={this.props.full} onRetry={() => this.setState({ error: null })} />;
  }
}
