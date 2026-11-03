import { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import { Logo, openHelpDialog } from '../shared.jsx';
import { EASE, Magnetic, Reveal, ShutterReveal, SplitWords, Stagger, spotlight } from './siteMotion.jsx';

// The site's sections after the hero and the story: the statement, the drifting word band, the voice, the studio's
// parts, the closing call and the footer. Every picture here is drawn in code (SVG, CSS and Motion), nothing licensed.

/* ---- the statement: its words light up as the page scrolls past, and beside them the maze turns into one sentence ---- */

// _words_ are the problem (set in italic), *words* the promise (italic in the accent colours)
const STATEMENT_MARKED =
  'Most agents are built in a _maze of settings_ and tested on hope. Weave turns *a few plain sentences* into a working agent, lets you *hear it* before anyone else does, and shows you *every conversation* once it is live.';
const STATEMENT = STATEMENT_MARKED.replace(/[_*]/g, '');

// each word with how it is set: plain, 'maze' or 'promise'
function markedWords(text) {
  let kind = null;
  return text.split(' ').map((raw) => {
    const opens = raw.match(/^[_*]/)?.[0];
    if (opens) kind = opens === '_' ? 'maze' : 'promise';
    const word = { text: raw.replace(/[_*]/g, ''), kind };
    if (/[_*][.,]?$/.test(raw)) kind = null;
    return word;
  });
}

function LitWord({ word, progress, from, to }) {
  const opacity = useTransform(progress, [from, to], [0.16, 1]);
  return (
    <>
      <motion.span className={word.kind ? `sLit ${word.kind}` : undefined} style={{ opacity }}>
        {word.text}
      </motion.span>{' '}
    </>
  );
}

const SETTINGS = [
  ['Model temperature', '0.7'],
  ['Voice activity threshold', '0.42'],
  ['Barge-in delay', '350 ms'],
  ['End-of-speech wait', '800 ms'],
  ['Fallback intent', 'transfer_queue_3'],
  ['Voice ID', 'en-GB-07-neural'],
];

// one setting in the list, lifting away in turn as the page scrolls, from the bottom up so the list simply gets shorter
function SettingRow({ name, value, progress, i }) {
  const from = 0.1 + (SETTINGS.length - 1 - i) * 0.035;
  const fade = useTransform(progress, [from, from + 0.08], [1, 0]);
  const lift = useTransform(progress, [from, from + 0.08], [0, -10]);
  const blur = useTransform(progress, [from, from + 0.08], ['blur(0px)', 'blur(4px)']);
  return (
    <motion.li style={{ opacity: fade, y: lift, filter: blur }}>
      <span>{name}</span>
      <code>{value}</code>
    </motion.li>
  );
}

// one card: a long settings list that clears away row by row, and the single sentence that takes its place. It runs on
// its own scroll, from the card fully in view to the card past the middle, so the whole list is seen before it clears.
function MazeToSentence() {
  const ref = useRef(null);
  const { scrollYProgress: progress } = useScroll({ target: ref, offset: ['center 0.8', 'center 0.3'] });
  const moreOut = useTransform(progress, [0.02, 0.1], [1, 0]);
  const countOut = useTransform(progress, [0.28, 0.36], [1, 0]);
  const countIn = useTransform(progress, [0.34, 0.42], [0, 1]);
  const promptIn = useTransform(progress, [0.3, 0.46], [0, 1]);
  const promptY = useTransform(progress, [0.3, 0.46], [16, 0]);
  const readyIn = useTransform(progress, [0.52, 0.66], [0, 1]);
  const readyScale = useTransform(progress, [0.52, 0.66], [0.9, 1]);
  return (
    <div className="sMaze" ref={ref} aria-hidden="true">
      <div className="sMazeCard">
        <header>
          <span>Agent setup</span>
          <b className="sMazeCount">
            <motion.span style={{ opacity: countOut }}>46 settings</motion.span>
            <motion.span className="now" style={{ opacity: countIn }}>
              1 sentence
            </motion.span>
          </b>
        </header>
        <div className="sMazeBody">
          <ul>
            {SETTINGS.map(([name, value], i) => (
              <SettingRow key={name} name={name} value={value} progress={progress} i={i} />
            ))}
            <motion.li className="more" style={{ opacity: moreOut }}>
              + 40 more to tune by hand
            </motion.li>
          </ul>
          <motion.div className="sMazePrompt" style={{ opacity: promptIn, y: promptY }}>
            <p>“A friendly front desk for a dental clinic. It books, moves and cancels appointments, and passes anything medical to a person.”</p>
            <motion.span className="sMazeReady" style={{ opacity: readyIn, scale: readyScale }}>
              <Icon name="check" size={14} /> Agent ready to test
            </motion.span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export function Statement() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] });
  const words = markedWords(STATEMENT_MARKED);
  return (
    <section className="sStatement" ref={ref} aria-label="Why Weave">
      <div className="sStatementCopy">
        <p className="sLabel">Why Weave</p>
        <p className="sStatementText" aria-label={STATEMENT}>
          <span aria-hidden="true">
            {words.map((word, i) => (
              <LitWord key={`${word.text}-${i}`} word={word} progress={scrollYProgress} from={i / words.length} to={(i + 3) / words.length} />
            ))}
          </span>
        </p>
      </div>
      <MazeToSentence />
    </section>
  );
}

