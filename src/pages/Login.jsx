import { useState } from 'react';
import { Logo } from './shared.jsx';
import { isDemoMode } from '../demo/demoMode.js';
import { StyleMenu } from '../ui/StylePicker.jsx';
import { DemoSlot } from '../demo/DemoBadge.jsx';
import Icon from '../ui/Icon.jsx';
import Select from '../ui/Select.tsx';

// Signing in (Login) and, the first time, saying who you are (ProfileSetup). There is no real sign-in in the studio:
// who is signed in is kept in this browser (docs/PRODUCTION.md says what goes in front of it for real).

export function Login({ theme, onToggleTheme, onLogin, onBack }) {
  const [keep, setKeep] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailError = submitted && !emailValid ? (email.trim() ? 'Enter a valid email address, like you@company.com.' : 'Enter your work email.') : '';
  const passwordError = submitted && !password.trim() ? 'Enter your password.' : '';
  const canLogin = emailValid && password.trim();
  const demo = isDemoMode();

  return (
    <div className="loginScreen">
      <div className="loginBackdrop loginBackdropA" />
      <div className="loginBackdrop loginBackdropB" />
      <header className="simpleHeader">
        <button className="backButton" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> Back
        </button>
        <Logo />
        <div className="headerTools">
          <div className="headerHint">AI agent workspace</div>
          <DemoSlot />
          <StyleMenu theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </header>
      <div className="loginWrap">
        <div className="loginIntro">
          <div className="eyebrow cyan">Welcome back</div>
          <h1>Pick up where you left off.</h1>
          <p>Your agents, tests, configurations, and workspace settings stay together in one place.</p>
          <div className="loginHighlights">
            <div>
              <span>01</span>
              <strong>Design</strong>
              <small>Shape the agent in plain language.</small>
            </div>
            <div>
              <span>02</span>
              <strong>Test</strong>
              <small>Try the experience before shipping it.</small>
            </div>
            <div>
              <span>03</span>
              <strong>Deploy</strong>
              <small>Keep a clean technical config underneath.</small>
            </div>
          </div>
        </div>

        <form
          className="loginCard"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            if (canLogin) onLogin(email.trim(), keep);
          }}
        >
          <div className="loginCardTop">
            <span className="cardEyebrow">{demo ? 'Demo sign-in' : 'Sign in'}</span>
            <span className="lockMark" aria-hidden="true">
              <Icon name="shield" size={15} />
            </span>
          </div>
          <h2>Sign in to Weave</h2>
          <p className="formIntro">{demo ? 'Enter any email and password to continue.' : 'Use your work email to open your workspaces.'}</p>
          {/* sign-in isn't checked by a server yet: said plainly, because it decides who can change the agents */}
          <p className="demoNotice" role="note">
            {/* in demo mode the card's own label already says "Demo sign-in" */}
            {!demo && <b>Sign-in isn’t verified yet</b>}
            <span>
              {demo
                ? 'Nothing is checked, and what you enter stays in this browser. It is not a security measure: anyone who can open this site can edit, publish and deploy the agents behind it.'
                : 'This copy of Weave doesn’t check passwords yet, so anyone who can open it can edit, publish and deploy its agents. Keep it where only your team can reach it.'}
            </span>
          </p>
          <label className={emailError ? 'hasError' : ''}>
            <span>Work email</span>
            <input
              autoFocus
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'login-email-error' : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
            {emailError && (
              <em className="fieldError" id="login-email-error">
                {emailError}
              </em>
            )}
          </label>
          <label className={passwordError ? 'hasError' : ''}>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? 'login-password-error' : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            {passwordError && (
              <em className="fieldError" id="login-password-error">
                {passwordError}
              </em>
            )}
          </label>
          <div className="loginRow">
            <label className="checkLabel">
              <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} /> Keep me signed in
            </label>
            <button type="button" aria-expanded={resetOpen} onClick={() => setResetOpen((value) => !value)}>
              Forgot password?
            </button>
          </div>
          {resetOpen && (
            <div className="resetPanel" role="region" aria-label="Reset password">
              <strong>Reset your password</strong>
              <p>Sign-in is kept on this device for now, so there’s no password to reset. Continue with your work email and your workspaces open as before.</p>
              <div className="resetActions">
                <button type="button" className="secondaryCta compactSecondary" disabled={!emailValid} onClick={() => onLogin(email.trim(), keep)}>
                  {emailValid ? `Continue as ${email.trim()}` : 'Enter your work email above'}
                </button>
                <button type="button" className="textLink" onClick={() => setResetOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <button className="primaryCta full" type="submit">
            Continue to workspace
          </button>
        </form>
      </div>
    </div>
  );
}

export function ProfileSetup({ email, theme, onToggleTheme, onComplete, onBack }) {
  const [fullName, setFullName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [role, setRole] = useState('');
  const canContinue = fullName.trim() && workspaceName.trim() && role.trim();

  const submit = (event) => {
    event.preventDefault();
    if (!canContinue) return;
    onComplete({
      fullName: fullName.trim(),
      workspaceName: workspaceName.trim(),
      role: role.trim(),
      email,
    });
  };

  return (
    <div className="profileSetupScreen">
      <div className="profileSetupGlow profileGlowA" />
      <div className="profileSetupGlow profileGlowB" />
      <header className="simpleHeader profileHeader">
        <button className="backButton" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> Back
        </button>
        <Logo />
        <div className="headerTools">
          <div className="headerHint">First-time setup</div>
          <DemoSlot />
          <StyleMenu theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </header>

      <main className="profileSetupWrap">
        <section className="profileSetupIntro">
          <div className="eyebrow cyan">Let’s set up your workspace</div>
          <h1>Before you start building, tell us a little about you.</h1>
          <p>We’ll use these details to personalize your workspace. You only need to do this once.</p>
          <div className="setupStepsMini">
            <div className="miniStep active">
              <span>01</span>
              <b>Your profile</b>
              <small>Tell us what to call you.</small>
            </div>
            <div className="miniStep">
              <span>02</span>
              <b>Your workspace</b>
              <small>We’ll use it across Weave.</small>
            </div>
            <div className="miniStep">
              <span>03</span>
              <b>Build</b>
              <small>Describe your first agent.</small>
            </div>
          </div>
        </section>

        <form className="profileCard" onSubmit={submit}>
          <div className="profileCardTop">
            <div>
              <span className="cardEyebrow">Your details</span>
              <h2>Welcome to Weave</h2>
            </div>
          </div>
          <p className="profileIntro">A few details to set up your workspace.</p>

          <label>
            <span>What should we call you?</span>
            <input autoFocus type="text" placeholder="e.g. Alex Morgan" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>

          <label>
            <span>What should we call your workspace?</span>
            <input type="text" placeholder="e.g. Acme Inc." value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
          </label>

          <label>
            <span>What’s your role?</span>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Select your role</option>
              <option>Founder / Owner</option>
              <option>Product</option>
              <option>Engineering</option>
              <option>Operations</option>
              <option>Customer Support</option>
              <option>Sales</option>
              <option>Other</option>
            </Select>
          </label>

          <div className="profileEmail">
            <span>Signed in as</span>
            <b>{email || 'your account'}</b>
          </div>
          <button className="primaryCta full" type="submit" disabled={!canContinue}>
            Continue to my workspace <Icon name="arrowRight" size={16} />
          </button>
          <small className="privacyNote">You can change these details later from workspace settings.</small>
        </form>
      </main>
    </div>
  );
}
