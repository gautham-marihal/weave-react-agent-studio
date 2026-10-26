// The lines of a tidied picture. The layout puts everything in columns (every block, and every point a line passes, in
// one column has the same middle). Here each line runs level out of its block, turns in the gap between two columns on
// a lane of its own, and runs level on through the next column (at the place the layout kept for it there: between the
// blocks, through its own words), so no two lines share a stretch and none crosses a block or the words on another
// line. A gap is made wider when its lanes need the room, and the lines leaving (or reaching) one side of a block each
// have a point of their own, in the order of where they go, so they do not cross as they leave it.
//   blocks: Map id → { cx, cy, half (half its own width), boxHalf (half the
//           room it takes, with what is plugged in under it), lo, hi (where on its side
//           a line can leave or arrive) }
//   lines:  [{ id, from, to, via: [{ x, y }] (the layout's points between its two blocks), label: { x, y, w } | null }]
// → { shift (id → how far right a block moves), routes (id → { points, labelAt, out, in (the sides it leaves and reaches) }) }

// a lane's distance from the columns on either side of its gap, and from the next lane
const MARGIN = 18;
const LANE = 12;
const MOST = 24;
// the least room between two points on one side of a block
const SEP = 10;

const span = (s) => Math.abs(s.a - s.b);
const within = (y, s) => y > Math.min(s.a, s.b) + 0.5 && y < Math.max(s.a, s.b) - 0.5;
// what it costs for s to turn before t (nearer the left column): the times the two cross, and a stretch they would share
const cost = (s, t) => (within(t.a, s) ? 1 : 0) + (within(s.b, t) ? 1 : 0) + (Math.abs(s.b - t.a) < 3 ? 2 : 0);

// The order of the lanes in one gap, left to right, so the lines in it cross as little as can be. s: { a (y at the left
// column), b (y at the right) }. The longest are placed first, each where it costs least; then each is moved to where
// it costs least, twice over.
export function orderLanes(segs) {
  const placeOf = (list, i) => {
    let best = 0;
    let least = Infinity;
    for (let at = 0; at <= list.length; at += 1) {
      let c = 0;
      list.forEach((x, k) => {
        c += k < at ? cost(segs[x], segs[i]) : cost(segs[i], segs[x]);
      });
      if (c < least) {
        least = c;
        best = at;
      }
    }
    return best;
  };
  let order = [];
  segs
    .map((_, i) => i)
    .sort((i, j) => span(segs[j]) - span(segs[i]) || segs[i].a - segs[j].a || i - j)
    .forEach((i) => order.splice(placeOf(order, i), 0, i));
  for (let round = 0; round < 2; round += 1) {
    [...order].forEach((i) => {
      const rest = order.filter((x) => x !== i);
      rest.splice(placeOf(rest, i), 0, i);
      order = rest;
    });
  }
  return order;
}

// Points on one side of a block, in the order given: each as near the height it heads for as the side allows, at least
// SEP apart (spread evenly when the side is too short for that).
export function spread(wants, lo, hi, sep = SEP) {
  const k = wants.length;
  if (!k) return [];
  if (hi - lo < (k - 1) * sep) return wants.map((_, i) => Math.round(k > 1 ? lo + ((hi - lo) * i) / (k - 1) : (lo + hi) / 2));
  const ys = wants.map((y) => Math.min(hi, Math.max(lo, y)));
  for (let i = 1; i < k; i += 1) ys[i] = Math.max(ys[i], ys[i - 1] + sep);
  if (ys[k - 1] > hi) {
    ys[k - 1] = hi;
    for (let i = k - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i], ys[i + 1] - sep);
  }
  return ys.map(Math.round);
}

