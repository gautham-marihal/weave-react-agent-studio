import { useEffect, useState } from 'react';
import { MotionConfig, motion, useScroll, useSpring, useTransform } from 'motion/react';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import SiteNav from './SiteNav.jsx';
import Hero, { Curtain } from './Hero.jsx';
import Story from './Story.jsx';
import { Band, Closing, Footer, Showcase, Statement, Studio, Voice } from './Sections.jsx';
import './site.css';

// Weave's public site, before sign-in: one long page that tells what the studio does, from the first sentence to a live
// agent. Its look: deep ink, a fine grid and a slow aurora, the product itself as the picture, Instrument Serif
// headlines over Inter. Motion for React moves it (siteMotion.jsx); everything respects reduced motion. Sign in and Create an agent
// call onSignIn and onStart, as the old landing page did.

const INTRO_KEY = 'weave_site_intro';

// the full opening plays once a visit; coming back (after signing out, say) the page simply fades in
function useFirstVisit() {
  const [first] = useState(() => {
    try {
      const seen = sessionStorage.getItem(INTRO_KEY);
      sessionStorage.setItem(INTRO_KEY, '1');
      return !seen;
    } catch {
      return false;
    }
  });
  return first;
}

export default function Site({ theme, onToggleTheme, onSignIn, onStart }) {
  const first = useFirstVisit();
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const intro = first && !still;
  // when the hero's copy starts: after the curtain has parted, or almost at once
  const at = intro ? 1.35 : 0.15;
  const light = theme !== 'dark';

  // the whole page's progress, as a thin line across the top
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  // the ground shifts in tone between sections, so they hand over to each other rather than stop and start
  const hue = useTransform(scrollYProgress, [0, 0.25, 0.5, 0.75, 1], light ? [0, 0.4, 1, 0.5, 0.2] : [0, 0.6, 1, 0.45, 0.85]);
  const tone = useTransform(hue, (h) => `${Math.round(h * 100)}%`);

  // the page starts at the top, whatever the browser remembers
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    return () => {
      if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className={`site ${light ? 'light' : 'dark'}`}>
        <motion.div className="sGround" style={{ '--tone': tone }} aria-hidden="true" />
        <div className="sGrain" aria-hidden="true" />
        <motion.div className="sProgress" style={{ scaleX: progress }} aria-hidden="true" />
        {intro && <Curtain />}
        <SiteNav theme={theme} onToggleTheme={onToggleTheme} onSignIn={onSignIn} onStart={onStart} delay={intro ? 1.2 : 0} />
        <main id="pageContent" className="sMain">
          <Hero onStart={onStart} onSignIn={onSignIn} at={at} />
          <Statement />
          <Story />
          <Band />
          <Voice />
          <Studio />
          <Showcase />
          <Closing onStart={onStart} onSignIn={onSignIn} />
        </main>
        <Footer onStart={onStart} />
      </div>
    </MotionConfig>
  );
}
