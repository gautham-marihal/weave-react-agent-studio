// An original call and its replay, turn against turn: same words, tools, hand-overs and ending? A model's wording is
// never identical twice, so words count as the same when most of them match; what the agent DID (tools, hand-overs,
// the end) is compared exactly. Pure: no network, no DOM.
import { isObj, type CallFacts, type CallTurn, type ToolUse } from './replayFacts';

const tokens = (text: string) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** The share of words two texts have in common, 0 to 1. */
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  const count = new Map<string, number>();
  x.forEach((w) => count.set(w, (count.get(w) ?? 0) + 1));
  let shared = 0;
  y.forEach((w) => {
    const left = count.get(w) ?? 0;
    if (left > 0) {
      shared += 1;
      count.set(w, left - 1);
    }
  });
  return (2 * shared) / (x.length + y.length);
}
export const SAME_WORDS = 0.8;

const names = (tools: ToolUse[]) => tools.map((t) => t.tool).filter(Boolean);
/** What is in `after` and not in `before`, counting repeats. */
function added(before: string[], after: string[]): string[] {
  const have = new Map<string, number>();
  before.forEach((n) => have.set(n, (have.get(n) ?? 0) + 1));
  const out: string[] = [];
  after.forEach((n) => {
    const left = have.get(n) ?? 0;
    if (left > 0) have.set(n, left - 1);
    else out.push(n);
  });
  return out;
}
const handoffOf = (tools: ToolUse[]) => tools.map((t) => t.handoff).filter(Boolean).pop() ?? '';
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const quote = (text: string, max = 60) => `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`;

export interface TurnComparison {
  index: number;
  say: string;
  original: CallTurn;
  replay: CallTurn | null;
  /** False when the replay ended before this turn. */
  reached: boolean;
  wording: number;
  sameWords: boolean;
  toolsAdded: string[];
  toolsRemoved: string[];
  handoff: { was: string; now: string };
  changed: boolean;
}

export interface ReplayComparison {
  verdict: 'same' | 'different';
  turns: TurnComparison[];
  opening: { wording: number; sameWords: boolean; was: string[]; now: string[] };
  agent: { was: string; now: string; changed: boolean };
  state: { name: string; was: unknown; now: unknown }[];
  ended: { was: boolean; now: boolean; changed: boolean };
  /** What changed, in sentences. */
  lines: string[];
  /** How many turns changed. */
  changed: number;
  notReached: number;
}

export function compareReplay(original: CallFacts, replay: CallFacts): ReplayComparison {
  const lines: string[] = [];
  const turns: TurnComparison[] = original.turns.map((o, index) => {
    const r = replay.turns[index];
    if (!r)
      return { index, say: o.say, original: o, replay: null, reached: false, wording: 0, sameWords: false, toolsAdded: [], toolsRemoved: [], handoff: { was: handoffOf(o.tools), now: '' }, changed: false };
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
    if (handoff.was !== handoff.now) lines.push(`Turn ${index + 1}: ${handoff.now ? `hands over to “${handoff.now}”` : 'no longer hands over'}${handoff.was ? ` (was “${handoff.was}”)` : ''}.`);
    if (!sameWords && now) lines.push(`Turn ${index + 1}: the agent answers differently (${quote(now)}).`);
    if (!sameWords && !now) lines.push(`Turn ${index + 1}: the agent no longer says anything.`);
    return { index, say: o.say, original: o, replay: r, reached: true, wording, sameWords, toolsAdded, toolsRemoved, handoff, changed };
  });
  const notReached = turns.filter((t) => !t.reached).length;
  if (notReached) lines.push(`${notReached} of the caller’s turns ${notReached === 1 ? 'was' : 'were'} not reached: the agent ended the conversation first.`);

  const openingWording = similarity(original.opening.join(' '), replay.opening.join(' '));
  const opening = { wording: openingWording, sameWords: openingWording >= SAME_WORDS, was: original.opening, now: replay.opening };
  if (!opening.sameWords) lines.unshift(`The opening is different (${quote(opening.now.join(' '))}).`);

  const agent = { was: original.finalAgent, now: replay.finalAgent, changed: !!(original.finalAgent && replay.finalAgent) && original.finalAgent !== replay.finalAgent };
  if (agent.changed) lines.push(`The conversation ends with “${agent.now}” in charge, not “${agent.was}”.`);

  const before = isObj(original.finalState) ? original.finalState : {};
  const after = isObj(replay.finalState) ? replay.finalState : {};
  const state = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => !sameValue(before[k], after[k]))
    .map((k) => ({ name: k, was: before[k], now: after[k] }));
  if (state.length) lines.push(`Memory at the end differs: ${state.map((s) => `${s.name} is ${JSON.stringify(s.now ?? null)} (was ${JSON.stringify(s.was ?? null)})`).join('; ')}.`);

  const ended = { was: original.ended, now: replay.ended, changed: original.ended !== replay.ended };
  if (ended.changed) lines.push(replay.ended ? 'The agent now ends the conversation where the call did not end by itself.' : 'The agent no longer ends the conversation where the call ended.');

  return { verdict: lines.length ? 'different' : 'same', turns, opening, agent, state, ended, lines, changed: turns.filter((t) => t.changed).length, notReached };
}
