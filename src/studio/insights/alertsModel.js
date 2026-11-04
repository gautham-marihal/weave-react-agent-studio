// Alerts: what is going wrong with an agent now, from its recent calls against its usual (failing tools, spikes in
// cut-off or passed-on calls, no calls, slow answers, errors, a worse new version). Thresholds are editable; a spike
// needs enough calls. Pure: no network, no DOM, no clock of its own (the caller passes `nowMs`).

import { analyse, percentile, waitsOf } from '../monitoring/monitorModel.js';

const list = (v) => (Array.isArray(v) ? v : []);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BASELINE_DAYS = 7;

// The rules, in words, with the numbers in them a person can change. `sentence` is drawn with the numbers as boxes.
export const RULES = [
  {
    id: 'tool_failing',
    label: 'A tool keeps failing',
    severity: 'critical',
    params: { count: 3, minutes: 30 },
    fields: { count: { min: 1, max: 100, unit: 'calls' }, minutes: { min: 5, max: 1440, unit: 'minutes' } },
    sentence: 'Warn when a tool fails on {count} or more calls within {minutes}.',
    why: 'An API the agent relies on is down or refusing it, so callers hear “sorry, I can’t check that”.',
  },
  {
    id: 'cut_off',
    label: 'Calls are being cut off',
    severity: 'critical',
    params: { percent: 25, minutes: 60, minCalls: 4 },
    fields: { percent: { min: 1, max: 100, unit: '%' }, minutes: { min: 10, max: 1440, unit: 'minutes' }, minCalls: { min: 1, max: 100, unit: 'calls' } },
    sentence: 'Warn when {percent} or more of calls are cut off within {minutes}, over at least {minCalls}, and that is twice the usual or more.',
    why: 'Calls that stop without an ending usually mean the agent crashed, hung or lost the line.',
  },
  {
    id: 'handoff',
    label: 'Many calls passed to a person',
    severity: 'warning',
    params: { percent: 40, minutes: 60, minCalls: 4 },
    fields: { percent: { min: 1, max: 100, unit: '%' }, minutes: { min: 10, max: 1440, unit: 'minutes' }, minCalls: { min: 1, max: 100, unit: 'calls' } },
    sentence: 'Warn when {percent} or more of calls are passed to a person within {minutes}, over at least {minCalls}, and that is twice the usual or more.',
    why: 'Something the agent used to handle is now going to your team: a change, a broken tool, or a new kind of question.',
  },
  {
    id: 'no_calls',
    label: 'No calls coming in',
    severity: 'warning',
    params: { hours: 3, usual: 3 },
    fields: { hours: { min: 1, max: 72, unit: 'hours' }, usual: { min: 1, max: 1000, unit: 'calls' } },
    sentence: 'Warn when an agent has had no calls for {hours} while it usually gets {usual} or more in that time.',
    why: 'A phone number, a widget or a dispatch rule may have stopped sending callers to the agent.',
  },
  {
    id: 'slow',
    label: 'The agent is slow to answer',
    severity: 'warning',
    params: { seconds: 8, minutes: 60, minTurns: 3 },
    fields: {
      seconds: { min: 1, max: 120, unit: 'seconds' },
      minutes: { min: 10, max: 1440, unit: 'minutes' },
      minTurns: { min: 1, max: 100, unit: 'answers' },
    },
    sentence: 'Warn when one answer in ten takes longer than {seconds} within {minutes}, over at least {minTurns}.',
    why: 'Callers wait in silence and hang up: a slow model, a slow tool or an overloaded server.',
  },
  {
    id: 'errors',
    label: 'Errors in calls',
    severity: 'critical',
    params: { count: 3, minutes: 30 },
    fields: { count: { min: 1, max: 100, unit: 'calls' }, minutes: { min: 5, max: 1440, unit: 'minutes' } },
    sentence: 'Warn when {count} or more calls record an error within {minutes}.',
    why: 'The runtime recorded errors it could not recover from.',
  },
  {
    id: 'version_worse',
    label: 'A new version does worse',
    severity: 'warning',
    params: {},
    fields: {},
    sentence: 'Warn when the newest version of an agent cuts off, passes on or fails tools clearly more often than the version before it.',
    why: 'A change made the agent worse. Rolling back is one click away.',
  },
];
const RULE = Object.fromEntries(RULES.map((r) => [r.id, r]));
const SEVERITY_RANK = { critical: 2, warning: 1 };

