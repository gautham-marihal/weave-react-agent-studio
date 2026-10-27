import React, { useEffect, useState } from 'react';
import MobileNav from './studio/MobileNav.jsx';
import { Landing } from './pages/Landing.jsx';
import { Login, ProfileSetup } from './pages/Login.jsx';
import { Dashboard, openWorkspaceNamed } from './pages/Dashboard.jsx';
import { AccountDialog, InfoDialogHost } from './pages/shared.jsx';
import { DemoBadge } from './demo/DemoBadge.jsx';
import { useAccent, useDensity, useStyle } from './studio/usePref.js';
import DialogHost from './ui/DialogHost.jsx';
import { PageErrorBoundary } from './ui/ErrorBoundary.jsx';
import { forgetHealth } from './studio/health/useAgentHealth.js';
import { queryClient } from './api/queryClient.ts';
import { whenLeaveConfirmed } from './studio/route.js';

// Last line of defence: a crash outside any page shows a calm screen with a reload (each page has its own boundary).
export function AppErrorBoundary({ children }) {
  return <PageErrorBoundary full>{children}</PageErrorBoundary>;
}

// "Keep me signed in": localStorage (until sign out) or sessionStorage (until the browser closes).
// Sign-in is local to this browser in this prototype, so this only decides which screen a refresh opens.
const SESSION_KEY = 'weave_signed_in';

function readSignedIn() {
  try {
    return localStorage.getItem(SESSION_KEY) === '1' || sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSignIn(keep) {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    (keep ? localStorage : sessionStorage).setItem(SESSION_KEY, '1');
  } catch {}
}

// Signing out also clears the data cache (tags, owners, health, calls, numbers) so the next person reads it afresh.
function forgetSignIn() {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
  forgetHealth();
  queryClient.clear();
}

export function App() {
  // A refresh keeps you signed in, on the page in the address, instead of returning to the landing page.
  const [screen, setScreen] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('weave_profile') || 'null') && readSignedIn() ? 'dashboard' : 'landing';
    } catch {
      return 'landing';
    }
  });
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountWorkspace, setAccountWorkspace] = useState('');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('weave_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('weave_theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme((value) => (value === 'light' ? 'dark' : 'light'));
  // Comfortable or compact spacing (Settings), read by the spacing tokens.
  const [density] = useDensity();
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  // The design style, read by src/themes.css in light and dark.
  const [designStyle] = useStyle();
  const [accent] = useAccent(designStyle);
  useEffect(() => {
    document.documentElement.dataset.style = designStyle;
    document.documentElement.dataset.accent = accent; // its colour option (src/accents.css)
  }, [designStyle, accent]);
  const [profile, setProfile] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('weave_profile') || 'null');
    } catch {
      return null;
    }
  });

  const handleLogin = (email, keep = true) => {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const profileMatchesAccount = profile && (profile.email || '').trim().toLowerCase() === normalizedEmail;
    setKeepSignedIn(keep);

    if (profileMatchesAccount) {
      rememberSignIn(keep);
      setScreen('dashboard');
      return;
    }

    setPendingEmail(email.trim());
    setScreen('onboarding');
  };

  const [pendingEmail, setPendingEmail] = useState('');
  // Why the sign-in page opened: to start (a "Create…" button) or to sign in. A first-time starter is greeted as new.
  const [loginIntent, setLoginIntent] = useState('signin');
  const newcomer = loginIntent === 'start' && !profile;

  const handleProfileComplete = (nextProfile) => {
    try {
      localStorage.setItem('weave_profile', JSON.stringify(nextProfile));
    } catch {}
    openWorkspaceNamed(nextProfile?.workspaceName);
    setProfile(nextProfile);
    rememberSignIn(keepSignedIn);
    // The first-time setup ends where it promises ("03 Build: describe your first agent"): in the create dialog.
    window.location.hash = '#/bots?new=1';
    setScreen('dashboard');
  };

  // The browser tab title before the workspace opens (inside it, the Dashboard names each page).
  useEffect(() => {
    const titles = {
      landing: 'Weave · Build, test and run AI agents',
      login: newcomer ? 'Get started · Weave' : 'Sign in · Weave',
      onboarding: 'Set up your workspace · Weave',
    };
    if (titles[screen]) document.title = titles[screen];
  }, [screen, newcomer]);

  const openLogin = (intent) => {
    setLoginIntent(intent);
    setScreen('login');
  };

  let view;
  if (screen === 'landing') {
    view = <Landing theme={theme} onToggleTheme={toggleTheme} onSignIn={() => openLogin('signin')} onStart={() => openLogin('start')} />;
  } else if (screen === 'login') {
    view = <Login theme={theme} onToggleTheme={toggleTheme} newcomer={newcomer} onLogin={handleLogin} onBack={() => setScreen('landing')} />;
  } else if (screen === 'onboarding') {
    view = <ProfileSetup theme={theme} onToggleTheme={toggleTheme} email={pendingEmail} onComplete={handleProfileComplete} onBack={() => setScreen('login')} />;
  } else {
    view = (
      <Dashboard
        theme={theme}
        onToggleTheme={toggleTheme}
        profile={profile}
        onSignOut={() => {
          setAccountOpen(false);
          forgetSignIn();
          setScreen('landing');
        }}
        onAccountOpen={(workspaceName) => {
          setAccountWorkspace(workspaceName || '');
          setAccountOpen(true);
        }}
      />
    );
  }

  return (
    <>
      {view}
      <InfoDialogHost />
      <DialogHost />
      <DemoBadge />
      {!['landing', 'login', 'onboarding'].includes(screen) && <MobileNav />}
      {accountOpen && profile && screen !== 'landing' && screen !== 'login' && screen !== 'onboarding' && (
        <AccountDialog
          profile={profile}
          workspaceName={accountWorkspace || profile?.workspaceName}
          onClose={() => setAccountOpen(false)}
          // asks first when an open agent has unsaved edits, as the profile menu's Sign out does
          onSignOut={() =>
            whenLeaveConfirmed(() => {
              setAccountOpen(false);
              forgetSignIn();
              setScreen('landing');
            })
          }
        />
      )}
    </>
  );
}
