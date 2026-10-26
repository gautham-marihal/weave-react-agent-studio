// An original call and a replay of it, turn against turn: did the agent say the same thing, use the same tools, hand
// over to the same agent, end the same way? The wording of a language model is never identical twice, so "the same" for
// words means "close enough that nothing changed in meaning a person would care about": most of the same words. What
// matters more, and is compared exactly, is what the agent DID: its tools, its hand-overs, its end.
// Pure: no network, no DOM.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const tokens = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
// the share of words the two texts have in common, 0 to 1
export function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  const count = new Map();
  x.forEach((w) => count.set(w, (count.get(w) || 0) + 1));
  let shared = 0;
  y.forEach((w) => {
    if (count.get(w) > 0) {
      shared += 1;
      count.set(w, count.get(w) - 1);
    }
  });
  return (2 * shared) / (x.length + y.length);
}
export const SAME_WORDS = 0.8;

const names = (tools) =>
  list(tools)
    .map((t) => t.tool)
    .filter(Boolean);
// what is in `after` and not in `before`, counting repeats
function added(before, after) {
  const have = new Map();
  before.forEach((n) => have.set(n, (have.get(n) || 0) + 1));
  const out = [];
  after.forEach((n) => {
    if (have.get(n) > 0) have.set(n, have.get(n) - 1);
    else out.push(n);
  });
  return out;
}
const handoffOf = (tools) =>
  list(tools)
    .map((t) => t.handoff)
    .filter(Boolean)
    .pop() || '';
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const quote = (text, max = 60) => `“${String(text).length > max ? `${String(text).slice(0, max - 1)}…` : text}”`;

// → { verdict: 'same' | 'different', turns: [...], opening, agent, state, ended, lines: [plain sentences], changed: n, notReached }
export function compareReplay(original, replay) {
  const lines = [];
  const turns = list(original?.turns).map((o, index) => {
    const r = list(replay?.turns)[index];
    if (!r)
      return {
        index,
        say: o.say,
        original: o,
        replay: null,
        reached: false,
        wording: 0,
        sameWords: false,
        toolsAdded: [],
        toolsRemoved: [],
        handoff: { was: handoffOf(o.tools), now: '' },
        changed: false,
      };
    const was = o.said.join(' ');
    const now = r.said.join(' ');
    const wording = similarity(was, now);
    const toolsAdded = added(names(o.tools), names(r.tools));
    const toolsRemoved = added(names(r.tools), names(o.tools));
    const handoff = { was: handoffOf(o.tools), now: handoffOf(r.tools) };
    const sameWords = wording >= SAME_WORDS;
    const changed = !sameWords || toolsAdded.length > 0 || toolsRemoved.length > 0 || handoff.was !== handoff.now;
    if (toolsRemoved.length) lines.push(`Turn ${index + 1}: no longer calls ${toolsRemoved.map((n) => `“${n}”`).join(', ')}.`);
    if (toolsAdded.length) lines.push(`Turn ${index + 1}: now also calls ${toolsAdded.map((n) => `“${n}”`).join(', ')}.`);
    if (handoff.was !== handoff.now)
      lines.push(
        `Turn ${index + 1}: ${handoff.now ? `hands over to “${handoff.now}”` : 'no longer hands over'}${handoff.was ? ` (was “${handoff.was}”)` : ''}.`,
      );
    if (!sameWords && now) lines.push(`Turn ${index + 1}: the agent answers differently (${quote(now)}).`);
    if (!sameWords && !now) lines.push(`Turn ${index + 1}: the agent no longer says anything.`);
    return { index, say: o.say, original: o, replay: r, reached: true, wording, sameWords, toolsAdded, toolsRemoved, handoff, changed };
  });
  const notReached = turns.filter((t) => !t.reached).length;
  if (notReached) lines.push(`${notReached} of the caller’s turns ${notReached === 1 ? 'was' : 'were'} not reached: the agent ended the conversation first.`);

  const openingWording = similarity(list(original?.opening).join(' '), list(replay?.opening).join(' '));
  const opening = { wording: openingWording, sameWords: openingWording >= SAME_WORDS, was: list(original?.opening), now: list(replay?.opening) };
  if (!opening.sameWords) lines.unshift(`The opening is different (${quote(opening.now.join(' '))}).`);

  const agent = {
    was: original?.finalAgent || '',
    now: replay?.finalAgent || '',
    changed: !!(original?.finalAgent && replay?.finalAgent) && original.finalAgent !== replay.finalAgent,
  };
  if (agent.changed) lines.push(`The conversation ends with “${agent.now}” in charge, not “${agent.was}”.`);

  const keys = [
    ...new Set([...Object.keys(isObj(original?.finalState) ? original.finalState : {}), ...Object.keys(isObj(replay?.finalState) ? replay.finalState : {})]),
  ];
  const state = keys
    .filter((k) => !sameValue(original?.finalState?.[k], replay?.finalState?.[k]))
    .map((k) => ({ name: k, was: original?.finalState?.[k], now: replay?.finalState?.[k] }));
  if (state.length)
    lines.push(
      `Memory at the end differs: ${state.map((s) => `${s.name} is ${JSON.stringify(s.now ?? null)} (was ${JSON.stringify(s.was ?? null)})`).join('; ')}.`,
    );

  const ended = { was: !!original?.ended, now: !!replay?.ended, changed: !!original?.ended !== !!replay?.ended };
  if (ended.changed)
    lines.push(
      replay?.ended ? 'The agent now hangs up where the call did not end by itself.' : 'The agent no longer ends the conversation where the call ended.',
    );

  const changed = turns.filter((t) => t.changed).length;
  const different = lines.length > 0;
  return { verdict: different ? 'different' : 'same', turns, opening, agent, state, ended, lines, changed, notReached };
}
