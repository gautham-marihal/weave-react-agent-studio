import { useEffect, useRef, useState } from 'react';
import { Logo, openHelpDialog, openInfoDialog } from './shared.jsx';
import { StyleMenu } from '../ui/StylePicker.jsx';
import { DemoSlot } from '../demo/DemoBadge.jsx';
import Icon from '../ui/Icon.jsx';

const LANDING_MENUS = {
  Product: [
    { title: 'Config', text: 'Edit an agent’s conversation, voice, tools and handoff as a form, with checks as you type.', action: 'start' },
    { title: 'Test', text: 'Talk or type to an agent for real, in your browser, before you deploy it.', action: 'start' },
    { title: 'Versions', text: 'Every configuration you create is recorded with a list of what changed.', action: 'start' },
  ],
  Solutions: [
    { title: 'Customer care', text: 'Resolve questions and hand off to a person when needed.', action: 'start' },
    { title: 'Front desk', text: 'Greet callers, understand why they called and route them.', action: 'start' },
    { title: 'Booking concierge', text: 'Collect availability and contact details to schedule.', action: 'start' },
    { title: 'Lead concierge', text: 'Qualify interest and prepare the next step for your team.', action: 'start' },
  ],
  Resources: [
    { title: 'Help & shortcuts', text: 'Keyboard shortcuts and a short guide to the workspace.', action: 'help' },
    { title: 'Configuration schema', text: 'The JSON schema that describes an agent configuration.', action: 'link', href: '/config/agent-config.schema.json' },
    { title: 'Example configuration', text: 'A complete example agent configuration file.', action: 'link', href: '/config/agent-config.example.json' },
  ],
};

// Landing navigation: Product, Solutions and Resources open menus; Pricing explains the
// early-access status. Menus close on outside click and Escape.
function LandingNav({ onStart }) {
  const [open, setOpen] = useState(null);
  const navRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!navRef.current?.contains(event.target)) setOpen(null);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const choose = (item) => {
    setOpen(null);
    if (item.action === 'help') openHelpDialog();
    else if (item.action === 'link') window.open(item.href, '_blank', 'noopener');
    else onStart?.();
  };
  return (
    <nav className="landingLinks" ref={navRef} aria-label="Main">
      {Object.keys(LANDING_MENUS).map((name) => (
        <div className="landingMenuWrap" key={name}>
          <button type="button" aria-expanded={open === name} aria-haspopup="true" onClick={() => setOpen((value) => (value === name ? null : name))}>
            {name} <Icon name="chevronDown" size={14} />
          </button>
          {open === name && (
            <div className="landingMenu" role="menu">
              {LANDING_MENUS[name].map((item) => (
                <button key={item.title} type="button" role="menuitem" className="landingMenuItem" onClick={() => choose(item)}>
                  <strong>
                    {item.title}
                    {item.action === 'link' && <Icon name="external" size={13} />}
                  </strong>
                  <small>{item.text}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setOpen(null);
          openInfoDialog({
            eyebrow: 'PRICING',
            title: 'Pricing isn’t published yet',
            body: 'Weave Agent Studio is in early access.',
            detail: 'Pricing for this early-access prototype hasn’t been announced. You can create and test agents in the meantime.',
          });
        }}
      >
        Pricing
      </button>
    </nav>
  );
}

export function Landing({ theme, onToggleTheme, onSignIn, onStart }) {
  return (
    <div className="landing">
      <div className="landingNoise" />
      <div className="announcement">
        <span className="announcementPulse" /> Weave Agent Studio is now in early access <Icon name="arrowRight" size={13} />
      </div>

      <header className="landingNav">
        <Logo />
        <LandingNav onStart={onStart} />
        <div className="landingActions">
          <DemoSlot />
          <StyleMenu theme={theme} onToggleTheme={onToggleTheme} />
          <button className="textButton" onClick={onSignIn}>
            Sign in
          </button>
          <button className="topStart" type="button" onClick={onStart}>
            Create an agent <Icon name="arrowRight" size={15} />
          </button>
        </div>
      </header>

      <main className="hero">
        <section className="heroCopy">
          <div className="eyebrow cyan">The AI agent workspace</div>
          <h1>
            Turn an idea into an agent people can <span>actually use.</span>
          </h1>
          <p>
            Weave makes complex agent configuration feel simple. Describe what you need, tune the important details, test the experience, and keep the technical
            config underneath.
          </p>
          <div className="heroButtons">
            <button className="primaryCta heroPrimary" type="button" onClick={onStart}>
              Create your first agent <Icon name="arrowRight" size={16} />
            </button>
            <button className="secondaryCta" onClick={onSignIn}>
              Sign in
            </button>
          </div>
          <div className="heroMeta">
            <span>
              <Icon name="check" size={14} /> Guided setup
            </span>
            <span>
              <Icon name="check" size={14} /> Voice and chat
            </span>
            <span>
              <Icon name="check" size={14} /> Configuration you can export
            </span>
          </div>
        </section>

        <section className="heroVisual" aria-hidden="true">
          <div className="glowOrb orbOne" />
          <div className="glowOrb orbTwo" />
          <div className="visualGrid" />
          <div className="showcaseCard showcaseMain">
            <div className="showcaseHeader">
              <div>
                <span className="liveDot" /> Live preview
              </div>
              <span className="statusPill">Ready</span>
            </div>
            <div className="assistantFace">
              <Icon name="sparkle" size={22} />
            </div>
            <div className="showcaseTitle">Your agent is ready.</div>
            <div className="showcaseText">Ask questions, take action, and hand off to a person when needed.</div>
            <div className="waveform">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="previewControls">
              <Icon name="mic" size={15} />
              <div className="previewTime">00:18</div>
              <button>End session</button>
            </div>
          </div>

          <div className="showcaseCard showcasePrompt">
            <div className="miniHeading">Plain-language setup</div>
            <div className="promptBubble">“Help customers check their account and transfer to a person when needed.”</div>
            <div className="promptArrow">
              <Icon name="chevronDown" size={16} />
            </div>
            <div className="mappedRow">
              <span>Intent</span>
              <b>Account support</b>
            </div>
            <div className="mappedRow">
              <span>Handoff</span>
              <b>Enabled</b>
            </div>
          </div>

          <div className="showcaseCard showcaseConfig">
            <div className="miniHeading">Under the hood</div>
            <div className="configLine">
              <span>model</span>
              <b>gpt-5</b>
            </div>
            <div className="configLine">
              <span>voice</span>
              <b>elevenlabs</b>
            </div>
            <div className="configLine">
              <span>tools</span>
              <b>4 enabled</b>
            </div>
          </div>
        </section>
      </main>

      <div className="landingBottom">
        <span>Built for product, operations and engineering teams</span>
        <span>© Weave · AI agent workspace</span>
      </div>
    </div>
  );
}
