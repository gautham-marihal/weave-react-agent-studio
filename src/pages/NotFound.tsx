import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SearchXIcon } from 'lucide-react';

interface NotFoundProps {
  title?: string;
  text?: string;
}

/** An address that leads nowhere (mistyped or out of date): what happened and the way back, inside the shell. */
export function NotFound({
  title = 'Page not found',
  text = 'This address doesn’t lead to a page in Weave Studio. The link may be mistyped or out of date.',
}: NotFoundProps) {
  const location = useLocation();
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center" role="status">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-subtle text-muted" aria-hidden>
        <SearchXIcon className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-1 text-sm text-muted">{text}</p>
      <p className="mt-2 break-all font-mono text-xs text-muted">{location.pathname}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link
          to="/"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-ink shadow-sm hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Go to Home
        </Link>
        <Link
          to="/agents"
          className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-ink shadow-sm hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          All agents
        </Link>
      </div>
    </div>
  );
}
