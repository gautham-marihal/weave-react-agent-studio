import { Children, Fragment, useRef } from 'react';
import { motion, useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react';

// The site's movement vocabulary (Motion for React), so every section moves the same way: words rise out of a mask,
// blocks drift up as they come into view, pictures open like a shutter, buttons lean towards the pointer, and cards
// carry a light where the pointer is. MotionConfig reducedMotion="user" (Site.jsx) turns the travel off for people who
// ask for less motion; what remains is a quick fade.

export const EASE = [0.16, 1, 0.3, 1]; // a long, soft landing
export const EASE_IN_OUT = [0.65, 0, 0.35, 1];

// how far up the page a block is before it starts to appear: a little in, so it is seen arriving
const VIEW = { once: true, amount: 0.25 };

/** A heading whose words rise one after another out of their own mask. `delay` holds the first word back. */
export function SplitWords({ text, as: Tag = 'span', className = '', delay = 0, step = 0.06, inView = false }) {
  const words = String(text).split(' ');
  const play = inView ? { initial: 'hidden', whileInView: 'shown', viewport: VIEW } : { initial: 'hidden', animate: 'shown' };
  return (
    <Tag className={className} aria-label={text}>
      <motion.span className="sWords" aria-hidden="true" {...play} transition={{ staggerChildren: step, delayChildren: delay }}>
        {words.map((word, i) => (
          // the space sits between the masks: inside one, the browser would drop it
          <Fragment key={`${word}-${i}`}>
            <span className="sWordMask">
              <motion.span
                className="sWord"
                variants={{ hidden: { y: '110%', rotate: 4 }, shown: { y: '0%', rotate: 0, transition: { duration: 0.9, ease: EASE } } }}
              >
                {word}
              </motion.span>
            </span>
            {i < words.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </motion.span>
    </Tag>
  );
}

/** A block that drifts up into place as it comes into view. */
export function Reveal({ children, delay = 0, y = 32, className = '', as = 'div', ...rest }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEW}
      transition={{ duration: 0.9, ease: EASE, delay }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Children that arrive one after another as their group comes into view. */
export function Stagger({ children, className = '', step = 0.08, as = 'div', ...rest }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag className={className} initial="hidden" whileInView="shown" viewport={VIEW} transition={{ staggerChildren: step }} {...rest}>
      {Children.map(children, (child) =>
        child ? (
          <motion.div
            className="sStaggerItem"
            variants={{ hidden: { opacity: 0, y: 28 }, shown: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } } }}
          >
            {child}
          </motion.div>
        ) : null,
      )}
    </Tag>
  );
}

/** A picture that opens like a shutter, from the bottom edge up, while its inside settles from a slight zoom. The frame
 *  around it says when it is in view: a fully clipped picture counts as unseen to the browser, so it would never open. */
export function ShutterReveal({ children, className = '', delay = 0 }) {
  const frame = useRef(null);
  const seen = useInView(frame, { once: true, amount: 0.2 });
  return (
    <div ref={frame} className={`sShutterFrame ${className}`}>
      <motion.div
        className="sShutter"
        initial={{ clipPath: 'inset(100% 0% 0% 0% round 28px)' }}
        animate={seen ? { clipPath: 'inset(0% 0% 0% 0% round 28px)' } : undefined}
        transition={{ duration: 1.2, ease: EASE_IN_OUT, delay }}
      >
        <motion.div
          className="sShutterInner"
          initial={{ scale: 1.12 }}
          animate={seen ? { scale: 1 } : undefined}
          transition={{ duration: 1.6, ease: EASE, delay }}
        >
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}

/** A button (or link) that leans towards the pointer and springs back when it leaves. */
export function Magnetic({ children, strength = 0.28, className = '' }) {
  const ref = useRef(null);
  const still = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.6 });
  const move = (event) => {
    if (still || event.pointerType === 'touch' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((event.clientX - (r.left + r.width / 2)) * strength);
    y.set((event.clientY - (r.top + r.height / 2)) * strength);
  };
  const leave = () => {
    x.set(0);
    y.set(0);
  };
  return (
    <motion.span ref={ref} className={`sMagnetic ${className}`} style={{ x: sx, y: sy }} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </motion.span>
  );
}

/** Pointer handlers that keep `--mx`/`--my` on the element, for a light that follows the pointer across a card. */
export function spotlight(event) {
  const el = event.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${event.clientX - r.left}px`);
  el.style.setProperty('--my', `${event.clientY - r.top}px`);
}
