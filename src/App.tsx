import React from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './contexts/AuthContext';
import { StudioProvider } from './contexts/StudioContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppShell } from './components/layout/AppShell';
import { SignIn } from './pages/SignIn';
import { Landing } from './pages/Landing';
import { Home } from './pages/Home';
import { Agents } from './pages/Agents';
import { AgentWorkspace } from './pages/AgentWorkspace';
import { Knowledge } from './pages/Knowledge';
import { Calls } from './pages/Calls';
import { CallDetail } from './pages/CallDetail';
import { Library } from './pages/Library';
import { Telephony } from './pages/Telephony';
import { Settings } from './pages/Settings';
import { Team } from './pages/Team';
import { NotFound } from './pages/NotFound';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

import { BreadcrumbProvider } from './contexts/BreadcrumbContext';
import { Analytics } from './pages/Analytics';
import { Live } from './pages/Live';
import { usePageTitle } from './hooks/usePageTitle';

/** Keeps the browser tab's title in step with the page (a route names itself with `handle: { title }`). */
function PageTitle() {
  usePageTitle();
  return null;
}

/** The providers every page needs. Inside the router, so they (and the pages) can use its hooks. */
function Root() {
  return (
    <AuthProvider>
      <StudioProvider>
        <BreadcrumbProvider>
          <ToastProvider position="top-right">
            <PageTitle />
            <ErrorBoundary fallbackTitle="An application error occurred">
              <Outlet />
            </ErrorBoundary>
          </ToastProvider>
        </BreadcrumbProvider>
      </StudioProvider>
    </AuthProvider>
  );
}

// A data router (not <BrowserRouter>): useBlocker, which asks before leaving an agent with unsaved edits, needs one.
// `handle.title` names a page in the browser tab ("Calls · Weave Studio"); a page without one is named from its address.
const routes = [
  {
    element: <Root />,
    children: [
      { path: '/welcome', element: <Landing />, handle: { title: 'Build, test and run AI agents' } },
      { path: '/signin', element: <SignIn />, handle: { title: (search: URLSearchParams) => (search.get('start') ? 'Get started' : 'Sign in') } },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Home />, handle: { title: 'Home' } },
          { path: 'agents', element: <Agents />, handle: { title: 'Agents' } },
          { path: 'agents/:agentId/*', element: <AgentWorkspace /> },
          { path: 'live', element: <Live />, handle: { title: 'Live' } },
          { path: 'knowledge', element: <Knowledge />, handle: { title: 'Knowledge' } },
          { path: 'calls', element: <Calls />, handle: { title: 'Calls' } },
          { path: 'calls/:callId', element: <CallDetail />, handle: { title: 'Call' } },
          { path: 'library', element: <Library />, handle: { title: 'Library' } },
          { path: 'telephony', element: <Telephony />, handle: { title: 'Telephony' } },
          { path: 'telephony/:section', element: <Telephony />, handle: { title: 'Telephony' } },
          { path: 'team', element: <Team />, handle: { title: 'Team' } },
          { path: 'settings', element: <Settings />, handle: { title: 'Settings' } },
          { path: 'analytics', element: <Analytics />, handle: { title: 'Analytics' } },
          { path: 'analytics/*', element: <Analytics />, handle: { title: 'Analytics' } },
          // an address that names no page says so (it used to send you Home without a word)
          { path: '*', element: <NotFound />, handle: { title: 'Page not found' } },
        ],
      },
    ],
  },
];

// React Router 7: relative paths inside splat routes and navigation wrapped in startTransition are now the defaults
// (they were the opt-in v7_relativeSplatPath / v7_startTransition flags on v6).
const router = createBrowserRouter(routes);

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
