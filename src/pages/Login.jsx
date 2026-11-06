import { useRef, useState } from 'react';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import { Logo } from './shared.jsx';
import { isDemoMode } from '../demo/demoMode.js';
import { StyleMenu } from '../ui/StylePicker.jsx';
import { DemoSlot } from '../demo/DemoBadge.jsx';
import Icon from '../ui/Icon.jsx';
import { useRiseInOnce } from '../ui/motion';
import './auth.css';

// Signing in. The email and password are checked by the server against credentials.txt (authRoute.js); who is signed
// in is then kept in this browser, and the first sign-in goes straight to the workspace (App.jsx, firstProfile.js).
// It wears the public site's look (deep ink or soft paper, a fine grid, a slow aurora, serif headlines), so the step
// from the site into the studio feels like one place. Its words, fields and buttons are the studio's own.

// The sign-in screen's frame: the top bar, the backdrop, the words on the left and the form on the right.
//   hint: what the top bar says this screen is   steps: the three steps on the left, `at` the one in hand (or none)
function AuthShell({ theme, onToggleTheme, onBack, hint, eyebrow, title, lead, steps, at, children }) {
  const intro = useRef(null);
  const card = useRef(null);
  useRiseInOnce(intro, true);
  useRiseInOnce(card, true);
  return (
    <div className={`authScreen ${theme === 'dark' ? 'dark' : 'light'}`}>
      <div className="authBack" aria-hidden="true">
        <div className="authGrid" />
        <div className="authAurora">
          <i />
          <i />
          <i />
        </div>
      </div>
      <header className="authTop">
        <button type="button" className="authBackBtn" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> Back
        </button>
        <Logo />
        <div className="authTools">
          <span className="authHint">{hint}</span>
          <DemoSlot />
          <StyleMenu theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </header>
      <main className="authWrap">
        <section className="authIntro" ref={intro}>
          <p className="authEyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="authLead">{lead}</p>
          <ol className="authSteps">
            {steps.map(([name, line], i) => (
              <li key={name} className={at === undefined ? '' : i === at ? 'now' : i < at ? 'done' : 'later'}>
                <span className="authStepMark" aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <b>{name}</b>
                <small>{line}</small>
              </li>
            ))}
          </ol>
        </section>
        <div className="authCardWrap" ref={card}>
          {children}
        </div>
      </main>
    </div>
  );
}

// Asks the server whether this email and password may sign in: { ok: true } or { ok: false, error }.
async function checkSignIn(email, password) {
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    // only a 401 is a "no"; anything else (no sign-in route, a proxy's error page) is the server not checking
    if (res.status === 401) return { ok: false, error: body.error || 'That email and password don’t match.' };
    return { ok: false, error: body.error || `Couldn’t check your sign-in (the server answered ${res.status}). Try again in a moment.` };
  } catch {
    return { ok: false, error: 'Couldn’t reach the server to check your sign-in. Try again in a moment.' };
  }
}

//   newcomer: came to start (a "Create…" button) and never set up here, so greeted as new, not "welcome back"
export function Login({ theme, onToggleTheme, onLogin, onBack, newcomer = false }) {
  const [keep, setKeep] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refused, setRefused] = useState('');
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailError = submitted && !emailValid ? (email.trim() ? 'Enter a valid email address, like you@company.com.' : 'Enter your work email.') : '';
  const passwordError = submitted && !password.trim() ? 'Enter your password.' : '';
  const canLogin = emailValid && password.trim();
  const demo = isDemoMode();

  return (
    <AuthShell
      theme={theme}
      onToggleTheme={onToggleTheme}
      onBack={onBack}
      hint="AI agent workspace"
      eyebrow={newcomer ? 'Get started' : 'Welcome back'}
      title={
        newcomer ? (
          <>
            Build your first agent <em>in minutes.</em>
          </>
        ) : (
          <>
            Pick up where you <em>left off.</em>
          </>
        )
      }
      lead={
        newcomer
          ? 'Say what it should do in your own words, try it out, then put it live. No code needed.'
          : 'Your agents, tests, configurations, and workspace settings stay together in one place.'
      }
      steps={[
        ['Design', 'Shape the agent in plain language.'],
        ['Test', 'Try the experience before shipping it.'],
        ['Deploy', 'Keep a clean technical config underneath.'],
      ]}
    >
      <form
        className="authCard"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitted(true);
          if (!canLogin || checking) return;
          setChecking(true);
          setRefused('');
          const answer = await checkSignIn(email.trim(), password);
          setChecking(false);
          if (answer.ok) onLogin(email.trim(), keep);
          else setRefused(answer.error);
        }}
      >
        <div className="authCardTop">
          <span className="authCardLabel">{demo ? 'Demo sign-in' : 'Sign in'}</span>
          <span className="authLock" aria-hidden="true">
            <Icon name="shield" size={15} />
          </span>
        </div>
        <h2>{newcomer ? 'Get started with Weave' : 'Sign in to Weave'}</h2>
        <p className="authFormIntro">{newcomer ? 'Use your work email to set up your workspace.' : 'Use your work email to open your workspaces.'}</p>
        {refused && (
          <p className="authNotice" role="alert">
            <Icon name="info" size={15} />
            <span>{refused}</span>
          </p>
        )}
        <label className={`authField${emailError ? ' hasError' : ''}`}>
          <span>Work email</span>
          <input
            autoFocus
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? 'login-email-error' : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setRefused('');
            }}
          />
          {emailError && (
            <em className="authError" id="login-email-error">
              {emailError}
            </em>
          )}
        </label>
        <label className={`authField${passwordError ? ' hasError' : ''}`}>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            aria-invalid={!!passwordError}
            aria-describedby={passwordError ? 'login-password-error' : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setRefused('');
            }}
          />
          {passwordError && (
            <em className="authError" id="login-password-error">
              {passwordError}
            </em>
          )}
        </label>
        <div className="authRow">
          <label className="authCheck">
            <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} /> Keep me signed in
          </label>
          <button type="button" className="authLink" aria-expanded={resetOpen} onClick={() => setResetOpen((value) => !value)}>
            Forgot password?
          </button>
        </div>
        {resetOpen && (
          <div className="authReset" role="region" aria-label="Reset password">
            <strong>Reset your password</strong>
            <p>Ask whoever runs this studio to set a new password for you: the sign-ins are kept in the server’s credentials.txt.</p>
            <div className="authResetActions">
              <button type="button" className="authLink" onClick={() => setResetOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <button className="authBtn" type="submit" disabled={checking}>
          <span>{checking ? 'Checking…' : newcomer ? 'Continue' : 'Continue to workspace'}</span>
          <span className="authBtnIcon" aria-hidden="true">
            <Icon name="arrowRight" size={16} />
          </span>
        </button>
      </form>
    </AuthShell>
  );
}
