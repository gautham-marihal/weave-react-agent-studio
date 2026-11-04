import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import { EASE, SplitWords } from './siteMotion.jsx';

// "From a sentence to a live agent": the section holds still while the page scrolls through four steps (describe,
// shape, talk to it, go live). The step list fills as you go and the stage beside it changes scene. On a narrow screen
// the steps simply follow one another, each with its scene.

const STEPS = [
  {
    id: 'describe',
    label: 'Describe',
    title: 'Say what it should do.',
    text: 'A few plain sentences are enough. Weave turns them into a first draft: its greeting, what it handles, and when it passes a caller to a person.',
  },
  {
    id: 'shape',
    label: 'Shape',
    title: 'Shape every detail.',
    text: 'Voice, language, tools, knowledge and guardrails, as a form with checks as you type. The full configuration stays underneath, never hidden.',
  },
  {
    id: 'talk',
    label: 'Talk to it',
    title: 'Hear it before anyone else.',
    text: 'Talk or type to the real agent in your browser. Watch what it heard, what it decided and which tools it used, turn by turn.',
  },
  {
    id: 'live',
    label: 'Go live',
    title: 'Put it live, safely.',
    text: 'Publish a version, try it in Development and Staging, then move it to Production. Every release lists what changed.',
  },
];

const BRIEF =
  'A friendly front desk for a dental clinic. It books cleanings, answers questions about prices, and hands over to the team for anything clinical.';

function Typed({ text }) {
  const still = useReducedMotion();
  const [shown, setShown] = useState(still ? text.length : 0);
  useEffect(() => {
    if (still) return undefined;
    const controls = animate(0, text.length, { duration: text.length * 0.022, ease: 'linear', onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [text, still]);
  return (
    <>
      {text.slice(0, shown)}
      <span className="sCaret" aria-hidden="true" />
    </>
  );
}

const rise = (i) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: EASE, delay: 0.25 + i * 0.12 } });

