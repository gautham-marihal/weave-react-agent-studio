// Build › Subagents and hand-overs in plain words, for any agent: who answers first, what each subagent does, who
// passes callers to whom (inside this agent: a hand-over; to another agent of the workspace: a transfer to its number;
// to a person: Tools' "Pass to a person"), and the ways back to the first. Pure: no React, no DOM, so the tests run it.
//
// From the schema: agents.entry is "the agent that answers first"; agent.kind is router (a front door that only hands
// off), specialist (does one job) or standalone; a hand-over's description tells the model when, its announce is
// spoken while it happens, and carry_context is on unless switched off.

import { agentLabel, humanize } from '../../rowNames.js';
import { agentByNumber } from '../../../workflow/workflowModel.js';
import { DEFAULT_ROLE, transferOf } from '../../../workflow/workflowOps.js';
import { handoffGaps } from '../../../workflow/handoffRules.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.text === 'string' ? v.text : '');
const clip = (t, n = 70) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
export const together = (words, last = 'and') => (words.length > 1 ? `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}` : words[0] || '');

const agentsOf = (config) => list(config?.agents?.items).filter((a) => isObj(a) && typeof a.id === 'string');
export const firstOf = (config) => config?.agents?.entry || agentsOf(config)[0]?.id || '';
const nameOf = (config, id) => (id ? agentLabel(config, id) : '');
// the words a new subagent starts with ask to be replaced, so they count as none
const roleOf = (a) => {
  const role = typeof a.instructions === 'string' ? a.instructions : text(a.instructions?.role);
  return role.trim() === DEFAULT_ROLE ? '' : role;
};
const backToolOf = (config) => list(config?.tools).find((t) => isObj(t) && t.builtin === 'return_to_entry') || null;
const KINDS = { router: 'Passes callers on', specialist: 'Does one job', standalone: 'Answers on its own' };

// every agent: answers first or not, what it does, what it can use, and whether it needs a look
export function agentsIn(config) {
  const first = firstOf(config);
  const many = agentsOf(config).length > 1;
  const back = backToolOf(config);
  return agentsOf(config).map((a) => {
    const role = roleOf(a);
    const tools = list(a.tools).filter((id) => id !== back?.id).length;
    return {
      key: a.id,
      name: nameOf(config, a.id),
      first: a.id === first,
      kind: KINDS[a.kind] || (a.id === first ? 'Answers first' : 'Does one job'),
      does: role ? clip(role, 80) : '',
      tools,
      canGoBack: !!back && a.id !== first && list(a.tools).includes(back.id),
      state: many && !role.trim() ? { tone: 'bad', words: 'Needs a look', why: 'no instructions yet: say what this one does' } : null,
    };
  });
}

// every hand-over to a subagent, by the agent that makes it
export function handoversIn(config) {
  return agentsOf(config).flatMap((a, i) =>
    list(a.handoffs)
      .map((h, j) => ({ h, j }))
      .filter(({ h }) => isObj(h))
      .map(({ h, j }) => ({
        key: `${a.id}/${h.id || j}`,
        from: a.id,
        to: h.to || '',
        fromName: nameOf(config, a.id),
        toName: nameOf(config, h.to) || 'nobody yet',
        when: typeof h.description === 'string' ? h.description : '',
        says: text(h.announce),
        context: h.carry_context !== false,
        index: i,
        state:
          !h.to || !agentsOf(config).some((x) => x.id === h.to)
            ? { tone: 'bad', words: 'Needs a look', why: 'it passes callers to an agent that isn’t there' }
            : null,
      })),
  );
}

// every transfer tool: to another agent of the workspace (its number is that agent's), or to a person
export function transfersOut(config, workspace) {
  return list(config?.tools)
    .filter((t) => isObj(t) && t.builtin === 'transfer_or_callback')
    .map((t) => {
      const { transfer } = transferOf(config, t.id);
      const other = agentByNumber(transfer?.target, workspace);
      const from = agentsOf(config).find((a) => list(a.tools).includes(t.id));
      return {
        key: t.id,
        from: from?.id || '',
        fromName: from ? nameOf(config, from.id) : 'No agent yet',
        to: other ? 'agent' : 'person',
        toName: other ? other.name : 'A person',
        when: typeof t.description === 'string' ? t.description : '',
        hours: transfer?.schedule
          ? (isObj(config?.schedules?.[transfer.schedule]) && config.schedules[transfer.schedule].description) || humanize(transfer.schedule)
          : '',
      };
    })
    .filter((x) => x.from);
}

// the picture: the first agent, its subagents (up to `most`), who is beyond, and the lines between them
export function relayOf(config, workspace, { most = 6 } = {}) {
  const agents = agentsIn(config);
  const first = agents.find((a) => a.first) || null;
  const subs = agents.filter((a) => !a.first);
  const shown = subs.slice(0, most);
  const shownIds = shown.map((s) => s.key);
  const hands = handoversIn(config);
  const outs = transfersOut(config, workspace);
  const beyond = [...outs.filter((o) => o.to === 'agent'), ...outs.filter((o) => o.to === 'person').slice(0, 1)];
  return {
    first,
    subs: shown,
    more: subs.length - shown.length,
    // passes on: from the first or a shown subagent to a shown subagent
    lines: hands
      .filter((h) => (h.from === first?.key || shownIds.includes(h.from)) && shownIds.includes(h.to))
      .map((h) => ({ from: h.from === first?.key ? 'first' : `s${shownIds.indexOf(h.from)}`, to: `s${shownIds.indexOf(h.to)}`, key: h.key })),
    back: shown.filter((s) => s.canGoBack).map((s) => `s${shownIds.indexOf(s.key)}`),
    beyond: beyond.map((o, i) => ({
      ...o,
      node: `b${i}`,
      fromNode: o.from === first?.key ? 'first' : shownIds.includes(o.from) ? `s${shownIds.indexOf(o.from)}` : 'first',
    })),
  };
}

// the sentence's parts, and the line under the name
export function sentenceOf(config, workspace) {
  const agents = agentsIn(config);
  const first = agents.find((a) => a.first) || null;
  const subs = agents.filter((a) => !a.first);
  const outs = transfersOut(config, workspace);
  return {
    first,
    alone: subs.length === 0,
    subs: subs.length ? (subs.length === 1 ? subs[0].name : `${subs.length} subagents`) : '',
    back: subs.filter((s) => s.canGoBack).length,
    others: outs.filter((o) => o.to === 'agent'),
    person: outs.some((o) => o.to === 'person'),
  };
}
export function summaryLine(config, workspace) {
  const agents = agentsIn(config);
  if (agents.length <= 1) return 'One agent: it answers every call itself';
  const hands = handoversIn(config).length + transfersOut(config, workspace).length;
  const back = agents.filter((a) => a.canGoBack).length;
  const bad = agents.filter((a) => a.state).length + handoversIn(config).filter((h) => h.state).length;
  return [
    `${agents.length} agents`,
    `${hands} ${hands === 1 ? 'hand-over' : 'hand-overs'}`,
    back ? `${back} ${back === 1 ? 'way' : 'ways'} back` : '',
    bad ? `${bad} ${bad === 1 ? 'needs' : 'need'} a look` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

// the agents missing the studio's hand-over rules (without them, callers can get stuck with the wrong one)
export const rulesMissing = (config) => handoffGaps(config).length;