export function planLanes(blocks, lines) {
  // the columns, left to right, and how far each reaches either side of its middle
  const keyOf = (x) => Math.round(x);
  const cols = new Map();
  const reach = (x, half) => {
    const key = keyOf(x);
    const c = cols.get(key) || { x, left: x, right: x };
    c.left = Math.min(c.left, x - half);
    c.right = Math.max(c.right, x + half);
    cols.set(key, c);
  };
  blocks.forEach((b) => reach(b.cx, b.boxHalf));
  lines.forEach((l) => l.via.forEach((p) => reach(p.x, l.label && Math.abs(p.x - l.label.x) < 1 ? l.label.w / 2 : 0)));
  const columns = [...cols.values()].sort((p, q) => p.x - q.x);
  const colOf = new Map(columns.map((c, i) => [keyOf(c.x), i]));
  const col = (x) => colOf.get(keyOf(x)) ?? 0;

  // each line's stations: its two ends (a point on the side of each block that faces the other) and the points between, a column apart
  const ends = new Map();
  const end = (id, side, plan, leaves, toward) => {
    const key = `${id}|${side}`;
    if (!ends.has(key)) ends.set(key, { blk: blocks.get(id), list: [] });
    ends.get(key).list.push({ plan, leaves, toward });
  };
  const plans = lines
    .filter((l) => l.from !== l.to && blocks.has(l.from) && blocks.has(l.to))
    .map((l) => {
      const a = blocks.get(l.from);
      const b = blocks.get(l.to);
      const ahead = col(b.cx) >= col(a.cx);
      const plan = { l, a, b, out: ahead ? 'right' : 'left', in: ahead ? 'left' : 'right', y0: a.cy, y1: b.cy };
      end(l.from, plan.out, plan, true, l.via.length ? l.via[0].y : b.cy);
      end(l.to, plan.in, plan, false, l.via.length ? l.via.at(-1).y : a.cy);
      return plan;
    });
  ends.forEach(({ blk, list }) => {
    list.sort((p, q) => p.toward - q.toward || (p.plan.l.id < q.plan.l.id ? -1 : 1));
    const ys = spread(
      list.map((e) => e.toward),
      blk.lo,
      blk.hi,
    );
    list.forEach((e, i) => {
      if (e.leaves) e.plan.y0 = ys[i];
      else e.plan.y1 = ys[i];
    });
  });

  // in each gap, the lines that turn there
  const gaps = columns.slice(1).map(() => []);
  plans.forEach((plan) => {
    plan.stations = [{ c: col(plan.a.cx), y: plan.y0 }, ...plan.l.via.map((p) => ({ c: col(p.x), y: Math.round(p.y) })), { c: col(plan.b.cx), y: plan.y1 }];
    plan.turns = [];
    plan.stations.slice(1).forEach((s, k) => {
      const p = plan.stations[k];
      if (Math.abs(p.y - s.y) < 1 || p.c === s.c) return;
      const g = Math.min(p.c, s.c);
      const seg = { a: p.c < s.c ? p.y : s.y, b: p.c < s.c ? s.y : p.y, plan, k };
      gaps[g].push(seg);
      plan.turns[k] = seg;
    });
  });

  // a gap with lanes in it made as wide as they need; every column after it moves right by as much
  const shiftOf = [0];
  gaps.forEach((segs, g) => {
    const need = segs.length ? 2 * MARGIN + (segs.length - 1) * LANE : 0;
    const has = columns[g + 1].left - columns[g].right;
    shiftOf.push(shiftOf[g] + Math.max(0, Math.ceil(need - has)));
  });
  gaps.forEach((segs, g) => {
    if (!segs.length) return;
    const left = columns[g].right + shiftOf[g];
    const right = columns[g + 1].left + shiftOf[g + 1];
    const step = segs.length > 1 ? Math.min(MOST, (right - left - 2 * MARGIN) / (segs.length - 1)) : 0;
    const first = (left + right) / 2 - (step * (segs.length - 1)) / 2;
    orderLanes(segs).forEach((i, n) => {
      segs[i].x = Math.round(first + n * step);
    });
  });

  const shift = new Map();
  blocks.forEach((b, id) => shift.set(id, shiftOf[col(b.cx)]));
  const routes = new Map();
  plans.forEach((plan) => {
    const { a, b, l } = plan;
    const ax = Math.round(a.cx + shift.get(l.from) + (plan.out === 'right' ? a.half : -a.half));
    const bx = Math.round(b.cx + shift.get(l.to) + (plan.in === 'right' ? b.half : -b.half));
    const points = [{ x: ax, y: plan.y0 }];
    plan.stations.slice(1).forEach((s, k) => {
      const turn = plan.turns[k];
      if (!turn) return;
      points.push({ x: turn.x, y: plan.stations[k].y }, { x: turn.x, y: s.y });
    });
    points.push({ x: bx, y: plan.y1 });
    const labelAt = l.label ? { x: Math.round(l.label.x + shiftOf[col(l.label.x)]), y: Math.round(l.label.y) } : null;
    routes.set(l.id, { points: straight(points), labelAt, out: plan.out, in: plan.in });
  });
  return { shift, routes };
}

// the same points without those that add nothing (one on top of another, or in line with the two either side of it)
function straight(pts) {
  const out = [];
  pts.forEach((p) => {
    const last = out.at(-1);
    if (last && last.x === p.x && last.y === p.y) return;
    const before = out.at(-2);
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  });
  return out;
}

// A line through points joined by straight runs, each corner rounded (never more than half a run, so two corners never meet).
export function roundedPath(pts, r = 8) {
  const p = straight(pts.map((q) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 })));
  if (!p.length) return '';
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i += 1) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, i === 1 ? l1 : l1 / 2, i === p.length - 2 ? l2 : l2 / 2);
    const at = (from, to, len) => `${Math.round((to.x + ((from.x - to.x) / len) * k) * 10) / 10} ${Math.round((to.y + ((from.y - to.y) / len) * k) * 10) / 10}`;
    d += ` L ${at(a, b, l1)} Q ${b.x} ${b.y} ${at(c, b, l2)}`;
  }
  const last = p.at(-1);
  return `${d} L ${last.x} ${last.y}`;
}