// The rules with a person's changes laid over the defaults: { id: { enabled, params } }
export function effectiveRules(overrides = {}) {
  return RULES.map((r) => {
    const o = overrides?.[r.id] || {};
    const params = { ...r.params };
    Object.entries(o.params || {}).forEach(([k, v]) => {
      const f = r.fields[k];
      if (f && typeof v === 'number' && Number.isFinite(v)) params[k] = Math.min(f.max, Math.max(f.min, Math.round(v)));
    });
    return { ...r, enabled: o.enabled !== false, params };
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// "the last {window}": "hour", "2 hours", "30 minutes"
const minutesText = (m) => (m === 60 ? 'hour' : m % 60 === 0 && m >= 60 ? plural(m / 60, 'hour') : plural(m, 'minute'));
const pct = (x) => `${Math.round(x * 100)}%`;
const at = (c) => Date.parse(c.started_at);
const keyOf = (c) => `${c.bot}/${c.id}`;

// The alerts that hold now, most serious first: [{ key, rule, severity, bot, botName, title, detail, why, count, since,
// callIds, subject, action }].
//   calls: every agent's call summaries (bot, id, started_at, status, handoffs, version), covering baseline and windows
//   facts: { 'bot/id': facts } for the recent calls (failed tools, errors and answer times need them)
//   bots: [{ id, name }]
export function evaluateAlerts({ calls = [], facts = {}, bots = [], nowMs = 0, rules = effectiveRules() } = {}) {
  const enabled = Object.fromEntries(rules.filter((r) => r.enabled).map((r) => [r.id, r]));
  const names = Object.fromEntries(list(bots).map((b) => [b.id, b.name || b.id]));
  const botIds = [...new Set([...list(bots).map((b) => b.id), ...list(calls).map((c) => c.bot)])];
  const out = [];
  const push = (rule, bot, subject, fields) =>
    out.push({
      key: `${rule}|${bot}|${subject || ''}`,
      rule,
      severity: RULE[rule].severity,
      bot,
      botName: names[bot] || bot,
      subject: subject || '',
      why: RULE[rule].why,
      ...fields,
    });

  botIds.forEach((bot) => {
    const mine = list(calls).filter((c) => c.bot === bot && c.status !== 'in_progress' && !Number.isNaN(at(c)));
    const within = (minutes) => mine.filter((c) => at(c) > nowMs - minutes * MIN && at(c) <= nowMs);
    const before = (minutes) => mine.filter((c) => at(c) <= nowMs - minutes * MIN && at(c) > nowMs - minutes * MIN - BASELINE_DAYS * DAY);
    const oldest = (cs) => (cs.length ? new Date(Math.min(...cs.map(at))).toISOString() : null);

    // a tool that keeps failing: per tool, the calls in which it failed
    if (enabled.tool_failing) {
      const { count, minutes } = enabled.tool_failing.params;
      const byTool = new Map();
      within(minutes).forEach((c) => {
        const f = facts[keyOf(c)];
        const failed = list(f?.turns).flatMap((t) => list(t.tools).filter((x) => x.error));
        new Set(failed.map((x) => x.tool)).forEach((tool) => {
          const row = byTool.get(tool) || { calls: [], errors: new Map() };
          row.calls.push(c);
          failed.filter((x) => x.tool === tool).forEach((x) => row.errors.set(x.error, (row.errors.get(x.error) || 0) + 1));
          byTool.set(tool, row);
        });
      });
      byTool.forEach((row, tool) => {
        if (row.calls.length < count) return;
        const error = [...row.errors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        push('tool_failing', bot, tool, {
          title: `“${tool}” is failing`,
          detail: `It failed on ${plural(row.calls.length, 'call')} in the last ${minutesText(minutes)}${error ? ` (${error})` : ''}.`,
          count: row.calls.length,
          since: oldest(row.calls),
          callIds: row.calls.map((c) => c.id),
          action: { kind: 'tool', tool },
        });
      });
    }

    // a spike in a share of calls, over enough calls, and well above the agent's own usual
    const spike = (rule, isBad, noun) => {
      const r = enabled[rule];
      if (!r) return;
      const { percent, minutes, minCalls } = r.params;
      const now = within(minutes);
      if (now.length < minCalls) return;
      const bad = now.filter(isBad);
      const share = bad.length / now.length;
      if (share * 100 < percent) return;
      const usualCalls = before(minutes);
      const usual = usualCalls.length ? usualCalls.filter(isBad).length / usualCalls.length : 0;
      // twice the usual (an agent that always passes half its calls on is fine), unless there's too little history
      if (usualCalls.length >= 10 && share < usual * 2) return;
      push(rule, bot, '', {
        title: `${pct(share)} of calls ${noun}`,
        detail: `${bad.length} of ${plural(now.length, 'call')} in the last ${minutesText(minutes)}${usualCalls.length >= 10 ? `; usually ${pct(usual)}` : ''}.`,
        count: bad.length,
        since: oldest(bad),
        callIds: bad.map((c) => c.id),
        action: { kind: 'calls', status: rule === 'cut_off' ? 'unfinished' : '' },
      });
    };
    spike('cut_off', (c) => c.status === 'unfinished', 'were cut off');
    spike('handoff', (c) => (c.handoffs || 0) > 0, 'were passed to a person');

    // nothing arriving where something usually does
    if (enabled.no_calls) {
      const { hours, usual } = enabled.no_calls.params;
      const recent = mine.filter((c) => at(c) > nowMs - hours * HOUR);
      const history = mine.filter((c) => at(c) <= nowMs - hours * HOUR && at(c) > nowMs - BASELINE_DAYS * DAY);
      const expected = history.length / ((BASELINE_DAYS * DAY - hours * HOUR) / (hours * HOUR));
      if (!recent.length && expected >= usual) {
        const last = history.length ? new Date(Math.max(...history.map(at))).toISOString() : null;
        push('no_calls', bot, '', {
          title: 'No calls coming in',
          detail: `No calls in the last ${minutesText(hours * 60)}; it usually gets about ${Math.round(expected)} in that time.`,
          count: 0,
          since: last,
          callIds: [],
          action: { kind: 'channels' },
        });
      }
    }

    // slow answers: the slowest tenth
    if (enabled.slow) {
      const { seconds, minutes, minTurns } = enabled.slow.params;
      const recent = within(minutes);
      const waits = recent.flatMap((c) => waitsOf(facts[keyOf(c)]).map((w) => ({ ms: w.ms, call: c })));
      const p90 = percentile(
        waits.map((w) => w.ms),
        90,
      );
      if (waits.length >= minTurns && p90 > seconds * 1000) {
        const slowCalls = [...new Map(waits.filter((w) => w.ms > seconds * 1000).map((w) => [w.call.id, w.call])).values()];
        push('slow', bot, '', {
          title: 'Answers are slow',
          detail: `One answer in ten took ${(p90 / 1000).toFixed(1)} s or more in the last ${minutesText(minutes)} (over ${plural(waits.length, 'answer')}).`,
          count: slowCalls.length,
          since: oldest(slowCalls),
          callIds: slowCalls.map((c) => c.id),
          action: { kind: 'calls', status: '' },
        });
      }
    }

    // errors the runtime recorded (a failed tool is its own rule)
    if (enabled.errors) {
      const { count, minutes } = enabled.errors.params;
      const withErrors = within(minutes).filter((c) => list(facts[keyOf(c)]?.errors).some((e) => !/^The tool “/.test(e)));
      if (withErrors.length >= count) {
        const first = list(facts[keyOf(withErrors[0])]?.errors).find((e) => !/^The tool “/.test(e)) || '';
        push('errors', bot, '', {
          title: 'Errors in calls',
          detail: `${plural(withErrors.length, 'call')} recorded an error in the last ${minutesText(minutes)}${first ? `, for example: ${first}` : ''}.`,
          count: withErrors.length,
          since: oldest(withErrors),
          callIds: withErrors.map((c) => c.id),
          action: { kind: 'calls', status: '' },
        });
      }
    }
  });

  // a version doing worse than the one before it (Monitoring's own comparison, over the baseline)
  if (enabled.version_worse) {
    analyse({ calls, samples: facts, bots, nowMs, days: BASELINE_DAYS }).alerts.forEach((a) =>
      push('version_worse', a.bot, a.version, {
        title: `v${a.version} is doing worse than v${a.previousVersion}`,
        detail: `${a.details.join('; ')} (over ${plural(a.calls, 'call')} and ${plural(a.previousCalls, 'call')}).`,
        count: a.calls,
        since: null,
        callIds: [],
        action: { kind: 'rollback', version: a.previousVersion },
      }),
    );
  }

  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || Date.parse(b.since || 0) - Date.parse(a.since || 0));
}

// How far back an evaluation needs calls (the baseline and the longest window), and how far back their records.
export function lookback(rules = effectiveRules()) {
  const windows = rules.filter((r) => r.enabled).map((r) => (r.params.minutes ? r.params.minutes * MIN : r.params.hours ? r.params.hours * HOUR : 0));
  const longest = Math.max(HOUR, ...windows);
  return { callsMs: BASELINE_DAYS * DAY + longest, recordsMs: longest };
}

// ---- what a person did about alerts, and what happened to them (kept in this browser)

const HISTORY_DAYS = 30;
const HISTORY_MAX = 200;

// Updates the record with the alerts that hold now: new ones are logged as fired, gone ones as cleared (and their
// acknowledgement forgotten, so a return counts as new), and expired snoozes end. Returns { state, fired: [new ones] }.
//   checked: the agent ids this check looked at, when not all; other agents' alerts (another workspace's) stay as is
export function reconcile(state, alerts, nowMs, checked = null) {
  // an open alert is kept however old (dropped, it would fire again as new); a cleared one is kept for HISTORY_DAYS
  const history = list(state?.history).filter((h) => !h.clearedAt || Date.parse(h.firedAt) > nowMs - HISTORY_DAYS * DAY);
  const acks = { ...(state?.acks || {}) };
  const active = new Map(list(alerts).map((a) => [a.key, a]));
  const open = new Map(history.filter((h) => !h.clearedAt).map((h) => [h.key, h]));
  const fired = [];
  const nextHistory = history.map((h) => {
    if (h.clearedAt || active.has(h.key) || (checked && !checked.has(h.bot))) {
      const now = active.get(h.key);
      return now && !h.clearedAt ? { ...h, title: now.title, detail: now.detail, count: now.count } : h;
    }
    delete acks[h.key];
    return { ...h, clearedAt: new Date(nowMs).toISOString() };
  });
  active.forEach((a) => {
    if (open.has(a.key)) return;
    fired.push(a);
    nextHistory.unshift({
      key: a.key,
      rule: a.rule,
      severity: a.severity,
      bot: a.bot,
      botName: a.botName,
      title: a.title,
      detail: a.detail,
      count: a.count,
      firedAt: new Date(nowMs).toISOString(),
      clearedAt: null,
    });
  });
  Object.entries(acks).forEach(([key, ack]) => {
    if (ack?.until && Date.parse(ack.until) <= nowMs) delete acks[key];
  });
  // at most HISTORY_MAX: every open alert, then the newest of those that cleared
  const room = Math.max(0, HISTORY_MAX - nextHistory.filter((h) => !h.clearedAt).length);
  let cleared = 0;
  const kept = nextHistory.filter((h) => !h.clearedAt || (cleared += 1) <= room);
  return { state: { ...state, history: kept, acks }, fired };
}

// Each alert with what the person did about it: 'new', 'seen' (acknowledged) or 'snoozed' (until a time).
export function withStatus(alerts, acks = {}, nowMs = 0) {
  return list(alerts).map((a) => {
    const ack = acks[a.key];
    if (ack?.until && Date.parse(ack.until) > nowMs) return { ...a, status: 'snoozed', until: ack.until };
    if (ack?.at && !ack.until) return { ...a, status: 'seen', seenAt: ack.at, seenBy: ack.by || '' };
    return { ...a, status: 'new' };
  });
}

// The alert as a few lines of text, to paste into a chat or an email.
export function alertAsText(alert, link = '') {
  return [`[${alert.severity === 'critical' ? 'Critical' : 'Warning'}] ${alert.botName}: ${alert.title}`, alert.detail, link].filter(Boolean).join('\n');
}
