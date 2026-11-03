import { motion } from 'motion/react';
import Icon from '../../ui/Icon.jsx';
import { EASE } from './siteMotion.jsx';

// The hero's centrepiece: the studio itself, mid-call. An agent's Test page with the conversation arriving line by line,
// the caller's voice level, the tool it used and what the call has measured so far. Drawn in code, so it is sharp at any
// size, and hidden from screen readers (the copy beside it says what it shows).
//   at: when the page's opening has finished, so its own lines start after it

const LINES = [
  ['caller', 'Hi, I’d like to move my cleaning to next week.'],
  ['agent', 'Of course. I have Tuesday at 10 or Thursday at 3. Which suits you?'],
  ['caller', 'Thursday at 3, please.'],
  ['tool', 'book_appointment · Thu 15:00 · confirmed'],
  ['agent', 'You’re booked for Thursday at 3. I’ve sent the details by text.'],
];

const BARS = Array.from({ length: 28 }, (_, i) => i);

export default function HeroProduct({ at = 0 }) {
  const line = (i) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: EASE, delay: at + 0.5 + i * 0.75 },
  });
  return (
    <div className="sProduct" aria-hidden="true">
      <div className="sProductBar">
        <span className="sDots">
          <i />
          <i />
          <i />
        </span>
        <span className="sProductPath">
          Agents <b>/</b> Dental front desk <b>/</b> <em>Test</em>
        </span>
        <span className="sProductLive">
          <i /> Live call · 00:42
        </span>
      </div>
      <div className="sProductBody">
        <aside className="sProductSide">
          <span className="sProductMark" />
          {['home', 'agent', 'phone', 'live', 'monitor', 'gauge'].map((icon, i) => (
            <i key={icon} className={i === 1 ? 'on' : ''}>
              <Icon name={icon} size={15} />
            </i>
          ))}
        </aside>

        <section className="sProductChat">
          <header>
            <strong>Conversation</strong>
            <span>Web voice · English (UK)</span>
          </header>
          <ul>
            {LINES.map(([who, text], i) => (
              <motion.li key={text} className={who} {...line(i)}>
                {who === 'tool' ? <Icon name="bolt" size={13} /> : <small>{who === 'agent' ? 'Agent' : 'Caller'}</small>}
                <span>{text}</span>
              </motion.li>
            ))}
          </ul>
          <motion.div className="sProductTyping" {...line(LINES.length)}>
            <span>
              <i />
              <i />
              <i />
            </span>
            Listening
          </motion.div>
        </section>

        <section className="sProductSidePanel">
          <div className="sProductCard sVoiceCard">
            <header>
              <strong>Caller’s voice</strong>
              <span>Speaking</span>
            </header>
            <div className="sLevel">
              {BARS.map((i) => (
                <i key={i} style={{ '--i': i }} />
              ))}
            </div>
          </div>
          <div className="sProductCard">
            <header>
              <strong>This call</strong>
            </header>
            <dl className="sMetrics">
              <div>
                <dt>Answer time</dt>
                <dd>0.9 s</dd>
              </div>
              <div>
                <dt>Tools used</dt>
                <dd>1</dd>
              </div>
              <div>
                <dt>Interruptions</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>Hand-over</dt>
                <dd>Not needed</dd>
              </div>
            </dl>
          </div>
          <div className="sProductCard sChecks">
            <header>
              <strong>Guardrails</strong>
              <span className="ok">All passing</span>
            </header>
            <ul>
              <li>
                <Icon name="check" size={13} /> No medical advice
              </li>
              <li>
                <Icon name="check" size={13} /> Card numbers never read out
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
