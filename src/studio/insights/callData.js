import { api } from '../../api/client.js';
import { readCall } from '../replay/callFacts.js';

// Reads calls for the alert check and the questions page, and only reads: the list of calls of each agent since a moment, and the records of the calls
// that need them, a few agents (and a few calls) at a time. One agent or one call that cannot be read is left out and reported; it never hides the rest.

const AT_A_TIME = 4;
const PAGE = 100;

async function inChunks(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  return out;
}

// { calls: [summary + bot], errors: [{ botId, message }], truncated }
export async function loadCalls(botIds, { sinceMs, maxPages = 3, signal } = {}) {
  const since = new Date(sinceMs).toISOString();
  let truncated = false;
  const listed = await inChunks(botIds, AT_A_TIME, async (id) => {
    const calls = [];
    let cursor;
    try {
      for (let page = 0; page < maxPages; page += 1) {
        const answer = await api.listCalls(id, { limit: PAGE, cursor, since }, { signal });
        calls.push(...(Array.isArray(answer?.calls) ? answer.calls : []));
        cursor = answer?.next;
        if (!cursor) break;
        if (page === maxPages - 1) truncated = true;
      }
      return { id, calls: calls.map((c) => ({ ...c, bot: c.bot || id })), error: null };
    } catch (e) {
      return { id, calls: calls.map((c) => ({ ...c, bot: c.bot || id })), error: e?.message || 'This agent’s calls could not be read.' };
    }
  });
  return {
    calls: listed.flatMap((l) => l.calls),
    errors: listed.filter((l) => l.error).map((l) => ({ botId: l.id, message: l.error })),
    truncated,
  };
}

// The facts of each call (see replay/callFacts.js), by 'bot/id'. `known` are facts already read: a finished call does not change, so it is not read again.
export async function loadFacts(calls, { known = {}, signal } = {}) {
  const facts = {};
  let failed = 0;
  await inChunks(calls, AT_A_TIME, async (c) => {
    const key = `${c.bot}/${c.id}`;
    if (known[key] && c.status !== 'in_progress') {
      facts[key] = known[key];
      return;
    }
    try {
      const page = await api.getCall(c.bot, c.id, { limit: 500 }, { signal });
      facts[key] = readCall(Array.isArray(page?.events) ? page.events : []);
    } catch {
      failed += 1;
    }
  });
  return { facts, failed };
}

// The records of a finished call (GET /calls/{id}), read once per page load and shared by the pages that time answers (Speed, Monitoring, Home): a
// finished call does not change.
const finished = new Map();
export async function readFinishedCall(c, { signal } = {}) {
  const key = `${c.bot}/${c.id}`;
  if (!finished.has(key)) finished.set(key, await api.getCall(c.bot, c.id, { limit: 500 }, { signal }));
  return finished.get(key);
}

export const newestFirst = (calls) => [...calls].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
