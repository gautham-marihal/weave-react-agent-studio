import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import Button from './Button.tsx';

// Whether the browser has a network, following it as it changes.
function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

// A strip across the workspace while there is no network, so nobody wonders why pages don't load or saves fail.
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offlineBanner" role="status">
      <Icon name="alert" size={15} />
      <span>
        <strong>You’re offline.</strong> Changes can’t be saved and pages can’t load until the connection is back.
      </span>
    </div>
  );
}

// A strip across the workspace while the server doesn't answer (but the network is up), so an empty list is never
// mistaken for "nothing there". Try again asks the server now and reloads what the page shows.
export function ServerDownBanner({ down, onRetry }) {
  const online = useOnline();
  if (!down || !online) return null; // without a network, the offline strip says it
  return (
    <div className="offlineBanner serverDown" role="status">
      <Icon name="alert" size={15} />
      <span>
        <strong>Can’t reach the server.</strong> What you see may be out of date, and changes can’t be saved until it answers again. Weave keeps trying.
      </span>
      {onRetry && (
        <Button type="button" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// For people on a keyboard: the first Tab on a page offers to jump past the menu to the page itself.
export function SkipToContent({ target }) {
  return (
    <button
      type="button"
      className="skipLink"
      onClick={() => {
        const box = document.getElementById(target);
        if (!box) return;
        const first = box.querySelector('h1, h2');
        (first || box).setAttribute('tabindex', '-1');
        (first || box).focus();
      }}
    >
      Skip to content
    </button>
  );
}
