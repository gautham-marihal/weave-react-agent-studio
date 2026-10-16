import React, { useEffect, useState } from 'react';
import MobileNav from './studio/MobileNav.jsx';
import { Landing } from './pages/Landing.jsx';
import { Login, ProfileSetup } from './pages/Login.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { AccountDialog, InfoDialogHost } from './pages/shared.jsx';
import { DemoBadge } from './demo/DemoBadge.jsx';
import { useDensity } from './studio/usePref.js';

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('Weave UI error:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text)' }}>
        <div
          style={{
            width: 'min(520px, 100%)',
            border: '1px solid var(--line2)',
            borderRadius: 18,
            padding: 28,
            background: 'var(--panel)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div className="eyebrow cyan">WEAVE</div>
          <h1 style={{ margin: '10px 0 8px', color: 'var(--textStrong)' }}>We hit a display error.</h1>
          <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.6 }}>Refresh the page to continue. Your saved workspace data is kept locally.</p>
          <button className="primaryCta" type="button" style={{ marginTop: 20 }} onClick={() => window.location.reload()}>
            Reload Weave <span className="buttonArrow">→</span>
          </button>
        </div>
      </div>
    );
  }
}

// "Keep me signed in": remembered in localStorage (until sign out) or sessionStorage (until the browser closes).
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

function forgetSignIn() {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

export function App() {
  // A refresh keeps you signed in (and on the page the address points to) instead of returning to the landing page.
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
  // Comfortable or compact spacing (Settings): one attribute on the page, read by the spacing tokens.
  const [density] = useDensity();
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
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

  const handleProfileComplete = (nextProfile) => {
    try {
      localStorage.setItem('weave_profile', JSON.stringify(nextProfile));
    } catch {}
    setProfile(nextProfile);
    rememberSignIn(keepSignedIn);
    setScreen('dashboard');
  };

  let view;
  if (screen === 'landing') {
    view = <Landing theme={theme} onToggleTheme={toggleTheme} onSignIn={() => setScreen('login')} onStart={() => setScreen('login')} />;
  } else if (screen === 'login') {
    view = <Login theme={theme} onToggleTheme={toggleTheme} onLogin={handleLogin} onBack={() => setScreen('landing')} />;
  } else if (screen === 'onboarding') {
    view = <ProfileSetup theme={theme} onToggleTheme={toggleTheme} email={pendingEmail} onComplete={handleProfileComplete} onBack={() => setScreen('login')} />;
  } else {
    view = (
      <Dashboard
        theme={theme}
        onToggleTheme={toggleTheme}
        profile={profile}
        onProfileUpdate={setProfile}
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
      <DemoBadge />
      {!['landing', 'login', 'onboarding'].includes(screen) && <MobileNav />}
      {accountOpen && profile && screen !== 'landing' && screen !== 'login' && screen !== 'onboarding' && (
        <AccountDialog
          profile={profile}
          workspaceName={accountWorkspace || profile?.workspaceName}
          onClose={() => setAccountOpen(false)}
          onSignOut={() => {
            setAccountOpen(false);
            forgetSignIn();
            setScreen('landing');
          }}
        />
      )}
    </>
  );
}
