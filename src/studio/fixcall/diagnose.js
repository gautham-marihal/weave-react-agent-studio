// What went wrong in a call, read from its records in plain terms. Each finding says what, where (which turn), and
// shows the evidence (the words or the error), so a person can see for themselves that it is true. These are rules, not
// a model: they find what is plainly there (a tool that failed, a long wait, a caller who had to repeat themselves),
// and they never claim to know why. Pure: no network, no DOM.

import { similarity } from '../replay/compareReplay.js';

const list = (v) => (Array.isArray(v) ? v : []);
const wordsIn = (text) => (String(text || '').match(/\S+/g) || []).length;
const clip = (text, n = 90) => {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const SLOW_MS = 4000; // the caller waits this long or more for the first words of an answer
export const LONG_WORDS = 45; // a spoken answer longer than this is a lot to listen to
const REPEAT = 0.85; // how alike two lines are to count as the same

const REPEATING = /\b(i (already|just) (said|told|gave|answered)|i said|as i said|again|like i said|did you hear)\b/i;

// severity: 'high' (the call went badly), 'medium' (it was worse than it should be), 'low' (worth knowing)
// finding: { id, kind, turn (1-based, or 0 for the call as a whole), severity, title, evidence: [text], tool? }
export function diagnoseCall(facts, { call = null, config = null } = {}) {
  const findings = [];
  const turns = list(facts?.turns);
  const add = (finding) => findings.push({ evidence: [], turn: 0, tool: '', ...finding });
  const voice = isVoice(config, facts?.channelId);

  // tools that failed
  const failed = new Map();
  turns.forEach((t, i) =>
    t.tools.forEach((x) => {
      if (x.error && !failed.has(x.tool)) failed.set(x.tool, { turn: i + 1, error: x.error, count: 0 });
      if (x.error) failed.get(x.tool).count += 1;
    }),
  );
  failed.forEach((info, tool) =>
    add({
      id: `tool_failed:${tool}`,
      kind: 'tool_failed',
      turn: info.turn,
      severity: 'high',
      tool,
      title: `The tool “${tool}” failed${info.count > 1 ? ` (${info.count} times)` : ''}`,
      evidence: [clip(info.error)],
    }),
  );

  // the call stopped without an ending
  if (call?.status === 'unfinished')
    add({
      id: 'cut_off',
      kind: 'cut_off',
      turn: turns.length,
      severity: 'high',
      title: 'The call was cut off',
      evidence: [call.duration_s ? `It stopped after ${Math.round(call.duration_s)} s with no ending.` : 'The record stops with no ending.'],
    });

  // the caller spoke and the agent said nothing
  turns.forEach((t, i) => {
    if (t.say && t.said.length === 0 && !t.tools.some((x) => x.handoff))
      add({
        id: `no_answer:${i + 1}`,
        kind: 'no_answer',
        turn: i + 1,
        severity: 'high',
        title: `The agent said nothing at turn ${i + 1}`,
        evidence: [`The caller said: “${clip(t.say)}”`],
      });
  });

  // a long wait before the answer
  turns.forEach((t, i) => {
    if (typeof t.waitMs === 'number' && t.waitMs >= SLOW_MS)
      add({
        id: `slow_answer:${i + 1}`,
        kind: 'slow_answer',
        turn: i + 1,
        severity: t.waitMs >= 8000 ? 'high' : 'medium',
        title: `A ${(t.waitMs / 1000).toFixed(1)} s wait at turn ${i + 1}`,
        evidence: [`After “${clip(t.say)}” the caller waited ${(t.waitMs / 1000).toFixed(1)} s for the first words.`],
      });
  });

  // an answer too long to listen to
  if (voice) {
    turns.forEach((t, i) => {
      const spoken = t.said.join(' ');
      if (wordsIn(spoken) > LONG_WORDS)
        add({
          id: `long_reply:${i + 1}`,
          kind: 'long_reply',
          turn: i + 1,
          severity: 'medium',
          title: `A ${wordsIn(spoken)}-word answer at turn ${i + 1}`,
          evidence: [clip(spoken, 140)],
        });
    });
  }

  // the agent said the same thing again
  for (let i = 1; i < turns.length; i += 1) {
    const before = turns[i - 1].said.join(' ');
    const now = turns[i].said.join(' ');
    if (wordsIn(now) >= 4 && similarity(before, now) >= REPEAT)
      add({
        id: `repeated_answer:${i + 1}`,
        kind: 'repeated_answer',
        turn: i + 1,
        severity: 'medium',
        title: `The agent repeated itself at turn ${i + 1}`,
        evidence: [`Twice in a row: “${clip(now)}”`],
      });
  }

  // the caller had to say it again
  for (let i = 1; i < turns.length; i += 1) {
    const before = turns[i - 1].say;
    const now = turns[i].say;
    const sameWords = wordsIn(now) >= 3 && similarity(before, now) >= 0.8;
    if (sameWords || REPEATING.test(now))
      add({
        id: `caller_repeated:${i + 1}`,
        kind: 'caller_repeated',
        turn: i + 1,
        severity: 'medium',
        title: `The caller had to repeat themselves at turn ${i + 1}`,
        evidence: [`“${clip(now)}”`],
      });
  }

  // handed over
  turns.forEach((t, i) => {
    const hand = t.tools.find((x) => x.handoff);
    if (hand)
      add({
        id: `handed_over:${i + 1}`,
        kind: 'handed_over',
        turn: i + 1,
        severity: 'low',
        title: `Handed over to “${hand.handoff}” at turn ${i + 1}`,
        evidence: [`After “${clip(t.say)}”`],
      });
  });

  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.turn - b.turn);
}

function isVoice(config, channelId) {
  const channel = list(config?.channels).find((c) => c && c.id === channelId) || list(config?.channels).find((c) => c && c.enabled !== false);
  if (!channel) return true; // with no channel to go by, a spoken answer is the stricter reading
  return ['sip_voice', 'web_voice'].includes(channel.type) || list(channel.modalities?.output).includes('audio');
}

// One line for the top of the panel: how the call went.
export function headline(findings) {
  if (!findings.length) return 'Nothing obviously wrong was found in this call.';
  const high = findings.filter((f) => f.severity === 'high').length;
  return `${findings.length} thing${findings.length === 1 ? '' : 's'} found${high ? `, ${high} serious` : ''}.`;
}
