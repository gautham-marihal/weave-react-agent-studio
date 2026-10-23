import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { metaOfConfig } from '../agentList.js';
import { healthFrom, healthKey } from './health.js';

// Reads, for the agents it is given, what the Agents list shows beyond the list itself: their tags and owner (from the draft) and how they
// are doing (validity, what will run, test results, knowledge indexes). That is up to four requests per agent (all reads; the validator
// only checks), so it asks a few at a time, only for the agents on the page being looked at (or, on request, for all), and remembers the
// answer until the agent's draft is saved again. Nothing here changes anything.
const AT_A_TIME = 3;
const cache = new Map(); // `${id}@${revision}` -> { tags, owner, health }
const lastById = new Map(); // id -> the latest answer for it, shown while a newer one is being read
const inflight = new Set();

async function read(bot) {
  const draft = await api.getDraft(bot.id);
  const config = draft.config;
  const report = await api.validate(config).catch(() => null);
  const tests = Array.isArray(config?.tests) && config.tests.length ? await api.listTests(bot.id, { ref: 'draft' }).catch(() => null) : null;
  const knowledge = Array.isArray(config?.knowledge) && config.knowledge.length ? await api.getKnowledge(bot.id, { ref: 'draft' }).catch(() => null) : null;
  // the draft and its check are kept too: Home works out the agent's steps to get ready from them (readiness.js)
  return { ...metaOfConfig(config), health: healthFrom({ config, report, tests, knowledge }), config, report };
}

export function useAgentHealth(visibleBots, { enabled = true } = {}) {
  const [, setTick] = useState(0);
  const queue = useRef([]);
  const running = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const pump = useCallback(() => {
    while (running.current < AT_A_TIME && queue.current.length) {
      const bot = queue.current.shift();
      const key = healthKey(bot);
      running.current += 1;
      read(bot)
        .then(
          (answer) => {
            cache.set(key, answer);
            lastById.set(bot.id, answer);
          },
          () => {
            cache.set(key, { tags: [], owner: '', health: { state: 'unknown', parts: [], checked: [] }, failed: true });
          },
        )
        .finally(() => {
          inflight.delete(key);
          running.current -= 1;
          if (alive.current) setTick((n) => n + 1);
          pump();
        });
    }
  }, []);

  const request = useCallback(
    (bots) => {
      bots.forEach((bot) => {
        const key = healthKey(bot);
        if (cache.has(key) || inflight.has(key)) return;
        inflight.add(key);
        queue.current.push(bot);
      });
      pump();
    },
    [pump],
  );

  const key = (visibleBots || []).map(healthKey).join('|');
  useEffect(() => {
    if (enabled && visibleBots?.length) request(visibleBots);
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = {};
  (visibleBots || []).forEach((bot) => {
    const answer = cache.get(healthKey(bot)) || lastById.get(bot.id);
    if (answer) meta[bot.id] = answer;
  });
  return { meta, request, pending: inflight.size };
}

// every agent known so far, not only the ones on the page (for the tag and owner filters)
export function knownMeta(bots) {
  const meta = {};
  (bots || []).forEach((bot) => {
    const answer = cache.get(healthKey(bot)) || lastById.get(bot.id);
    if (answer) meta[bot.id] = answer;
  });
  return meta;
}

export function forgetHealth() {
  cache.clear();
  lastById.clear();
  inflight.clear();
}
