import { Suspense, lazy } from 'react';

// The page before sign-in: Weave's public site (pages/site/). It loads on its own, so the studio people work in never
// downloads it, and until it has loaded the page shows only its dark ground.

const Site = lazy(() => import('./site/Site.jsx'));

export function Landing({ theme, onToggleTheme, onSignIn, onStart }) {
  return (
    <Suspense fallback={<div className={`siteLoading ${theme === 'dark' ? 'dark' : 'light'}`} aria-busy="true" />}>
      <Site theme={theme} onToggleTheme={onToggleTheme} onSignIn={onSignIn} onStart={onStart} />
    </Suspense>
  );
}
