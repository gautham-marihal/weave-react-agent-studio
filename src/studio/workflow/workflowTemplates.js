import { isObj } from '../form/engine.js';
import { setAt } from '../form/inlineCreate.js';
import { addAgentTransfer, addEnd, addSubagent, isBuiltin } from './workflowOps.js';
import { buildWorkflow } from './workflowModel.js';

// Ready-made workflow pieces, added in one go (and undone with Undo). Each uses the same edits as the ＋ menu, so the
// result is an ordinary draft; a template that would add nothing says why.
//   { id, title, description, unavailable(config) -> '' | why, apply(config) -> { config, select, note } }
const list = (v) => (Array.isArray(v) ? v : []);
const agentsOf = (config) => list(config?.agents?.items).filter((a) => isObj(a) && typeof a.id === 'string' && a.id);
const entryOf = (config) => (agentsOf(config).some((a) => a.id === config?.agents?.entry) ? config.agents.entry : agentsOf(config)[0]?.id || '');
const canEnd = (config, agent) =>
  list(agent.tools).some((id) =>
    isBuiltin(
      list(config?.tools).find((t) => t?.id === id),
      'end_call',
    ),
  );
// whether an agent can already pass the caller back (a hand-over, the "back to the start" tool, a step, a tool's rules)
const goesBack = (config, from, to) =>
  buildWorkflow(config).edges.some((e) => e.from === from && e.to === to && ['handoff', 'return', 'tool'].includes(e.kind));

// a subagent the first agent passes callers to, told what it does
function specialist(config, from, { name, when, role }) {
  const made = addSubagent(config, from, { name, when });
  // its index in the raw list (an item that isn't an agent still counts)
  const i = list(made.config.agents.items).findIndex((a) => isObj(a) && a.id === made.id);
  return { config: setAt(made.config, ['agents', 'items', i, 'instructions', 'role'], role), id: made.id };
}

export const TEMPLATES = [
  {
    id: 'specialists',
    title: 'Front desk with specialists',
    description: 'The first subagent greets callers and passes them to Sales or Support.',
    unavailable: (config) => (agentsOf(config).length ? '' : 'Add the first subagent first.'),
    apply(config) {
      const from = entryOf(config);
      const sales = specialist(config, from, {
        name: 'Sales',
        when: 'The caller wants to buy something, or asks about prices or plans.',
        role: 'You help callers choose and buy. Answer questions about prices and plans, and take orders. Keep answers short and friendly.',
      });
      const support = specialist(sales.config, from, {
        name: 'Support',
        when: 'The caller has a problem with something they already have.',
        role: 'You help callers fix problems with what they already have. Ask what is wrong, then go through it with them step by step.',
      });
      return { config: support.config, select: sales.id, note: 'Added Sales and Support. The first subagent passes callers to them.' };
    },
  },
  {
    id: 'back',
    title: 'Back to the first subagent',
    description: 'Each subagent a caller is passed to can pass them back when they need something else.',
    unavailable(config) {
      const entry = entryOf(config);
      if (agentsOf(config).length < 2) return 'There is only one subagent.';
      return agentsOf(config).some((a) => a.id !== entry && !goesBack(config, a.id, entry)) ? '' : 'Every subagent can already pass callers back.';
    },
    apply(config) {
      const entry = entryOf(config);
      const first = agentsOf(config).find((a) => a.id === entry);
      let next = config;
      agentsOf(config)
        .filter((a) => a.id !== entry && !goesBack(config, a.id, entry))
        .forEach((a) => {
          next = addAgentTransfer(next, a.id, entry, 'The caller needs something this subagent can’t help with.');
        });
      return { config: next, select: null, note: `Every subagent can now pass callers back to ${first?.name || entry}.` };
    },
  },
  {
    id: 'end',
    title: 'Every subagent can end the conversation',
    description: 'Each subagent can say goodbye and end the conversation when the caller has nothing more to ask.',
    unavailable: (config) => (agentsOf(config).some((a) => !canEnd(config, a)) ? '' : 'Every subagent can already end the conversation.'),
    apply(config) {
      let next = config;
      agentsOf(config)
        .filter((a) => !canEnd(config, a))
        .forEach((a) => {
          next = addEnd(next, a.id).config;
        });
      return { config: next, select: null, note: 'Every subagent can now end the conversation.' };
    },
  },
];