/* ---- the band of words that drifts with the scroll, one row each way ---- */

const BAND = ['Describe', 'Shape', 'Test', 'Publish', 'Monitor'];

export function Band() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const left = useTransform(scrollYProgress, [0, 1], ['4%', '-26%']);
  const right = useTransform(scrollYProgress, [0, 1], ['-26%', '4%']);
  const row = (
    <>
      {[...BAND, ...BAND, ...BAND].map((word, i) => (
        <span key={`${word}-${i}`}>
          {word}
          <i aria-hidden="true">✳</i>
        </span>
      ))}
    </>
  );
  return (
    <div className="sBand" ref={ref} aria-hidden="true">
      <motion.div className="sBandRow" style={{ x: left }}>
        {row}
      </motion.div>
      <motion.div className="sBandRow outline" style={{ x: right }}>
        {row}
      </motion.div>
    </div>
  );
}

/* ---- the voice: an orb in layers that move at their own pace, and a conversation that writes itself ---- */

const CONVERSATION = [
  ['caller', 'I was charged twice for my last order.'],
  ['agent', 'I’m sorry about that. I can see both payments. I’ll refund the second one now.'],
  ['tool', 'refund_payment · done'],
  ['agent', 'It’s on its way and should show in three to five days. Anything else I can help with?'],
];

const BARS = Array.from({ length: 72 }, (_, i) => i);

