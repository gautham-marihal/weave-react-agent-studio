// How an arrow leaves one block and enters another: out of the side or the end that faces the other block, in a smooth curve. Pure: no React, no DOM.

const DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const port = (n, side) => ({ top: [n.x + n.w / 2, n.y], bottom: [n.x + n.w / 2, n.y + n.h], left: [n.x, n.y + n.h / 2], right: [n.x + n.w, n.y + n.h / 2] }[side]);

// Which side of each block the arrow uses. What goes with an agent (what it does as it takes over, what it can do) sits beside it, so those arrows run
// sideways as long as the block is still on that side.
export function sidesFor(a, b, kind) {
  if ((kind === 'exit' || kind === 'uses') && b.x >= a.x + a.w - 20) return ['right', 'left'];
  if (kind === 'enter' && a.x + a.w <= b.x + 20) return ['right', 'left'];
  if (a.y + a.h + 20 <= b.y) return ['bottom', 'top'];
  if (b.y + b.h + 20 <= a.y) return ['top', 'bottom'];
  return b.x + b.w / 2 >= a.x + a.w / 2 ? ['right', 'left'] : ['left', 'right'];
}

// `lane` and `lanes` spread arrows that join the same two blocks side by side so they do not lie on top of each other.
export function routeEdge(a, b, { lane = 0, lanes = 1, kind } = {}) {
  if (a.id === b.id) {
    const x = a.x + a.w; const y = a.y + a.h / 2;
    return { d: `M ${x} ${y - 14} C ${x + 54} ${y - 40}, ${x + 54} ${y + 40}, ${x + 2} ${y + 14}`, lx: x + 46, ly: y };
  }
  const [sa, sb] = sidesFor(a, b, kind);
  let [x1, y1] = port(a, sa);
  let [x2, y2] = port(b, sb);
  const shift = (lane - (lanes - 1) / 2) * 22;
  if (sa === 'bottom' || sa === 'top') x1 += shift; else y1 += shift;
  if (sb === 'bottom' || sb === 'top') x2 += shift; else y2 += shift;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const k = Math.max(36, Math.min(150, dist * 0.45));
  const [d1x, d1y] = DIR[sa]; const [d2x, d2y] = DIR[sb];
  const c1 = [x1 + d1x * k, y1 + d1y * k]; const c2 = [x2 + d2x * k, y2 + d2y * k];
  const mid = (t) => {
    const u = 1 - t;
    return [u ** 3 * x1 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * x2, u ** 3 * y1 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * y2];
  };
  // the words of arrows that join the same two blocks are stacked, one line each, so they never lie on one another
  const [lx, baseY] = mid(0.5);
  const ly = baseY + (lane - (lanes - 1) / 2) * 26;
  return { d: `M ${x1} ${y1} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${x2} ${y2}`, lx, ly, sides: [sa, sb] };
}
