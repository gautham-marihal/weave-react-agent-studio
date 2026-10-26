// How an arrow leaves one block and enters another: out of the side or the end that faces the other block, in a smooth curve, and around any block in
// the way rather than behind it. Pure: no React, no DOM.

const DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDES = ['bottom', 'top', 'right', 'left'];
const port = (n, side) =>
  ({ top: [n.x + n.w / 2, n.y], bottom: [n.x + n.w / 2, n.y + n.h], left: [n.x, n.y + n.h / 2], right: [n.x + n.w, n.y + n.h / 2] })[side];
// how far an arrow keeps from a block it passes, and how far a bend goes out around one
const CLEAR = 8;
const AROUND = 30;

// Which side of each block the arrow uses. What goes with an agent (what it does as it takes over, what it can do) sits
// beside it, so those arrows run sideways as long as the block is still on that side.
export function sidesFor(a, b, kind) {
  if ((kind === 'exit' || kind === 'uses') && b.x >= a.x + a.w - 20) return ['right', 'left'];
  if (kind === 'enter' && a.x + a.w <= b.x + 20) return ['right', 'left'];
  if (a.y + a.h + 20 <= b.y) return ['bottom', 'top'];
  if (b.y + b.h + 20 <= a.y) return ['top', 'bottom'];
  return b.x + b.w / 2 >= a.x + a.w / 2 ? ['right', 'left'] : ['left', 'right'];
}

