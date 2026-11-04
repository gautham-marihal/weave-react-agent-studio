// The voice orb, drawn on a canvas: "Weave", threads of light woven into a sphere. Each thread is a circle turning on
// its own axis, seen in 3D (nearer parts brighter and thicker), with a soft light at its heart and sonar rings round it.
// Each state moves its own way, and the orb eases from one to the next:
//   idle        the threads turn slowly and the weave breathes
//   connecting  the threads run as dashes and dashed rings go round, the colour dimmed
//   listening   the weave draws in and calms; rings come in towards it; the caller's voice ripples the threads
//   thinking    the threads turn fast and run as dashes while the whole weave spins
//   speaking    the weave opens; the agent's voice ripples the threads and sends rings out
//   ended       it stops and its colour drains; error turns it red
// Colours are the style's (--orb-1…4 in themes.css), read again when the theme or style changes. No dark disc: on a
// light page each colour is deepened until it stands out on white, on a dark page (or inside an element marked
// data-orb-surface="dark") it is brightened. No React:
// VoiceStage.jsx and AiOrb.jsx make one with createOrb() and tell it the state.
//
//   const orb = createOrb(canvas, { size, getLevel, getUserLevel });  orb.setState('speaking');  orb.destroy();
//   getLevel / getUserLevel: how loud the agent / the caller is, 0 to 1, read every frame (optional; a getLevel that gives
//   no number lets a speaking orb move as if talking)

// What each state looks like, eased towards: how fast each thread turns and the whole weave spins, how much it
// breathes, how bright it is, the dashed rings round it, how far the threads break into dashes, how far it draws in
// (less than nothing opens it), and how much colour is drained
const LOOK = {
  idle: { spin: 0.55, whirl: 0.05, breathe: 0.025, bright: 0.85, dashes: 0, broken: 0, gather: 0, drain: 0 },
  connecting: { spin: 0.9, whirl: 0.3, breathe: 0.03, bright: 0.55, dashes: 1, broken: 0.6, gather: 0.04, drain: 0.3 },
  joining: { spin: 0.9, whirl: 0.3, breathe: 0.03, bright: 0.55, dashes: 1, broken: 0.6, gather: 0.04, drain: 0.3 },
  listening: { spin: 0.4, whirl: 0.03, breathe: 0.02, bright: 0.92, dashes: 0, broken: 0, gather: 0.08, drain: 0 },
  thinking: { spin: 2.4, whirl: 1.3, breathe: 0.012, bright: 1, dashes: 0, broken: 1, gather: 0.02, drain: 0 },
  speaking: { spin: 0.8, whirl: 0.08, breathe: 0.01, bright: 1, dashes: 0, broken: 0, gather: -0.03, drain: 0 },
  ended: { spin: 0, whirl: 0, breathe: 0, bright: 0.45, dashes: 0, broken: 0, gather: 0.04, drain: 0.85 },
  error: { spin: 0.3, whirl: 0.02, breathe: 0.02, bright: 0.85, dashes: 0, broken: 0, gather: 0, drain: 0 },
};
const KEYS = Object.keys(LOOK.idle);
const THREADS = 9;
const STEPS = 96; // pieces of each thread
const RADIUS = 0.39; // the weave's radius, as a share of the orb's size
const REACH = 1.8; // how far the rings reach, in weave radii (the canvas is drawn big enough for them)
const RING_LIFE = { in: 2.4, out: 1.5 }; // seconds a ring lives
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const WHITE = [255, 255, 255];

