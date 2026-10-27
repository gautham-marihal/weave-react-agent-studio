import { useSyncExternalStore } from 'react';

// What a person decided about alerts and unanswered questions, kept in this browser: rule thresholds, acknowledged or
// snoozed alerts, history, where alerts go, answered or dismissed questions; plus the latest alert check (not kept).
// Every reader, and other tabs, see a change at once; with storage blocked it still works until the page closes.

const KEY = 'weave_insights_v1';
const EMPTY = { rules: {}, acks: {}, history: [], notify: { browser: false, email: '', slack: '' }, questions: {} };
const listeners = new Set();
let saved = null;
let live = { alerts: [], checkedAt: null, checking: false, errors: [], watching: 0 };

function read() {
  if (saved) return saved;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    saved = raw && typeof raw === 'object' ? { ...EMPTY, ...raw, notify: { ...EMPTY.notify, ...(raw.notify || {}) } } : { ...EMPTY };
  } catch {
    saved = { ...EMPTY };
  }
  return saved;
}
const emit = () => listeners.forEach((l) => l());

export function getInsights() {
  return read();
}
// next: an object, or a function of the current state
export function setInsights(next) {
  saved = typeof next === 'function' ? next(read()) : next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable: kept for this page only */
  }
  emit();
}
export const getLive = () => live;
export function setLive(patch) {
  live = { ...live, ...patch };
  emit();
}

const subscribe = (listener) => {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key === KEY) {
      saved = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};
export const useInsights = () => useSyncExternalStore(subscribe, read, () => EMPTY);
export const useLiveAlerts = () => useSyncExternalStore(subscribe, getLive, () => live);

// ---- small edits

export const setRule = (id, patch) =>
  setInsights((s) => ({
    ...s,
    rules: { ...s.rules, [id]: { ...(s.rules[id] || {}), ...patch, params: { ...(s.rules[id]?.params || {}), ...(patch.params || {}) } } },
  }));
export const resetRules = () => setInsights((s) => ({ ...s, rules: {} }));
export const acknowledge = (key, by = '') => setInsights((s) => ({ ...s, acks: { ...s.acks, [key]: { at: new Date().toISOString(), by } } }));
export const snooze = (key, until) => setInsights((s) => ({ ...s, acks: { ...s.acks, [key]: { until } } }));
export const reopen = (key) =>
  setInsights((s) => {
    const acks = { ...s.acks };
    delete acks[key];
    return { ...s, acks };
  });
export const setNotify = (patch) => setInsights((s) => ({ ...s, notify: { ...s.notify, ...patch } }));
export const clearHistory = () => setInsights((s) => ({ ...s, history: s.history.filter((h) => !h.clearedAt) }));

// A decision about an agent's question: { words, text, kind: 'answered' | 'dismissed', reason?, answer?, at, agentId? }
export const questionDecisions = (state, botId) => (Array.isArray(state?.questions?.[botId]) ? state.questions[botId] : []);
export function decideQuestion(botId, decision) {
  setInsights((s) => {
    const mine = questionDecisions(s, botId).filter((d) => d.text !== decision.text);
    return { ...s, questions: { ...s.questions, [botId]: [{ ...decision, at: decision.at || new Date().toISOString() }, ...mine].slice(0, 300) } };
  });
}
export function undoQuestion(botId, text) {
  setInsights((s) => ({ ...s, questions: { ...s.questions, [botId]: questionDecisions(s, botId).filter((d) => d.text !== text) } }));
}
