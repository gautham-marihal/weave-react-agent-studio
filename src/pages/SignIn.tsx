import React, { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, ArrowRightIcon, LoaderCircleIcon, LockIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { WeaveMark } from '../components/ui/WeaveMark';
import { useTitleOverride } from '../hooks/usePageTitle';
import { profileProblems } from '../models/profile';
import { cn, inputClass, inputErrorClass } from '../utils/styles';
import { isSandbox, sandboxIsForced } from '../sandbox/mode';
import { SwitchSourceDialog } from '../sandbox/SwitchSourceDialog';
import { safeReturnPath } from '../utils/routes';

// Signing in and, the first time on this browser, saying who you are (then the Create dialog opens). There is no
// sign-in service yet: the password is not checked, and the profile (never a secret) is kept in this browser.

const journey = [
  { label: 'Build', text: 'Start from a starter, edit in plain words or raw JSON.' },
  { label: 'Test', text: 'Talk to your draft before anyone else does.' },
  { label: 'Release', text: 'Freeze versions, deploy with checks, roll back in two clicks.' },
  { label: 'Monitor', text: 'Read calls and watch health after every release.' },
];

const setupSteps = [
  { label: 'Your profile', text: 'What to call you.' },
  { label: 'Your workspace', text: 'A name for where your agents live.' },
  { label: 'Build', text: 'Choose a starter for your first agent.' },
];

export function SignIn() {
  const { user, signIn, signingIn, knownProfile, hasKnownProfiles } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // only a page of this app: the address someone was sent here from is whatever was typed or linked
  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  // Came to start (a "Start" button) and nobody has set up here before: greeted as new, not "welcome back".
  const newcomer = useMemo(() => !!searchParams.get('start') && !hasKnownProfiles(), [searchParams, hasKnownProfiles]);

  const [step, setStep] = useState<'signin' | 'profile'>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  // Sandbox: the sign-in says the studio runs on sample data in this browser, and offers Live (it asks first)
  const sandbox = isSandbox();
  const [offerLive, setOfferLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [profileTried, setProfileTried] = useState(false);

  // Where signing in leads: back to the page asked for; after the first-time profile, Home with the Create dialog open.
  // Set before signing in, so the redirect below (drawn once the person is signed in) takes it.
  const [after, setAfter] = useState<{ to: string; openCreate?: boolean }>({ to: from });

  useTitleOverride(step === 'profile' ? 'Set up your workspace' : null);

  if (user) return <Navigate to={after.to} replace state={after.openCreate ? { openCreate: true } : null} />;

  const continueWith = async () => {
    setError(null);
    if (!identifier.trim()) {
      setError('Enter your email or phone.');
      return;
    }
    // someone who set up here before goes straight in; anyone else says who they are first
    if (!knownProfile(identifier)) {
      setStep('profile');
      return;
    }
    setAfter({ to: from });
    const result = await signIn(identifier, { password, keep });
    if (!result.ok) setError(result.error || 'Could not sign in.');
  };

  const problems = profileProblems({ name, workspaceName });
  const finishProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileTried(true);
    if (Object.keys(problems).length) return;
    // the first-time setup ends where it promises ("Build: choose a starter"): in the Create dialog
    setAfter({ to: '/', openCreate: true });
    const result = await signIn(identifier, { password, keep, profile: { name, workspaceName } });
    if (!result.ok) setError(result.error || 'Could not sign in.');
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-canvas">
      <header className="flex items-center justify-between px-6 py-4">
        <Link to="/welcome" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-subtle hover:text-ink">
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <WeaveMark className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Weave Studio</span>
        </div>
        <span className="hidden text-xs text-muted sm:inline">{step === 'profile' ? 'First-time setup' : 'AI agent workspace'}</span>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="grid w-full max-w-4xl items-center gap-12 md:grid-cols-[1fr_400px]">
          {step === 'profile' ? (
            <section aria-labelledby="product-title">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">Let’s set up your workspace</p>
              <h1 id="product-title" className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-tight text-ink">
                Before you start building, tell us a little about you.
              </h1>
              <p className="mt-3 max-w-md text-sm text-ink-soft">You only do this once on this browser.</p>
              <ol className="mt-8 space-y-4 border-l border-line pl-5">
                {setupSteps.map((s, i) => (
                  <li key={s.label} aria-current={i === 0 ? 'step' : undefined}>
                    <p className={cn('text-sm font-semibold', i === 0 ? 'text-accent' : 'text-ink')}>
                      {String(i + 1).padStart(2, '0')} {s.label}
                    </p>
                    <p className="text-sm text-muted">{s.text}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <section aria-labelledby="product-title">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">{newcomer ? 'Get started' : 'Welcome back'}</p>
              <h1 id="product-title" className="mt-3 max-w-md text-3xl font-semibold leading-tight tracking-tight text-ink">
                {newcomer ? 'Build your first agent in minutes.' : 'Build, test and run the agents that talk to your customers.'}
              </h1>
              {newcomer && (
                <p className="mt-3 max-w-md text-sm text-ink-soft">Pick a starter, try it out, then put it live. No code needed.</p>
              )}
              <ol className="mt-8 space-y-4 border-l border-line pl-5">
                {journey.map((s) => (
                  <li key={s.label}>
                    <p className="text-sm font-semibold text-ink">{s.label}</p>
                    <p className="text-sm text-muted">{s.text}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {step === 'profile' ? (
            <section className="rounded-xl border border-line bg-surface p-8 shadow-panel" aria-labelledby="profile-title">
              <h2 id="profile-title" className="text-lg font-semibold text-ink">
                Welcome to Weave Studio
              </h2>
              <p className="mt-1 text-sm text-muted">A few details to set up your workspace.</p>
              <form onSubmit={finishProfile} noValidate className="mt-6 space-y-4">
                {error && (
                  <div className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-xs font-medium text-danger" role="alert">
                    {error}
                  </div>
                )}
                <div>
                  <label htmlFor="profile-name" className="block text-xs font-medium text-ink-soft">
                    What should we call you?
                  </label>
                  <input
                    id="profile-name"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Alex Morgan"
                    aria-invalid={profileTried && !!problems.name}
                    aria-describedby={profileTried && problems.name ? 'profile-name-error' : undefined}
                    className={cn('mt-1.5', inputClass, profileTried && problems.name && inputErrorClass)}
                  />
                  {profileTried && problems.name && (
                    <p id="profile-name-error" className="mt-1 text-xs text-danger">
                      {problems.name}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="profile-workspace" className="block text-xs font-medium text-ink-soft">
                    What should we call your workspace?
                  </label>
                  <input
                    id="profile-workspace"
                    type="text"
                    autoComplete="organization"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="e.g. Acme Inc."
                    aria-invalid={profileTried && !!problems.workspaceName}
                    aria-describedby={profileTried && problems.workspaceName ? 'profile-workspace-error' : undefined}
                    className={cn('mt-1.5', inputClass, profileTried && problems.workspaceName && inputErrorClass)}
                  />
                  {profileTried && problems.workspaceName && (
                    <p id="profile-workspace-error" className="mt-1 text-xs text-danger">
                      {problems.workspaceName}
                    </p>
                  )}
                </div>
                <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
                  Signed in as <strong className="font-semibold text-ink">{identifier.trim()}</strong>
                </p>
                <Button type="submit" variant="primary" className="h-10 w-full" disabled={signingIn}>
                  {signingIn ? (
                    <>
                      <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />
                      Setting up…
                    </>
                  ) : (
                    <>
                      Continue to my workspace
                      <ArrowRightIcon className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </Button>
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span>Kept in this browser. You can see these details under Account.</span>
                  <button type="button" className="shrink-0 font-medium text-accent hover:underline" onClick={() => setStep('signin')}>
                    Back
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <section className="rounded-xl border border-line bg-surface p-8 shadow-panel" aria-labelledby="signin-title">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{sandbox ? 'Sandbox sign-in' : 'Temporary sign-in'}</p>
              <h2 id="signin-title" className="mt-1 text-lg font-semibold text-ink">
                {newcomer ? 'Get started with Weave Studio' : 'Sign in to Weave Studio'}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {newcomer ? 'Use your work email to set up your workspace.' : 'Use your work email or phone to open your workspace.'}
              </p>
              {sandbox ? (
                <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-ink-soft" role="note" data-testid="sandbox-signin">
                  <p>
                    <strong className="font-semibold text-ink">You’re in Sandbox.</strong> Enter any email and password: nothing is checked, and what you
                    enter stays in this browser. The agents and calls are samples kept here, and nothing reaches the real Agent Builder API.
                  </p>
                  {!sandboxIsForced() && (
                    <button type="button" className="mt-1 font-medium text-accent hover:underline" onClick={() => setOfferLive(true)}>
                      Use Live instead
                    </button>
                  )}
                  <SwitchSourceDialog to={offerLive ? 'live' : null} onClose={() => setOfferLive(false)} />
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-ink-soft" role="note">
                  <strong className="font-semibold text-ink">Sign-in isn’t verified yet.</strong> Your email or phone is sent to the API as your name on
                  saves and publishes. The password is not checked; a real sign-in will replace this.
                </p>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void continueWith();
                }}
                noValidate
                className="mt-5 space-y-4"
              >
                {error && (
                  <div className="rounded-lg border border-danger/20 bg-danger-soft p-3 text-xs font-medium text-danger" role="alert">
                    {error}
                  </div>
                )}
                <div>
                  <label htmlFor="signin-id" className="block text-xs font-medium text-ink-soft">
                    Email or phone
                  </label>
                  <input
                    id="signin-id"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="you@company.com or +1234567890"
                    className={cn('mt-1.5', inputClass)}
                  />
                </div>

                <div>
                  <label htmlFor="signin-password" className="block text-xs font-medium text-ink-soft">
                    Password
                  </label>
                  <input
                    id="signin-password"
                    name="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className={cn('mt-1.5', inputClass)}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-2 text-ink-soft">
                    <input
                      type="checkbox"
                      checked={keep}
                      onChange={(e) => setKeep(e.target.checked)}
                      className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--accent))]"
                    />
                    Keep me signed in
                  </label>
                  <button
                    type="button"
                    aria-expanded={resetOpen}
                    aria-controls="reset-panel"
                    onClick={() => setResetOpen((v) => !v)}
                    className="text-[13px] font-medium text-accent hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <p className="-mt-2 text-xs text-muted">
                  {keep ? 'You stay signed in on this browser until you sign out.' : 'You are signed out when this browser closes.'}
                </p>

                {resetOpen && (
                  <div id="reset-panel" role="region" aria-label="Reset password" className="rounded-lg border border-line bg-subtle p-3 text-[13px]">
                    <p className="font-semibold text-ink">There is no password reset yet</p>
                    <p className="mt-1 text-ink-soft">
                      Passwords aren’t checked yet, so there is nothing to reset. Continue with your email or phone and your workspace opens as before.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" disabled={!identifier.trim() || signingIn} onClick={() => void continueWith()}>
                        {identifier.trim() ? `Continue as ${identifier.trim()}` : 'Enter your email or phone above'}
                      </Button>
                      <button type="button" className="text-[13px] font-medium text-muted hover:text-ink" onClick={() => setResetOpen(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <Button type="submit" variant="primary" className="mt-2 h-10 w-full" disabled={signingIn}>
                  {signingIn ? (
                    <>
                      <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden />
                      Signing in…
                    </>
                  ) : newcomer ? (
                    'Continue'
                  ) : (
                    'Sign in'
                  )}
                </Button>
              </form>

              <div className="mt-6 flex gap-2.5 rounded-lg bg-subtle p-3 text-[13px] leading-relaxed text-ink-soft">
                <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                <p>
                  Studio never exposes API keys or secrets in your browser. Requests are signed and authenticated on the server. Only your name, email
                  and workspace name are kept in this browser.
                </p>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