// A CSS colour as [r, g, b], read through a canvas (so any format the browser knows works)
function rgbOf(paint, color, fallback) {
  paint.fillStyle = fallback;
  paint.fillStyle = color || fallback;
  const s = paint.fillStyle;
  if (s.startsWith('#')) return [1, 3, 5].map((i) => Number.parseInt(s.slice(i, i + 2), 16));
  const m = s.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
// a colour with some of its colour drained towards its grey
const drained = ([r, g, b], d) => {
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  return [r, g, b].map((c) => Math.round(c + (grey - c) * d));
};
// how light a colour looks (WCAG relative luminance, 0 to 1)
const luminance = (c) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// A style colour made to stand out on the page: on white, deepened (towards a dark ink of its own hue) until it has
// about 3.5:1 contrast; on a dark page, brightened until it glows. Pale styles (Calm, Premium) need it most.
export function standOut(color, dark) {
  let c = color;
  for (let i = 0; i < 12; i += 1) {
    const l = luminance(c);
    if (dark ? l >= 0.3 : l <= 0.25) break;
    c = dark ? mix(c, WHITE, 0.12) : mix(c, mix(c, [10, 6, 24], 0.85), 0.16);
  }
  return c;
}

export function createOrb(canvas, { size: startSize = 200, getLevel, getUserLevel } = {}) {
  const paint = canvas.getContext?.('2d');
  if (!paint) return { setState() {}, setSize() {}, destroy() {} };
  const host = canvas.parentElement || canvas;
  let size = startSize; // the orb's size in CSS pixels, changed by setSize
  let state = 'idle';
  const look = { ...LOOK.idle };
  let colors = null;
  let dark = false;
  let px = 0; // the canvas's side, in CSS pixels
  let scale = 1;
  let frame = 0;
  let visible = true;
  let still = typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION).matches;
  let level = 0;
  let heard = 0;
  let turn = 0.4; // how far the threads have turned
  let whirl = 0; // how far the whole weave has spun
  let last = 0;
  let clock = 0;
  let lastRing = -10;
  const rings = []; // { born, dir: 'in' | 'out' }

  const readColors = () => {
    const css = getComputedStyle(host);
    const get = (name, fallback) => rgbOf(paint, css.getPropertyValue(name).trim(), fallback);
    // a dark page, or a dark card on a light one (it says so with data-orb-surface="dark")
    dark = document.documentElement.dataset.theme === 'dark' || !!host.closest?.('[data-orb-surface="dark"]');
    const raw = {
      a: get('--orb-1', '#3b6cff'),
      b: get('--orb-2', '#8b5cf6'),
      c: get('--orb-3', '#22c3ee'),
      d: get('--orb-4', '#f472b6'),
    };
    colors = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, standOut(value, dark)]));
  };
  const setSize = (next) => {
    size = next;
    px = Math.round(size * RADIUS * 2 * REACH + 8);
    scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(px * scale);
    canvas.height = Math.round(px * scale);
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
  };

  // the voices: rise fast, fall slowly; a simulated agent with no level "talks" by itself
  const listen = () => {
    const real = state === 'speaking' ? getLevel?.() : null;
    const said =
      state !== 'speaking'
        ? 0
        : typeof real === 'number'
          ? Math.min(1, real * 2.2)
          : Math.max(0, 0.45 + 0.4 * Math.sin(clock * 7.3) * Math.sin(clock * 2.1 + 1));
    level += (said - level) * (said > level ? 0.35 : 0.08);
    const mine = state === 'listening' && getUserLevel ? Math.min(1, getUserLevel() * 2.5) : 0;
    heard += (mine - heard) * (mine > heard ? 0.3 : 0.07);
  };

  // sonar: rings come in while it listens, go out with the voice while it speaks; with reduced motion, one still ring
  // says which way the sound goes
  const drawRings = (C, R, ringColor) => {
    if (!still) {
      if (state === 'listening' && clock - lastRing > 0.8 + (1 - heard) * 0.5) {
        rings.push({ born: clock, dir: 'in' });
        lastRing = clock;
      } else if (state === 'speaking' && level > 0.3 && clock - lastRing > 0.42) {
        rings.push({ born: clock, dir: 'out' });
        lastRing = clock;
      }
    }
    for (let i = rings.length - 1; i >= 0; i -= 1) if (clock - rings[i].born > RING_LIFE[rings[i].dir]) rings.splice(i, 1);
    rings.forEach(({ born, dir }) => {
      const age = (clock - born) / RING_LIFE[dir];
      const at = dir === 'out' ? 1.08 + age * (REACH - 1.08) : REACH - age * (REACH - 1.12);
      const fade = dir === 'out' ? 1 - age : Math.sin(Math.PI * age);
      paint.beginPath();
      paint.arc(C, C, R * at, 0, Math.PI * 2);
      paint.strokeStyle = rgba(ringColor, fade * (dark ? 0.55 : 0.5));
      paint.lineWidth = dir === 'out' ? 1 + 1.5 * (1 - age) : 1.25;
      paint.stroke();
    });
    if (still && (state === 'listening' || state === 'speaking')) {
      paint.beginPath();
      paint.arc(C, C, R * 1.3, 0, Math.PI * 2);
      paint.strokeStyle = rgba(ringColor, 0.45);
      paint.lineWidth = 1.25;
      paint.stroke();
    }
    // dashed rings turning both ways while it connects or thinks
    if (look.dashes > 0.02) {
      const turn = clock * (state === 'thinking' ? 1.6 : 0.9);
      [
        [1.2, [6, 9], turn, 1.6],
        [1.42, [2, 10], -turn * 0.6, 1.2],
      ].forEach(([at, pattern, offset, width]) => {
        paint.save();
        paint.translate(C, C);
        paint.rotate(offset);
        paint.beginPath();
        paint.arc(0, 0, R * at, 0, Math.PI * 2);
        paint.setLineDash(pattern);
        paint.strokeStyle = rgba(ringColor, look.dashes * (dark ? 0.6 : 0.55));
        paint.lineWidth = width;
        paint.stroke();
        paint.restore();
      });
      paint.setLineDash([]);
    }
  };

  // the light at the heart of the weave: white-hot on a dark page, a soft tint of the style on a light one; it swells
  // with the voice
  const drawCore = (C, R, col) => {
    const reach = R * (0.58 + level * 0.22 + heard * 0.1);
    const core = paint.createRadialGradient(C, C, 0, C, C, reach);
    const glowing = look.bright * (1 - look.drain * 0.5);
    if (dark) {
      core.addColorStop(0, rgba(WHITE, 0.6 * glowing));
      core.addColorStop(0.3, rgba(col('b'), 0.28 * glowing));
    } else {
      core.addColorStop(0, rgba(col('b'), 0.26 * glowing));
      core.addColorStop(0.45, rgba(col('b'), 0.1 * glowing));
    }
    core.addColorStop(1, rgba(col('b'), 0));
    paint.fillStyle = core;
    paint.fillRect(C - reach, C - reach, reach * 2, reach * 2);
  };

  // the threads: each a circle in its own plane round the centre (the planes spread over half a turn, and the whole
  // weave spins with `whirl`), turning on its own axis (`turn`, each a little behind the last) and seen in perspective.
  // The voices ripple them in waves; thinking breaks them into running dashes. Each thread is cut into runs of the same
  // depth, drawn back to front, nearer ones brighter and thicker; one gradient colours them all from the top left to the
  // bottom right through the style's colours.
  const BANDS = 6;
  const drawWeave = (C, R, col) => {
    const voice = level * 0.085 + heard * 0.05;
    const width = Math.max(0.9, size * 0.0085);
    const gap = 0.5 * look.broken;
    const runs = []; // { band, points }
    for (let i = 0; i < THREADS; i += 1) {
      const plane = (i * Math.PI) / THREADS + whirl;
      const axis = turn + (i * 2 * Math.PI) / THREADS;
      const [cp, sp, ca, sa] = [Math.cos(plane), Math.sin(plane), Math.cos(axis), Math.sin(axis)];
      let run = null;
      for (let k = 0; k <= STEPS; k += 1) {
        const t = (k / STEPS) * 2 * Math.PI;
        const r = 1 + voice * Math.sin(5 * t + clock * 7 + i * 1.3);
        const lx = r * Math.cos(t);
        const ly = r * Math.sin(t) * ca;
        const z = r * Math.sin(t) * sa;
        const depth = 3.4 / (3.4 - z);
        const point = [C + (lx * cp - ly * sp) * R * depth, C + (lx * sp + ly * cp) * R * depth];
        const band = Math.min(BANDS - 1, Math.floor(((Math.max(-1, Math.min(1, z)) + 1) / 2) * BANDS));
        const shown = gap < 0.01 || ((k / STEPS) * 10 + clock * 1.6 + i * 0.37) % 1 < 1 - gap;
        if (!shown) {
          run = null;
          continue;
        }
        if (run && run.band === band) run.points.push(point);
        else {
          // a new run starts where the last one ended, so the thread has no seams
          const from = run ? run.points[run.points.length - 1] : null;
          run = { band, points: from ? [from, point] : [point] };
          runs.push(run);
        }
      }
    }
    const stops = [col('c'), col('a'), col('b'), col('d')];
    const colour = paint.createLinearGradient(C - R, C - R, C + R, C + R);
    stops.forEach((c, n) => colour.addColorStop(n / (stops.length - 1), rgba(c, 1)));
    paint.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    paint.lineCap = 'round';
    paint.lineJoin = 'round';
    paint.strokeStyle = colour;
    const bright = look.bright * (1 - look.drain * 0.4);
    runs
      .filter((run) => run.points.length > 1)
      .sort((p, q) => p.band - q.band)
      .forEach(({ band, points }) => {
        const near = (band + 0.5) / BANDS; // 0 at the back, 1 at the front
        paint.globalAlpha = Math.min(1, bright * ((dark ? 0.14 : 0.24) + (dark ? 0.86 : 0.76) * near * near) + level * 0.12 * near);
        paint.lineWidth = width * (0.55 + 0.9 * near);
        paint.beginPath();
        paint.moveTo(points[0][0], points[0][1]);
        for (let n = 1; n < points.length; n += 1) paint.lineTo(points[n][0], points[n][1]);
        paint.stroke();
      });
    paint.globalAlpha = 1;
    paint.globalCompositeOperation = 'source-over';
  };

  // one frame: `dt` seconds since the last
  const draw = (dt) => {
    const target = LOOK[state] || LOOK.idle;
    const ease = still ? 1 : 1 - Math.pow(0.03, dt); // about a second to settle into a new state
    KEYS.forEach((key) => {
      look[key] += (target[key] - look[key]) * ease;
    });
    listen();
    if (!still) {
      clock += dt;
      turn += dt * look.spin;
      whirl += dt * look.whirl;
    }
    const W = px;
    const C = W / 2;
    const R = size * RADIUS * (1 - look.gather + look.breathe * Math.sin(clock * 1.4) + level * 0.06 + heard * 0.03);
    const col = (key) => drained(colors[key], look.drain);
    paint.setTransform(scale, 0, 0, scale, 0, 0);
    paint.clearRect(0, 0, W, W);
    // on a dark page, a soft light round the weave, brighter as it speaks
    if (dark) {
      const glow = paint.createRadialGradient(C, C, R * 0.5, C, C, R * 1.5);
      glow.addColorStop(0, rgba(mix(col('a'), col('c'), 0.4), 0.22 * (0.6 + look.bright * 0.4 + level * 0.6)));
      glow.addColorStop(1, rgba(col('a'), 0));
      paint.fillStyle = glow;
      paint.fillRect(0, 0, W, W);
    }
    // the ring colour: the bright one on a dark page, the deeper one on a light page
    drawRings(C, R, dark ? col('c') : col('b'));
    drawCore(C, R, col);
    drawWeave(C, R, col);
  };

  const loop = (time) => {
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
    last = time;
    draw(dt);
    frame = visible && !still ? requestAnimationFrame(loop) : 0;
  };
  const run = () => {
    if (frame || still || !visible) return;
    last = 0;
    frame = requestAnimationFrame(loop);
  };
  const halt = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  // only drawn while it can be seen
  const watch =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting && !document.hidden;
          if (visible) run();
          else halt();
        })
      : null;
  watch?.observe(canvas);
  const onHidden = () => {
    visible = !document.hidden;
    if (visible) run();
    else halt();
  };
  document.addEventListener('visibilitychange', onHidden);
  // a new theme or style brings new colours
  const restyle = new MutationObserver(() => {
    readColors();
    if (still) draw(0);
  });
  restyle.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'class'] });
  const motion = window.matchMedia?.(REDUCED_MOTION);
  const onMotion = () => {
    still = !!motion?.matches;
    if (still) {
      halt();
      draw(0);
    } else run();
  };
  motion?.addEventListener?.('change', onMotion);

  setSize(size);
  readColors();
  draw(1 / 60);
  run();

  return {
    // the agent's state, eased into; with reduced motion, drawn once as it stands
    setState(next) {
      if (next === state) return;
      state = next;
      readColors(); // the error state brings its own colours
      if (still) draw(0);
      else run();
    },
    setSize(next) {
      if (next === size) return;
      setSize(next);
      draw(0);
    },
    destroy() {
      halt();
      watch?.disconnect();
      restyle.disconnect();
      document.removeEventListener('visibilitychange', onHidden);
      motion?.removeEventListener?.('change', onMotion);
    },
  };
}