export function Voice() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const far = useTransform(scrollYProgress, [0, 1], [90, -90]);
  const mid = useTransform(scrollYProgress, [0, 1], [50, -50]);
  const near = useTransform(scrollYProgress, [0, 1], [-30, 60]);
  const turn = useTransform(scrollYProgress, [0, 1], [-20, 40]);
  return (
    <section className="sVoice" ref={ref} aria-labelledby="voice-title">
      <div className="sVoiceCopy">
        <p className="sLabel">Voice and chat</p>
        <h2 className="sH2" id="voice-title">
          <SplitWords text="It listens." className="sLine" inView />
          <SplitWords text="It answers." className="sLine" inView delay={0.12} />
          <SplitWords text="It knows when" className="sLine sLineAccent" inView delay={0.24} />
          <SplitWords text="to hand over." className="sLine sLineAccent" inView delay={0.36} />
        </h2>
        <Reveal as="p" className="sBody" delay={0.2}>
          Real voices that can be interrupted, a choice of models, and tools that do the work: look up an order, book a slot, send a text. When a person is
          needed, the caller is passed on with a summary, so nobody asks twice.
        </Reveal>
        <Stagger className="sFeatureList" as="ul">
          <li>
            <Icon name="sound" size={16} /> Natural voices, in many languages
          </li>
          <li>
            <Icon name="tools" size={16} /> Tools that act, not just answer
          </li>
          <li>
            <Icon name="phoneTransfer" size={16} /> Hand-over with a summary
          </li>
        </Stagger>
      </div>

      <div className="sVoiceArt" aria-hidden="true">
        <motion.div className="sRing r1" style={{ y: far, rotate: turn }} />
        <motion.div className="sRing r2" style={{ y: mid }} />
        <motion.div className="sVoiceOrb" style={{ y: mid }}>
          {/* a ring of bars that rise and fall like a voice, around an iridescent core */}
          <div className="sBars">
            {BARS.map((i) => (
              <span key={i} style={{ '--i': i }}>
                <i />
              </span>
            ))}
          </div>
          <b className="sOrbGlow" />
          <div className="sOrbCore">
            <i />
          </div>
        </motion.div>
        <motion.ul
          className="sLiveChat"
          style={{ y: near }}
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, amount: 0.4 }}
          transition={{ staggerChildren: 0.55 }}
        >
          {CONVERSATION.map(([who, text]) => (
            <motion.li
              key={text}
              className={who}
              variants={{ hidden: { opacity: 0, y: 20, scale: 0.96 }, shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EASE } } }}
            >
              {who === 'tool' ? <Icon name="bolt" size={13} /> : null}
              {text}
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

/* ---- the studio's parts: cards that tilt towards the pointer and carry a light ---- */

function Card({ className = '', children }) {
  const still = useReducedMotion();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 200, damping: 20 });
  const sry = useSpring(ry, { stiffness: 200, damping: 20 });
  const move = (event) => {
    spotlight(event);
    if (still || event.pointerType === 'touch') return;
    const r = event.currentTarget.getBoundingClientRect();
    ry.set(((event.clientX - r.left) / r.width - 0.5) * 6);
    rx.set(-((event.clientY - r.top) / r.height - 0.5) * 6);
  };
  const leave = () => {
    rx.set(0);
    ry.set(0);
  };
  return (
    <motion.article
      className={`sCard ${className}`}
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 1000 }}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {children}
    </motion.article>
  );
}

const draw = (delay = 0) => ({
  initial: { pathLength: 0, opacity: 0 },
  whileInView: { pathLength: 1, opacity: 1 },
  viewport: { once: true, amount: 0.5 },
  transition: { duration: 1.2, ease: EASE, delay },
});

function WorkflowArt() {
  const nodes = [
    [40, 70, 'Front desk'],
    [210, 26, 'Bookings'],
    [210, 114, 'Billing'],
    [370, 70, 'A person'],
  ];
  return (
    <svg className="sArtWorkflow" viewBox="0 0 440 140" aria-hidden="true">
      <motion.path d="M96 70 C150 70 150 26 196 26" {...draw(0.1)} />
      <motion.path d="M96 70 C150 70 150 114 196 114" {...draw(0.25)} />
      <motion.path d="M276 26 C320 26 320 70 356 70" {...draw(0.5)} />
      <motion.path d="M276 114 C320 114 320 70 356 70" {...draw(0.65)} />
      {nodes.map(([x, y, label], i) => (
        <motion.g
          key={label}
          initial={{ opacity: 0, scale: 0.6 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.15 * i }}
          style={{ transformOrigin: `${x}px ${y}px` }}
        >
          <rect x={x - 42} y={y - 15} width="84" height="30" rx="15" />
          <text x={x} y={y + 4} textAnchor="middle">
            {label}
          </text>
        </motion.g>
      ))}
    </svg>
  );
}

function Counter({ to, suffix = '', decimals = 0 }) {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const still = useReducedMotion();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!seen) return undefined;
    if (still) {
      setValue(to);
      return undefined;
    }
    const controls = animate(0, to, { duration: 1.6, ease: EASE, onUpdate: setValue });
    return () => controls.stop();
  }, [seen, still, to]);
  return (
    <span ref={ref}>
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}

function MonitorArt() {
  return (
    <div className="sArtMonitor" aria-hidden="true">
      <div className="sStats">
        <div>
          <small>Handled without a person</small>
          <strong>
            <Counter to={81} suffix="%" />
          </strong>
        </div>
        <div>
          <small>Typical answer time</small>
          <strong>
            <Counter to={2.3} decimals={1} suffix=" s" />
          </strong>
        </div>
      </div>
      <svg viewBox="0 0 400 110" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sSpark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          className="sSparkFill"
          d="M0 92 C40 84 60 60 100 66 C140 72 160 40 200 44 C240 48 260 24 300 30 C340 36 360 14 400 12 L400 110 L0 110 Z"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: 0.6 }}
        />
        <motion.path className="sSparkLine" d="M0 92 C40 84 60 60 100 66 C140 72 160 40 200 44 C240 48 260 24 300 30 C340 36 360 14 400 12" {...draw(0.1)} />
      </svg>
      <p className="sSample">Sample numbers</p>
    </div>
  );
}

