import { useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { afterMenu, keepEscape } from '../../ui/layer.ts';
import { Logo, openHelpDialog } from '../shared.jsx';
import { StyleMenu } from '../../ui/StylePicker.jsx';
import { DemoSlot } from '../../demo/DemoBadge.jsx';
import Icon from '../../ui/Icon.jsx';
import { EASE, Magnetic } from './siteMotion.jsx';

// The site's top bar. It arrives piece by piece once the page has opened, turns to frosted glass when the page leaves
// the hero, slips away while reading down and comes back on the way up. Its menus (Product, Solutions, Resources) are
// Radix menus: arrows move, Escape or a click out closes. "Sign in" stays the first sign-in button on the page.

export const SITE_MENUS = {
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

// what a menu item does once its menu has closed
export const runMenuItem = (item, onStart) =>
  afterMenu(() => {
    if (item.action === 'help') openHelpDialog();
    else if (item.action === 'link') window.open(item.href, '_blank', 'noopener');
    else onStart?.();
  });

const piece = (i, delay) => ({
  initial: { opacity: 0, y: -14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: EASE, delay: delay + i * 0.07 },
});

export default function SiteNav({ theme, onToggleTheme, onSignIn, onStart, delay = 0 }) {
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => {
    const last = scrollY.getPrevious() ?? 0;
    setSolid(y > 40);
    // away while reading down, back on the way up; never hidden near the top
    setHidden(y > 480 && y > last + 2);
    if (y < last - 2) setHidden(false);
  });

  return (
    <motion.header
      className={`sNav ${solid ? 'solid' : ''}`}
      animate={{ y: hidden ? '-110%' : '0%' }}
      transition={{ duration: 0.5, ease: EASE }}
      // focus anywhere in it brings it back, so keyboard users never tab into something out of sight
      onFocusCapture={() => setHidden(false)}
    >
      <motion.div {...piece(0, delay)}>
        <Logo />
      </motion.div>
      <nav className="sNavLinks" aria-label="Main">
        {Object.keys(SITE_MENUS).map((name, i) => (
          <motion.div key={name} {...piece(i + 1, delay)}>
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="sNavLink">
                  <span>{name}</span>
                  <Icon name="chevronDown" size={14} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="sMenu rxLayer"
                  aria-label={name}
                  align="start"
                  sideOffset={10}
                  collisionPadding={12}
                  onEscapeKeyDown={keepEscape}
                >
                  {SITE_MENUS[name].map((item) => (
                    <DropdownMenu.Item key={item.title} asChild onSelect={runMenuItem(item, onStart)} textValue={item.title}>
                      <button type="button" className="sMenuItem">
                        <strong>
                          {item.title}
                          {item.action === 'link' && <Icon name="external" size={13} />}
                        </strong>
                        <small>{item.text}</small>
                      </button>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </motion.div>
        ))}
      </nav>
      <div className="sNavActions">
        <motion.div {...piece(4, delay)} className="sNavTools">
          <DemoSlot />
          <StyleMenu theme={theme} onToggleTheme={onToggleTheme} />
        </motion.div>
        <motion.div {...piece(5, delay)}>
          <button type="button" className="sNavSignIn" onClick={onSignIn}>
            Sign in
          </button>
        </motion.div>
        <motion.div {...piece(6, delay)}>
          <Magnetic strength={0.22}>
            <button type="button" className="sBtn sBtnSmall" onClick={onStart}>
              <span className="sBtnLabel">Create an agent</span>
              <span className="sBtnIcon" aria-hidden="true">
                <Icon name="arrowRight" size={15} />
              </span>
            </button>
          </Magnetic>
        </motion.div>
      </div>
    </motion.header>
  );
}