// One cubic piece: from p1 leaving along d1, to p2 arriving along d2 (d2 points the way the arrow travels as it arrives).
function piece(p1, d1, p2, d2, k) {
  const c1 = [p1[0] + d1[0] * k, p1[1] + d1[1] * k];
  const c2 = [p2[0] - d2[0] * k, p2[1] - d2[1] * k];
  const at = (t) => {
    const u = 1 - t;
    return [
      u ** 3 * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p2[0],
      u ** 3 * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p2[1],
    ];
  };
  // a cubic never leaves the box around its four points: only a block that box touches can be in its way
  const xs = [p1[0], c1[0], c2[0], p2[0]];
  const ys = [p1[1], c1[1], c2[1], p2[1]];
  const box = { x: Math.min(...xs), y: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
  return { d: `C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`, at, box };
}
const near = (pieces, r, pad) => pieces.some(({ box }) => r.x - pad < box.r && r.x + r.w + pad > box.x && r.y - pad < box.b && r.y + r.h + pad > box.y);
const bend = (dist) => Math.max(36, Math.min(150, dist * 0.45));
const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

// Points along a route, for testing it against the blocks and measuring it.
const points = (pieces, steps = 24) => pieces.flatMap((p, i) => Array.from({ length: steps + 1 }, (_, s) => p.at(s / steps)).slice(i ? 1 : 0));
const inside = ([x, y], r, pad) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;
// The first block a route runs through (its own two ends only in its middle, where it should be well clear of them), or null.
function blocking(pts, obstacles, ends) {
  for (let i = 1; i < pts.length - 1; i += 1) {
    const hit = obstacles.find((r) => inside(pts[i], r, CLEAR));
    if (hit) return hit;
    const middle = i > pts.length * 0.12 && i < pts.length * 0.88;
    if (middle && ends.some((r) => inside(pts[i], r, 0))) return ends.find((r) => inside(pts[i], r, 0));
  }
  return null;
}
const lengthOf = (pts) => pts.reduce((sum, p, i) => (i ? sum + dist(pts[i - 1], p) : 0), 0);

// `lane` and `lanes` spread arrows that join the same two blocks side by side so they do not lie on top of each other.
// `fromShift` moves where the arrow leaves its first block along that side (each way out of a subagent leaves from its
// own point). `obstacles` are the other blocks ({ x, y, w, h }): a route that would run through one is replaced by the
// shortest one that does not, out of other sides or bent around it.
export function routeEdge(a, b, { lane = 0, lanes = 1, kind, obstacles = [], fromShift } = {}) {
  if (a.id === b.id) {
    const x = a.x + a.w;
    const y = a.y + a.h / 2;
    return { d: `M ${x} ${y - 14} C ${x + 54} ${y - 40}, ${x + 54} ${y + 40}, ${x + 2} ${y + 14}`, lx: x + 46, ly: y };
  }
  const shift = (lane - (lanes - 1) / 2) * 22;
  const ends = (sa, sb) => {
    const p1 = port(a, sa);
    const p2 = port(b, sb);
    const out = fromShift ?? shift;
    if (sa === 'bottom' || sa === 'top') p1[0] += out;
    else p1[1] += out;
    if (sb === 'bottom' || sb === 'top') p2[0] += shift;
    else p2[1] += shift;
    return [p1, p2];
  };
  // a route from side sa of a to side sb of b, straight or through a point beside a block in the way
  const route = (sa, sb, via = null) => {
    const [p1, p2] = ends(sa, sb);
    const into = DIR[sb].map((v) => -v);
    if (!via) {
      const one = piece(p1, DIR[sa], p2, into, bend(dist(p1, p2)));
      const mid = one.at(0.5);
      return { sides: [sa, sb], pieces: [one], d: `M ${p1[0]} ${p1[1]} ${one.d}`, lx: mid[0], ly: mid[1] };
    }
    const first = piece(p1, DIR[sa], via.at, via.dir, bend(dist(p1, via.at)));
    const second = piece(via.at, via.dir, p2, into, bend(dist(via.at, p2)));
    return { sides: [sa, sb], pieces: [first, second], d: `M ${p1[0]} ${p1[1]} ${first.d} ${second.d}`, lx: via.at[0], ly: via.at[1] };
  };
  const finish = (r) => ({ d: r.d, lx: r.lx, ly: r.ly + (lane - (lanes - 1) / 2) * 26, sides: r.sides });

  const [sa, sb] = sidesFor(a, b, kind);
  const usual = route(sa, sb);
  const others = obstacles.filter((r) => r && r !== a && r !== b && r.id !== a.id && r.id !== b.id);
  const blockEnds = [a, b];
  // the first block a route runs through: only the blocks near it are looked at
  const test = (r) =>
    blocking(
      points(r.pieces),
      others.filter((o) => near(r.pieces, o, CLEAR)),
      blockEnds,
    );
  const inTheWay = others.length ? test(usual) : null;
  if (!inTheWay) return finish(usual);

  // the shortest of some routes that runs through nothing: measured roughly, then tested shortest first, so the search stops at the first clear one
  const shortestClear = (list) =>
    list
      .map((r) => ({ r, length: lengthOf(points(r.pieces, 6)) }))
      .sort((p, q) => p.length - q.length)
      .find(({ r }) => !test(r))?.r || null;
  // other sides first
  const bySides = shortestClear(SIDES.flatMap((s1) => SIDES.filter((s2) => s1 !== sa || s2 !== sb).map((s2) => route(s1, s2))));
  if (bySides) return finish(bySides);

  // then bent around the block in the way, on whichever side is shortest and clear
  const [p1, p2] = ends(sa, sb);
  const down = Math.sign(p2[1] - p1[1]) || 1;
  const across = Math.sign(p2[0] - p1[0]) || 1;
  const o = inTheWay;
  const vias = [
    { at: [o.x - AROUND, o.y + o.h / 2], dir: [0, down] },
    { at: [o.x + o.w + AROUND, o.y + o.h / 2], dir: [0, down] },
    { at: [o.x + o.w / 2, o.y - AROUND], dir: [across, 0] },
    { at: [o.x + o.w / 2, o.y + o.h + AROUND], dir: [across, 0] },
  ];
  const around = shortestClear(vias.flatMap((via) => SIDES.flatMap((s1) => SIDES.map((s2) => route(s1, s2, via)))));
  return finish(around || usual);
}