function DescribeScene() {
  return (
    <div className="sScene">
      <div className="sPanelHead">
        <Icon name="sparkle" size={15} /> Describe it
      </div>
      <p className="sPrompt">
        <Typed text={BRIEF} />
      </p>
      <div className="sChips">
        {['Greeting', 'Book a cleaning', 'Prices', 'Hand over to the team'].map((chip, i) => (
          <motion.span key={chip} className="sChip" {...rise(i + 6)}>
            <Icon name="check" size={13} /> {chip}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function ShapeScene() {
  const rows = [
    ['voice', 'Voice', 'Warm · English (UK)'],
    ['tools', 'Tools', 'Check availability · Book'],
    ['book', 'Knowledge', 'Price list · Opening hours'],
    ['shield', 'Guardrails', 'No medical advice'],
    ['phoneTransfer', 'Hand-over', 'Reception, 9 to 5'],
  ];
  return (
    <div className="sScene">
      <div className="sPanelHead">
        <Icon name="sliders" size={15} /> Dental front desk · draft
      </div>
      <ul className="sRows">
        {rows.map(([icon, label, value], i) => (
          <motion.li key={label} {...rise(i)}>
            <span className="sRowIcon">
              <Icon name={icon} size={15} />
            </span>
            <span className="sRowLabel">{label}</span>
            <span className="sRowValue">{value}</span>
            <motion.span className="sSwitch" initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + i * 0.12 }}>
              <motion.i initial={{ x: 0 }} animate={{ x: 14 }} transition={{ type: 'spring', stiffness: 400, damping: 24, delay: 0.6 + i * 0.12 }} />
            </motion.span>
          </motion.li>
        ))}
      </ul>
      <motion.div className="sCheck" {...rise(6)}>
        <Icon name="check" size={14} /> All checks pass
      </motion.div>
    </div>
  );
}

function TalkScene() {
  const lines = [
    ['caller', 'Hi, can I move my cleaning to next week?'],
    ['agent', 'Of course. I have Tuesday at 10 or Thursday at 3. Which suits you?'],
    ['caller', 'Thursday, please.'],
    ['agent', 'Done. You’ll get a text with the details.'],
  ];
  return (
    <div className="sScene sTalk">
      <div className="sOrbWrap" aria-hidden="true">
        <div className="sOrb">
          <i />
          <i />
          <i />
        </div>
      </div>
      <ul className="sTranscript">
        {lines.map(([who, text], i) => (
          <motion.li key={text} className={who} {...rise(i * 1.6)}>
            <small>{who === 'agent' ? 'Agent' : 'Caller'}</small>
            {text}
          </motion.li>
        ))}
      </ul>
      <motion.div className="sToolUsed" {...rise(7)}>
        <Icon name="tools" size={13} /> Used <b>book_appointment</b> · 412 ms
      </motion.div>
    </div>
  );
}

function LiveScene() {
  const envs = [
    ['Development', 'v0.3.0'],
    ['Staging', 'v0.3.0'],
    ['Production', 'v0.3.0'],
  ];
  return (
    <div className="sScene">
      <div className="sPanelHead">
        <Icon name="rocket" size={15} /> Release v0.3.0
      </div>
      <div className="sPipeline">
        {envs.map(([env, version], i) => (
          <motion.div key={env} className="sEnv" {...rise(i * 1.5)}>
            <motion.span
              className="sEnvDot"
              initial={{ scale: 0.4, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 16, delay: 0.4 + i * 0.35 }}
            />
            <strong>{env}</strong>
            <small>{version}</small>
          </motion.div>
        ))}
        <svg className="sPipeLine" viewBox="0 0 300 4" preserveAspectRatio="none" aria-hidden="true">
          <motion.line
            x1="0"
            y1="2"
            x2="300"
            y2="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, ease: EASE, delay: 0.3 }}
          />
        </svg>
      </div>
      <div className="sChannels">
        {[
          ['phone', 'Phone'],
          ['mic', 'Web voice'],
          ['chat', 'Web chat'],
        ].map(([icon, label], i) => (
          <motion.span key={label} className="sChip live" {...rise(5 + i)}>
            <Icon name={icon} size={13} /> {label}
          </motion.span>
        ))}
      </div>
      <motion.p className="sReleaseNote" {...rise(8)}>
        What changed: new greeting · booking tool added · hand-over hours set
      </motion.p>
    </div>
  );
}

const SCENES = { describe: DescribeScene, shape: ShapeScene, talk: TalkScene, live: LiveScene };

const NARROW = '(max-width: 900px)';
// whether the screen is too narrow to hold the section still beside its stage
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(NARROW);
    if (!query) return undefined;
    const change = () => setNarrow(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return narrow;
}

// a scene on a narrow screen plays when it comes into view, not before
function SceneWhenSeen({ id }) {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  const StepScene = SCENES[id];
  return (
    <div className="sPanel" aria-hidden="true" ref={ref}>
      {seen ? <StepScene /> : <div className="sScene" />}
    </div>
  );
}

export default function Story() {
  const narrow = useNarrow();
  return narrow ? <StoryStack /> : <StoryPinned />;
}

function StoryStack() {
  return (
    <section className="sStoryStackSection" aria-labelledby="story-title">
      <p className="sLabel">How it works</p>
      <h2 className="sH2" id="story-title">
        <SplitWords text="From a sentence" className="sLine" inView />
        <SplitWords text="to a live agent." className="sLine sLineAccent" inView delay={0.15} />
      </h2>
      <ol className="sStoryStack">
        {STEPS.map((step, i) => (
          <li key={step.id}>
            <p className="sLabel">
              {String(i + 1).padStart(2, '0')} · {step.label}
            </p>
            <h3 className="sH3">{step.title}</h3>
            <p>{step.text}</p>
            <SceneWhenSeen id={step.id} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function StoryPinned() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length * 0.999)))));
  const Scene = SCENES[STEPS[active].id];

  return (
    <section className="sStory" ref={ref} aria-labelledby="story-title">
      <div className="sStorySticky">
        <div className="sStoryCopy">
          <p className="sLabel">How it works</p>
          <h2 className="sH2" id="story-title">
            <SplitWords text="From a sentence" className="sLine" inView />
            <SplitWords text="to a live agent." className="sLine sLineAccent" inView delay={0.15} />
          </h2>
          <ol className="sSteps">
            <motion.span className="sStepsFill" style={{ scaleY: fill }} aria-hidden="true" />
            {STEPS.map((step, i) => (
              <li key={step.id} className={i === active ? 'on' : i < active ? 'done' : ''} aria-current={i === active ? 'step' : undefined}>
                <span className="sStepNo">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{step.label}</strong>
                  <AnimatePresence initial={false}>
                    {i === active && (
                      <motion.div
                        className="sStepBody"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                      >
                        <p className="sStepTitle">{step.title}</p>
                        <p>{step.text}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="sStage" aria-hidden="true">
          <div className="sStageGlow" />
          <div className="sPanel">
            <AnimatePresence mode="wait">
              <motion.div
                key={STEPS[active].id}
                initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -18, filter: 'blur(6px)' }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <Scene />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