const PARTS = [
  {
    id: 'workflow',
    wide: true,
    icon: 'workflow',
    title: 'See the whole conversation as a map',
    text: 'Every agent, hand-over and tool on one canvas. Drag to change who answers what.',
    art: <WorkflowArt />,
  },
  {
    id: 'knowledge',
    icon: 'book',
    title: 'Answers from your own documents',
    text: 'Upload price lists, policies and guides. The agent quotes them, not the internet.',
    art: (
      <div className="sArtDocs" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    ),
  },
  {
    id: 'guardrails',
    icon: 'shield',
    title: 'Rules it will not break',
    text: 'Topics to avoid, words never to say, and what happens when someone tries.',
    art: (
      <Stagger className="sArtRules" as="ul" step={0.15}>
        <li>
          <Icon name="check" size={13} /> No medical advice
        </li>
        <li>
          <Icon name="check" size={13} /> Never reads out a card number
        </li>
        <li>
          <Icon name="check" size={13} /> Stays on topic
        </li>
      </Stagger>
    ),
  },
  {
    id: 'monitor',
    wide: true,
    icon: 'monitor',
    title: 'Every call, once it is live',
    text: 'Listen back, read the transcript, see where callers wait and which questions it could not answer.',
    art: <MonitorArt />,
  },
  {
    id: 'releases',
    icon: 'release',
    title: 'Versions you can trust',
    text: 'Publish, try it in Development and Staging, then go live. Roll back in one step.',
    art: (
      <div className="sArtTimeline" aria-hidden="true">
        {['v0.1', 'v0.2', 'v0.3'].map((v, i) => (
          <motion.span
            key={v}
            initial={{ opacity: 0, x: -10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.2 * i }}
          >
            <i />
            {v}
          </motion.span>
        ))}
      </div>
    ),
  },
  {
    id: 'channels',
    wide: true,
    icon: 'globe',
    title: 'One agent, every channel',
    text: 'A phone number, a voice button on your site, or a chat window. Same agent, same rules.',
    art: (
      <div className="sArtOrbit" aria-hidden="true">
        <span className="sOrbitCore" />
        <span className="sOrbitTrack">
          <i>
            <Icon name="phone" size={14} />
          </i>
          <i>
            <Icon name="mic" size={14} />
          </i>
          <i>
            <Icon name="chat" size={14} />
          </i>
        </span>
      </div>
    ),
  },
];

export function Studio() {
  return (
    <section className="sStudio" aria-labelledby="studio-title">
      <div className="sStudioHead">
        <p className="sLabel">The studio</p>
        <h2 className="sH2" id="studio-title">
          <SplitWords text="Everything an agent needs," className="sLine" inView />
          <SplitWords text="in one place." className="sLine sLineAccent" inView delay={0.2} />
        </h2>
      </div>
      <Stagger className="sGrid" step={0.09}>
        {PARTS.map((part) => (
          <Card key={part.id} className={`${part.wide ? 'wide' : ''} ${part.id}`}>
            <div className="sCardArt">{part.art}</div>
            <div className="sCardCopy">
              <span className="sCardIcon">
                <Icon name={part.icon} size={16} />
              </span>
              <h3>{part.title}</h3>
              <p>{part.text}</p>
            </div>
          </Card>
        ))}
      </Stagger>
    </section>
  );
}

/* ---- a real look at the studio: the product itself, opening like a shutter ---- */

