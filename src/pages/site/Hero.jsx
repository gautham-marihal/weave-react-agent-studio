import { useRef } from 'react';
import { motion, useScroll, useSpring, useTransform } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import HeroProduct from './HeroProduct.jsx';
import { EASE, EASE_IN_OUT, Magnetic, SplitWords } from './siteMotion.jsx';

// The first screen: the promise in the middle, over a fine grid and a slow aurora of colour, and under it the studio
// itself, mid-call. The window starts tilted back and straightens as the page scrolls, as if set down in front of you.
// The page opens with a line drawn across the dark and the dark parting around it (the first time in a visit).
//   at: when the copy starts (after the opening, or almost at once)

export function Curtain() {
  return (
    <div className="sCurtain" aria-hidden="true">
      <motion.div className="sCurtainHalf top" initial={{ y: '0%' }} animate={{ y: '-101%' }} transition={{ duration: 1.1, ease: EASE_IN_OUT, delay: 0.85 }} />
      <motion.div
        className="sCurtainHalf bottom"
        initial={{ y: '0%' }}
        animate={{ y: '101%' }}
        transition={{ duration: 1.1, ease: EASE_IN_OUT, delay: 0.85 }}
      />
      <motion.div
        className="sCurtainLine"
        initial={{ scaleX: 0, opacity: 1 }}
        animate={{ scaleX: [0, 1, 1], opacity: [1, 1, 0] }}
        transition={{ duration: 1.5, times: [0, 0.55, 1], ease: EASE_IN_OUT }}
      />
    </div>
  );
}

export default function Hero({ onStart, onSignIn, at }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const eased = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });
  // the window straightens and comes forward over the first part of the scroll
  const tilt = useTransform(eased, [0, 0.4], [22, 0]);
  const scale = useTransform(eased, [0, 0.4], [0.92, 1]);
  const lift = useTransform(eased, [0, 0.4], [0, -60]);
  const copyY = useTransform(scrollYProgress, [0, 0.5], ['0%', '-18%']);
  const copyFade = useTransform(scrollYProgress, [0, 0.35], [1, 0]);
  const auroraY = useTransform(scrollYProgress, [0, 1], ['0%', '30%']);

  return (
    <section className="sHero" ref={ref} aria-labelledby="hero-title">
      <div className="sHeroBack" aria-hidden="true">
        <div className="sGridLines" />
        <motion.div
          className="sAurora"
          style={{ y: auroraY }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 2, ease: EASE, delay: at - 0.4 }}
        >
          <i />
          <i />
          <i />
        </motion.div>
      </div>

      <motion.div className="sHeroCopy" style={{ y: copyY, opacity: copyFade }}>
        <motion.p className="sEyebrow" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: at }}>
          <span className="sPulse" aria-hidden="true" /> Weave Agent Studio · voice and chat agents
        </motion.p>
        <h1 className="sHeroTitle" id="hero-title">
          <SplitWords text="Give every idea" className="sLine" delay={at + 0.1} step={0.07} />
          <SplitWords text="a voice people trust." className="sLine sLineAccent" delay={at + 0.32} step={0.07} />
        </h1>
        <motion.p
          className="sHeroLead"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: at + 0.7 }}
        >
          Describe the agent you need. Weave shapes it, lets you talk to it, and puts it live on the phone and the web. Every setting stays yours to change.
        </motion.p>
        <motion.div
          className="sHeroActions"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: at + 0.85 }}
        >
          <Magnetic>
            <button type="button" className="sBtn" onClick={onStart}>
              <span className="sBtnLabel">Create your first agent</span>
              <span className="sBtnIcon" aria-hidden="true">
                <Icon name="arrowRight" size={16} />
              </span>
            </button>
          </Magnetic>
          <button type="button" className="sGhost" onClick={onSignIn}>
            I have an account
          </button>
        </motion.div>
      </motion.div>

      <motion.div
        className="sHeroStage"
        initial={{ opacity: 0, y: 80 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.4, ease: EASE, delay: at + 0.9 }}
      >
        <div className="sHeroStageGlow" aria-hidden="true" />
        <motion.div className="sHeroFrame" style={{ rotateX: tilt, scale, y: lift, transformPerspective: 1800 }}>
          <HeroProduct at={at + 0.9} />
        </motion.div>
      </motion.div>
    </section>
  );
}
