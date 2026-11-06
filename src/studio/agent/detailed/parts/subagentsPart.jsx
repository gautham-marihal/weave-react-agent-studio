import React, { useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Select from '../../../../ui/Select.tsx';
import { Input } from '../../../../ui/Input.tsx';
import Button from '../../../../ui/Button.tsx';
import { Switch } from '../../../form/fields.jsx';
import { useProviders } from '../../../models/useProviders.js';
import { useWorkspaceAgents } from '../../../workflow/useWorkspaceAgents.js';
import { agentByNumber } from '../../../workflow/workflowModel.js';
import {
  addAgentTransfer,
  addBackToStart,
  addSubagent,
  setEntry,
  setTransferAgent,
  setTransferDelay,
  setTransferSay,
  transferOf,
} from '../../../workflow/workflowOps.js';
import {
  llmChoice,
  llmOptions,
  setLlm,
  voiceChoice,
  voiceOptions,
  setVoice,
  interruptChoice,
  setInterrupt,
  defaultLlm,
  defaultVoice,
} from '../../../workflow/agentOverrides.js';
import { whoTakesOver } from '../../../../demo/simulatedAgent.js';
import { agentLabel, humanize } from '../../rowNames.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { DetailedPage, removeEntry } from '../Detailed.jsx';
import { clip } from '../describe.js';

// 8 · Subagents and hand-overs: who answers, what each subagent does, and who passes callers to whom: the same
// settings the Workflow canvas draws, as a form (one draft: a change here shows on the canvas and the other way round).
// A hand-over to a subagent is an agent's `handoffs`; a hand-over to another agent of the workspace is a transfer tool
// whose transfer dials that agent's number; "back to the first agent" is the return_to_entry tool.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const agentsOf = (config) => list(config?.agents?.items).filter(isObj);
const indexOfAgent = (config, id) => list(config?.agents?.items).findIndex((a) => isObj(a) && a.id === id);
const nameOf = (config, id) => (id ? agentLabel(config, id) : '');
const firstId = (config) => config?.agents?.entry || agentsOf(config)[0]?.id || '';

// A subagent's row: whether it answers first, what it can use, who it passes to, and its job in a line
function describeSubagent(entry, c) {
  const a = isObj(entry.item) ? entry.item : {};
  const tools = Array.isArray(a.tools) ? a.tools.length : 0;
  const passes = Array.isArray(a.handoffs)
    ? a.handoffs
        .filter(isObj)
        .map((h) => nameOf(c.config, h.to))
        .filter(Boolean)
    : [];
  const role = typeof a.instructions === 'string' ? a.instructions : a.instructions?.role || '';
  const first = a.id && a.id === firstId(c.config);
  return {
    icon: first ? 'agent' : 'subagent',
    meta: [
      first ? 'Answers first' : 'Takes over when asked',
      tools ? `${tools} ${tools === 1 ? 'tool' : 'tools'}` : 'no tools',
      passes.length ? `passes to ${passes.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    detail: role ? clip(role, 150) : 'No instructions yet: say what this one does.',
    state: role ? null : { tone: 'bad', words: 'Needs instructions' },
  };
}

// every hand-over to a subagent, across the agents
const handoffEntries = (config) =>
  agentsOf(config).flatMap((a) =>
    list(a.handoffs)
      .map((h, j) => ({ h, j }))
      .filter(({ h }) => isObj(h))
      .map(({ h, j }) => ({
        key: `${a.id}/${h.id || j}`,
        name: `${nameOf(config, a.id)} → ${nameOf(config, h.to)}`,
        base: ['agents', 'items', indexOfAgent(config, a.id), 'handoffs', j],
        item: h,
        from: a.id,
      })),
  );
// every transfer tool that dials another agent of the workspace, by the agent that offers it
const agentTransferEntries = (config, extra) =>
  list(config?.tools)
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isObj(t) && t.builtin === 'transfer_or_callback')
    .map(({ t, i }) => ({ t, i, other: agentByNumber(transferOf(config, t.id).transfer?.target, extra.workspace) }))
    .filter(({ other }) => other)
    .map(({ t, i, other }) => {
      const from = agentsOf(config).find((a) => list(a.tools).includes(t.id));
      return { key: t.id, name: `${from ? nameOf(config, from.id) : 'No agent yet'} → ${other.name}`, base: ['tools', i], item: t, other, from: from?.id };
    });
// the lines on the strip: hand-overs to subagents, to other agents, back to the first, and to a person (Tools)
function lanesOf(config, extra) {
  const lanes = handoffEntries(config).map((e) => ({ ...e, kind: 'subagent', word: 'Subagent', list: 'handoffs' }));
  agentTransferEntries(config, extra).forEach((e) => lanes.push({ ...e, kind: 'agent', word: 'Another agent', list: 'agentTransfers' }));
  const back = list(config?.tools).find((t) => isObj(t) && t.builtin === 'return_to_entry');
  if (back)
    agentsOf(config)
      .filter((a) => list(a.tools).includes(back.id) && a.id !== firstId(config))
      .forEach((a) =>
        lanes.push({
          key: a.id,
          name: `${nameOf(config, a.id)} → ${nameOf(config, firstId(config))}`,
          kind: 'back',
          word: 'Back to the first',
          list: 'agents',
        }),
      );
  const agentTools = new Set(agentTransferEntries(config, extra).map((e) => e.key));
  list(config?.tools)
    .filter((t) => isObj(t) && t.builtin === 'transfer_or_callback' && !agentTools.has(t.id))
    .forEach((t) => {
      const from = agentsOf(config).find((a) => list(a.tools).includes(t.id));
      if (from) lanes.push({ key: t.id, name: `${nameOf(config, from.id)} → A person`, kind: 'person', word: 'Person · in Tools', list: null });
    });
  return lanes;
}

function Strip(ctx) {
  const lanes = lanesOf(ctx.config, ctx);
  const current = { handoffs: ctx.chosen('handoffs')?.key, agentTransfers: ctx.chosen('agentTransfers')?.key };
  const [adding, setAdding] = useState(false);
  const agents = agentsOf(ctx.config);
  return (
    <section className="dtStrip" aria-labelledby="dt-strip-title">
      <div className="dtStripHead">
        <h2 id="dt-strip-title">Who can pass callers to whom</h2>
        <span>Choose a line to open it · the same arrows as on the Workflow canvas</span>
      </div>
      <div className="dtLanes">
        {lanes.map((lane) => (
          <button
            key={`${lane.kind}:${lane.key}`}
            type="button"
            className="dtLane"
            aria-current={lane.list && current[lane.list] === lane.key}
            onClick={() => (lane.list === 'agents' ? ctx.choose('agents', lane.key) : lane.list ? ctx.choose(lane.list, lane.key) : ctx.goTools?.(lane.key))}
          >
            <b>{lane.name.split(' → ')[0]}</b>
            <Icon name="arrowRight" size={14} />
            <b>{lane.name.split(' → ')[1]}</b>
            <span className={`dtLaneKind ${lane.kind}`}>{lane.word}</span>
          </button>
        ))}
        {adding ? (
          <AddHandover ctx={ctx} onDone={() => setAdding(false)} />
        ) : (
          <Button type="button" variant="secondary" size="small" className="dtAddBtn" onClick={() => (agents.length > 1 ? setAdding(true) : addOne(ctx))}>
            <Icon name="plus" size={14} />
            Add a hand-over
          </Button>
        )}
      </div>
    </section>
  );
}
// with one agent, a hand-over needs a subagent to go to: one is made
function addOne(ctx) {
  const made = addSubagent(ctx.config, firstId(ctx.config), { name: 'New subagent' });
  ctx.set(made.config);
  ctx.choose('agents', made.id);
}
function AddHandover({ ctx, onDone }) {
  const agents = agentsOf(ctx.config);
  const [from, setFrom] = useState(firstId(ctx.config));
  const [to, setTo] = useState(agents.find((a) => a.id !== firstId(ctx.config))?.id || '');
  return (
    <span className="dtInline dtAddLane">
      <Select value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From">
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {agentLabel(ctx.config, a.id)}
          </option>
        ))}
      </Select>
      <Icon name="arrowRight" size={14} />
      <Select value={to} onChange={(event) => setTo(event.target.value)} aria-label="To">
        {agents
          .filter((a) => a.id !== from)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {agentLabel(ctx.config, a.id)}
            </option>
          ))}
      </Select>
      <Button
        type="button"
        size="small"
        disabled={!to || to === from}
        onClick={() => {
          const next = addAgentTransfer(ctx.config, from, to);
          ctx.set(next);
          const made = handoffEntries(next)
            .filter((e) => e.from === from && e.item.to === to)
            .at(-1);
          if (made) ctx.choose('handoffs', made.key);
          onDone();
        }}
      >
        Add
      </Button>
      <Button type="button" size="small" variant="quiet" onClick={onDone}>
        Cancel
      </Button>
    </span>
  );
}

// a row of the chosen item, at `key` under it
const itemRow = (entry, key, row) => ({
  ...row,
  pathFor: () => [...entry.base, ...key],
  get: (config) => getAtPath(config, [...entry.base, ...key]),
  put: (config, value) => setPath(config, [...entry.base, ...key], value === '' ? undefined : value),
});
// an agent's own setting (model, voice, interruption), through agentOverrides.js
const overrideRow = (entry, { id, label, choice, options, put, empty }) => ({
  id,
  label,
  render: (c) => <OverridePick c={c} entry={entry} choice={choice} options={options} put={put} empty={empty} />,
});
function OverridePick({ c, entry, choice, options, put, empty }) {
  const { providers } = useProviders();
  const agent = getAtPath(c.config, entry.base);
  return (
    <Select
      id={c.id}
      className="stFInput"
      value={choice(agent, c.config) || ''}
      onChange={(event) => c.set(setPath(c.config, entry.base, put(agent, event.target.value, c.config, providers)))}
    >
      <option value="">{empty(c.config)}</option>
      {options(agent, providers, c.config).map((o) => (
        <option key={o.value} value={o.value}>
          {o.group ? `${o.label} · ${o.group}` : o.label}
        </option>
      ))}
    </Select>
  );
}

// the chosen subagent's return_to_entry tool: on its tool list or not
const backTool = (config) => list(config?.tools).find((t) => isObj(t) && t.builtin === 'return_to_entry');
const backIndex = (config) => list(config?.tools).findIndex((t) => isObj(t) && t.builtin === 'return_to_entry');

// "Try a hand-over": which agent would take a line, by the simulated conversation's own matching
function TryHandover({ ctx, id }) {
  const [said, setSaid] = useState('');
  const result = said.trim() ? whoTakesOver(ctx.config, said) : null;
  const words = !said.trim()
    ? ''
    : !result
      ? `${nameOf(ctx.config, firstId(ctx.config))} would answer it itself.`
      : result.kind === 'subagent'
        ? `${nameOf(ctx.config, result.to)} would take it: “${result.why}”`
        : `It would be transferred with ${result.tool}: “${result.why}”`;
  return (
    <>
      <Input id={id} value={said} placeholder="I have a question about my bill" onChange={(event) => setSaid(event.target.value)} />
      {words && (
        <small className="dtNote" role="status">
          {words}
        </small>
      )}
    </>
  );
}

const KINDS = [
  { value: 'router', label: 'Passes callers on' },
  { value: 'specialist', label: 'Does one job' },
  { value: 'standalone', label: 'Answers on its own' },
];

export const subagentsPart = {
  id: 'subagents',
  num: '9',
  title: 'Subagents and hand-overs',
  question: 'Who answers first, what each subagent does, and who passes callers to whom. The Workflow canvas shows the same as a drawing.',
  top: (ctx) => <Strip {...ctx} />,
  cols: [
    [
      {
        id: 'who',
        title: 'Who answers',
        rows: [
          {
            id: 'first',
            label: 'Answers first',
            hint: 'Takes every new call',
            tags: 'r',
            kind: 'pick',
            options: (config) => agentsOf(config).map((a) => ({ value: a.id, label: agentLabel(config, a.id) })),
            get: (config) => config?.agents?.entry,
            put: (config, id) => (id ? setEntry(config, id) : config),
          },
        ],
        list: {
          id: 'agents',
          path: ['agents', 'items'],
          word: 'subagent',
          label: 'Subagents',
          hint: 'One job each; choose one to set it up',
          nameOf: (a, i) => (isObj(a) && (a.name || a.id)) || `Subagent ${i + 1}`,
          icon: 'subagent',
          describe: describeSubagent,
          add: (config) => {
            const made = addSubagent(config, firstId(config), { name: 'New subagent' });
            return { config: made.config, key: made.id };
          },
        },
      },
      {
        id: 'subagent',
        of: 'agents',
        word: 'subagent',
        titleFor: (entry) => (entry ? `A subagent: ${entry.name}` : 'A subagent'),
        lead: 'Anything not set here comes from the agent (part 1).',
        remove: (c, entry) => removeEntry(c, 'agents', entry),
        rowsFor: (c) => {
          const entry = c.chosen('agents');
          if (!entry) return [];
          return [
            itemRow(entry, ['name'], { id: 'name', label: 'Name', kind: 'text' }),
            itemRow(entry, ['kind'], { id: 'kind', label: 'What kind', kind: 'ch', options: KINDS }),
            // while it is the only agent, its words are the Agent part's (asked there, once)
            {
              id: 'same',
              label: 'What it does',
              kind: 'note',
              text: 'Written on the Agent part while it is the only agent. Add a subagent to give each its own job.',
              hidden: (config) => agentsOf(config).length > 1,
            },
            {
              ...itemRow(entry, ['instructions', 'role'], { id: 'does', label: 'What it does', kind: 'long', rows: 3 }),
              hidden: (config) => agentsOf(config).length < 2,
            },
            {
              ...itemRow(entry, ['instructions', 'opening'], { id: 'opening', label: 'When it takes over', kind: 'long', rows: 2 }),
              hidden: (config) => agentsOf(config).length < 2,
            },
            overrideRow(entry, {
              id: 'llm',
              label: 'Its own AI model',
              choice: llmChoice,
              options: llmOptions,
              put: setLlm,
              empty: (config) => `Default · ${defaultLlm(config)}`,
            }),
            overrideRow(entry, {
              id: 'voice',
              label: 'Its own voice',
              choice: voiceChoice,
              options: (agent, providers, config) => voiceOptions(agent, config),
              put: setVoice,
              empty: (config) => `Default · ${defaultVoice(config)}`,
            }),
            {
              id: 'interrupt',
              label: 'Callers can interrupt it',
              kind: 'ch',
              options: [
                { value: 'default', label: 'As the agent does' },
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ],
              get: (config) => {
                const v = interruptChoice(getAtPath(config, entry.base));
                return v === undefined ? 'default' : v ? 'yes' : 'no';
              },
              put: (config, v) => setPath(config, entry.base, setInterrupt(getAtPath(config, entry.base), v === 'default' ? undefined : v === 'yes')),
            },
            {
              id: 'noKnowledge',
              label: 'Knowledge it reads',
              kind: 'note',
              text: 'None yet: add documents on the Knowledge part, then choose which agents read them.',
              hidden: (config) => list(config?.knowledge).some((b) => isObj(b) && b.id),
            },
            itemRow(entry, ['knowledge'], {
              id: 'knowledge',
              label: 'Knowledge it reads',
              hidden: (config) => !list(config?.knowledge).some((b) => isObj(b) && b.id),
              kind: 'multi',
              // the knowledge bases on the Knowledge part
              options: (config) =>
                list(config?.knowledge)
                  .filter((b) => isObj(b) && b.id)
                  .map((b) => ({ value: b.id, label: b.id })),
            }),
            itemRow(entry, ['tools'], {
              id: 'tools',
              label: 'Tools it can use',
              kind: 'multi',
              // the tools on the Tools part
              options: (config) =>
                list(config?.tools)
                  .filter((t) => isObj(t) && t.id)
                  .map((t) => ({ value: t.id, label: humanize(t.id) })),
            }),
          ];
        },
        advFor: (c) => {
          const entry = c.chosen('agents');
          if (!entry) return [];
          return [
            itemRow(entry, ['instructions', 'rules'], { id: 'rules', label: 'Rules', kind: 'list' }),
            itemRow(entry, ['instructions', 'conditional'], { id: 'sometimes', label: 'Only sometimes', kind: 'form' }),
            itemRow(entry, ['vision'], { id: 'vision', label: 'Understands pictures', kind: 'form' }),
            itemRow(entry, ['channels'], {
              id: 'channels',
              label: 'Channels',
              kind: 'multi',
              options: (config) =>
                list(config?.channels)
                  .filter((ch) => isObj(ch) && ch.id)
                  .map((ch) => ({ value: ch.id, label: ch.id })),
            }),
            itemRow(entry, ['on_enter'], {
              id: 'enter',
              label: 'On taking over, it first…',
              kind: 'form',
              // agent config guide 3.27: with these steps the model stays quiet afterwards unless `opening` is also set
              note: (config) => {
                const agent = getAtPath(config, entry.base);
                const steps = Array.isArray(agent?.on_enter) ? agent.on_enter.length : 0;
                return steps && !String(agent?.instructions?.opening || '').trim()
                  ? 'After these steps it says nothing more until the caller speaks. To have it go on talking, write what it does in “When it takes over”.'
                  : '';
              },
            }),
          ];
        },
      },
      {
        id: 'back',
        title: 'Coming back',
        lead: 'So a caller is never stuck with an agent that has finished its job.',
        rowsFor: (c) => {
          const entry = c.chosen('agents');
          const agent = entry ? getAtPath(c.config, entry.base) : null;
          const back = backTool(c.config);
          const at = backIndex(c.config);
          return [
            {
              id: 'back',
              label: 'Can send the caller back to the first agent',
              hint: entry ? `For ${entry.name}: the built-in “Back to the first agent” tool` : 'The built-in “Back to the first agent” tool',
              kind: 'sw',
              disabled: () => !agent || agent.id === firstId(c.config),
              get: () => !!(agent && back && list(agent.tools).includes(back.id)),
              put: (config, on) => {
                if (!agent) return config;
                if (on) return addBackToStart(config, agent.id).config;
                const i = indexOfAgent(config, agent.id);
                return setPath(
                  config,
                  ['agents', 'items', i, 'tools'],
                  list(agent.tools).filter((t) => t !== back?.id),
                );
              },
            },
            {
              id: 'pending',
              label: 'Keep their unfinished request in',
              hint: 'The first agent picks up where they left off',
              kind: 'pick',
              placeholder: 'Nowhere',
              // the values it remembers (Conversation › What it remembers)
              options: (config) => Object.keys(isObj(config?.state?.variables) ? config.state.variables : {}).map((k) => ({ value: k, label: k })),
              disabled: () => at < 0,
              pathFor: () => (at < 0 ? null : ['tools', at, 'params', 'pending_request_into']),
              get: (config) => (at < 0 ? undefined : getAtPath(config, ['tools', at, 'params', 'pending_request_into'])),
              put: (config, v) => (at < 0 ? config : setPath(config, ['tools', at, 'params', 'pending_request_into'], v || undefined)),
            },
            {
              id: 'loops',
              label: 'Stop loops',
              hint: 'Never bounces a caller back and forth',
              kind: 'sw',
              disabled: () => at < 0,
              get: (config) => (at < 0 ? false : getAtPath(config, ['tools', at, 'params', 'guard_loops']) !== false),
              put: (config, v) => (at < 0 ? config : setPath(config, ['tools', at, 'params', 'guard_loops'], v)),
            },
            {
              id: 'moves',
              label: 'Most moves in one call',
              hint: 'Was in Guardrails › Limits',
              tags: 'm',
              kind: 'num',
              integer: true,
              path: ['guardrails', 'limits', 'max_handoffs_per_call'],
            },
          ];
        },
      },
    ],
    [
      {
        id: 'handover',
        // chosen on the strip above, so the card has no chips of its own
        list: { id: 'handoffs', path: ['agents', 'items'], label: 'Hand-overs', entries: handoffEntries, hidden: true },
        of: 'handoffs',
        word: 'hand-over',
        titleFor: (entry) => (entry ? `A hand-over: ${entry.name}` : 'A hand-over to a subagent'),
        lead: (c, entry) =>
          entry
            ? `Inside this agent. The caller stays on the same call; ${nameOf(c.config, entry.item?.to)} simply takes over.`
            : 'None yet: add one on the strip above.',
        empty: 'None yet: add one on the strip above.',
        remove: (c, entry) => {
          const agentIndex = entry.base[2];
          const handoffs = list(getAtPath(c.config, ['agents', 'items', agentIndex, 'handoffs'])).filter((_, j) => j !== entry.base[4]);
          c.set(setPath(c.config, ['agents', 'items', agentIndex, 'handoffs'], handoffs.length ? handoffs : undefined));
        },
        rowsFor: (c) => {
          const entry = c.chosen('handoffs');
          if (!entry) return [];
          return [
            {
              id: 'kind',
              label: 'Pass to',
              kind: 'ch',
              disabled: true,
              options: [
                { value: 'sub', label: 'A subagent of this agent' },
                { value: 'other', label: 'Another agent in your workspace' },
              ],
              get: () => 'sub',
            },
            itemRow(entry, ['to'], {
              id: 'to',
              label: 'Who takes over',
              kind: 'pick',
              options: (config) => agentsOf(config).map((a) => ({ value: a.id, label: agentLabel(config, a.id) })),
            }),
            itemRow(entry, ['description'], {
              id: 'when',
              label: 'When it passes the caller on',
              hint: 'The model reads this to decide',
              kind: 'long',
              rows: 2,
            }),
            {
              id: 'also',
              label: 'Also passed on when',
              hint: 'From Guardrails rules and tool steps, shown here too',
              kind: 'note',
              text: (config) => {
                const to = entry.item?.to;
                const rules = list(config?.guardrails?.escalation).filter((r) => isObj(r) && (r.handoff === to || r.to === to || r.agent === to));
                const tools = list(config?.tools).filter((t) => isObj(t) && JSON.stringify(t.effects || []).includes(`"${to}"`));
                const parts = [...rules.map((r) => `A rule: ${r.id}`), ...tools.map((t) => `A tool step: ${t.id}`)];
                return parts.length ? parts.join(' · ') : 'Nothing else passes callers here.';
              },
            },
            itemRow(entry, ['announce'], { id: 'say', label: 'Say while handing over', kind: 'text', placeholder: 'One moment, let me get bookings.' }),
            itemRow(entry, ['carry_context'], { id: 'context', label: 'The next agent knows what was said', kind: 'sw' }),
          ];
        },
      },
      {
        id: 'transfer',
        list: { id: 'agentTransfers', path: ['tools'], label: 'Transfers to other agents', entries: agentTransferEntries, hidden: true },
        of: 'agentTransfers',
        word: 'transfer',
        titleFor: (entry) => (entry ? `A hand-over to another agent: ${entry.other?.name || ''}` : 'A hand-over to another agent'),
        lead: 'To a separate agent in your workspace. The call is transferred to that agent’s number.',
        empty: 'None yet: on the Workflow canvas, Add › Agent transfer, once another agent has a number.',
        remove: (c, entry) => removeEntry(c, 'tools', entry),
        rowsFor: (c) => {
          const entry = c.chosen('agentTransfers');
          if (!entry) return [];
          const transferPath = (config) => {
            const { index } = transferOf(config, entry.key);
            return index < 0 ? null : ['telephony', 'transfers', index];
          };
          const transferRow = (key, row) => ({
            ...row,
            pathFor: (config) => (transferPath(config) ? [...transferPath(config), ...key] : null),
            get: (config) => (transferPath(config) ? getAtPath(config, [...transferPath(config), ...key]) : undefined),
            put: (config, v) => (transferPath(config) ? setPath(config, [...transferPath(config), ...key], v === '' ? undefined : v) : config),
          });
          return [
            {
              id: 'kind',
              label: 'Pass to',
              kind: 'ch',
              disabled: true,
              options: [
                { value: 'sub', label: 'A subagent of this agent' },
                { value: 'other', label: 'Another agent in your workspace' },
              ],
              get: () => 'other',
            },
            {
              id: 'agent',
              label: 'Which agent',
              hint: 'Agents that take calls on a number',
              tags: 'r',
              kind: 'pick',
              options: () =>
                list(c.workspace?.agents)
                  .filter((a) => list(a.numbers).length)
                  .map((a) => ({ value: a.id, label: `${a.name} · ${a.numbers[0].number}` })),
              get: () => entry.other?.id,
              put: (config, id) =>
                setTransferAgent(
                  config,
                  entry.key,
                  list(c.workspace?.agents).find((a) => a.id === id),
                ),
            },
            itemRow(entry, ['description'], { id: 'when', label: 'When it transfers', tags: 'r', kind: 'long', rows: 2 }),
            {
              id: 'say',
              label: 'Say while transferring',
              kind: 'text',
              get: (config) => {
                const { transfer } = transferOf(config, entry.key);
                return list(transfer?.before).find((a) => isObj(a) && a.type === 'say')?.text || '';
              },
              put: (config, text) => setTransferSay(config, entry.key, text || ''),
            },
            {
              id: 'delay',
              label: 'Delay before transfer',
              kind: 'num',
              unit: 'seconds',
              get: (config) => transferOf(config, entry.key).transfer?.delay_s,
              put: (config, n) => setTransferDelay(config, entry.key, n ?? 0),
            },
            transferRow(['schedule'], {
              id: 'hours',
              label: 'Only during',
              hint: 'Business hours from Channels',
              kind: 'pick',
              placeholder: 'Any time',
              options: (config) =>
                Object.keys(isObj(config?.schedules) ? config.schedules : {}).map((k) => ({ value: k, label: config.schedules[k]?.description || k })),
            }),
            itemRow(entry, ['params', 'fallback'], { id: 'fails', label: 'If it can’t connect', kind: 'form' }),
            {
              id: 'summary',
              label: 'Send a summary along',
              hint: 'The other agent starts knowing why they called',
              tags: 'n',
              render: (ctx) => (
                <span className="dtSw">
                  <Switch id={ctx.id} checked={false} disabled label="Send a summary along" onChange={() => {}} />
                  <small className="dtNote">Not available yet: the server needs to support it.</small>
                </span>
              ),
            },
          ];
        },
        advFor: (c) => {
          const entry = c.chosen('agentTransfers');
          if (!entry) return [];
          const at = (key, row) => ({
            ...row,
            pathFor: (config) => {
              const { index } = transferOf(config, entry.key);
              return index < 0 ? null : ['telephony', 'transfers', index, ...key];
            },
          });
          return [
            at(['headers'], { id: 'headers', label: 'SIP headers', kind: 'form' }),
            at(['uri_template'], { id: 'uri', label: 'Address template', kind: 'text' }),
            at(['before'], { id: 'before', label: 'Before it connects', kind: 'form' }),
            at(['on_success'], { id: 'after', label: 'After it connects', kind: 'form' }),
          ];
        },
      },
      {
        id: 'try',
        title: 'Try a hand-over',
        rows: [
          {
            id: 'try',
            label: 'A line a caller might say',
            hint: 'Shows which agent would take it, and why',
            tags: 'p',
            render: (c) => <TryHandover ctx={c} id={c.id} />,
          },
        ],
      },
    ],
  ],
};

// The part with the workspace's other agents and their numbers (a transfer to one of them is a hand-over to it).
export function SubagentsPage({ editor, request, onShowJson, onGoTools }) {
  const workspace = useWorkspaceAgents();
  return <DetailedPage part={subagentsPart} editor={editor} request={request} onShowJson={onShowJson} extra={{ workspace, goTools: onGoTools }} />;
}