export function Showcase() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const tilt = useTransform(scrollYProgress, [0, 0.5], [14, 0]);
  const lift = useTransform(scrollYProgress, [0, 1], [60, -60]);
  return (
    <section className="sShowcase" ref={ref} aria-labelledby="showcase-title">
      <div className="sShowcaseHead">
        <p className="sLabel">Built for teams</p>
        <h2 className="sH2" id="showcase-title">
          <SplitWords text="Calm enough for operations," className="sLine" inView />
          <SplitWords text="deep enough for engineers." className="sLine sLineAccent" inView delay={0.2} />
        </h2>
      </div>
      <motion.div className="sShowcaseFrame" style={{ rotateX: tilt, y: lift }}>
        <ShutterReveal>
          <StudioMock />
        </ShutterReveal>
      </motion.div>
    </section>
  );
}

// the studio's overview screen, drawn in code at a glance (not a screenshot, so it is sharp at any size)
function StudioMock() {
  return (
    <div className="sMock" aria-hidden="true">
      <aside className="sMockSide">
        <span className="sMockLogo" />
        {['home', 'agent', 'phone', 'live', 'monitor', 'gauge', 'bell'].map((icon, i) => (
          <i key={icon} className={i === 1 ? 'on' : ''}>
            <Icon name={icon} size={15} />
          </i>
        ))}
      </aside>
      <div className="sMockMain">
        <div className="sMockTop">
          <span>Agents</span> / <b>Dental front desk</b>
          <em>Live in Production</em>
        </div>
        <div className="sMockTabs">
          {['Overview', 'Build', 'Test', 'Release', 'Monitor'].map((tab, i) => (
            <span key={tab} className={i === 0 ? 'on' : ''}>
              {tab}
            </span>
          ))}
        </div>
        <div className="sMockTiles">
          {[
            ['Calls · last 7 days', '126'],
            ['Handled without a person', '81%'],
            ['Typical answer time', '2.3 s'],
            ['Cut off', '4%'],
          ].map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="sMockRows">
          {['Agent · its greeting and voice', 'Knowledge · price list, opening hours', 'Tools · check availability, book', 'Hand-over · reception, 9 to 5'].map(
            (row, i) => (
              <div key={row}>
                <i className={i < 3 ? 'done' : ''} />
                {row}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- the closing call ---- */

export function Closing({ onStart, onSignIn }) {
  return (
    <section className="sClosing" aria-labelledby="closing-title">
      <div className="sBloom" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <h2 className="sClosingTitle" id="closing-title">
        <SplitWords text="Your next agent" className="sLine" inView />
        <SplitWords text="begins with a sentence." className="sLine sLineAccent" inView delay={0.2} />
      </h2>
      <Reveal className="sClosingActions" delay={0.3}>
        <Magnetic strength={0.35}>
          <button type="button" className="sBtn sBtnLarge" onClick={onStart}>
            <span className="sBtnLabel">Create your first agent</span>
            <span className="sBtnIcon" aria-hidden="true">
              <Icon name="arrowRight" size={18} />
            </span>
          </button>
        </Magnetic>
        <button type="button" className="sGhost" onClick={onSignIn}>
          I have an account
        </button>
      </Reveal>
    </section>
  );
}

export function Footer({ onStart }) {
  return (
    <footer className="sFooter">
      <div className="sFooterTop">
        <div className="sFooterBrand">
          <Logo />
          <p>The studio for voice and chat agents: build, test, publish and monitor in one place.</p>
        </div>
        <nav className="sFooterCols" aria-label="Footer">
          <div>
            <h3>Product</h3>
            <button type="button" onClick={onStart}>
              Config
            </button>
            <button type="button" onClick={onStart}>
              Test
            </button>
            <button type="button" onClick={onStart}>
              Versions
            </button>
          </div>
          <div>
            <h3>Resources</h3>
            <button type="button" onClick={openHelpDialog}>
              Help & shortcuts
            </button>
            <a href="/config/agent-config.schema.json" target="_blank" rel="noopener">
              Configuration schema
            </a>
            <a href="/config/agent-config.example.json" target="_blank" rel="noopener">
              Example configuration
            </a>
          </div>
        </nav>
      </div>
      <div className="sFooterBottom">
        <span>© Weave · AI agent workspace</span>
        <span>Built for product, operations and engineering teams</span>
      </div>
      <p className="sFooterWord" aria-hidden="true">
        Weave
      </p>
    </footer>
  );
}
