// The changes the studio can suggest for what it found in a call. They are a checklist of well-known remedies, not the answer of a language model: the usual
// cure for a spoken answer that is too long is a rule that keeps it short, for a failing tool a rule about what to say when it fails, for a slow answer a
// faster model. Each one is a small, visible change to the draft (a style rule, or the model), shown as a sentence before it is applied, and each says
// whether the browser's simulation can show its effect (a change of wording cannot be seen without the real agent). Pure: no network, no DOM.

import { readSimple, setStyleRules } from '../simple/simpleModel.js';
import { modelsFor, modelLabel, providerLabel } from '../models/catalog.js';
import { readModels, setModel } from '../models/config.js';

const list = (v) => (Array.isArray(v) ? v : []);

// A rule added to "Tone and style" (persona.style_rules). Not added twice.
const ruleFix = ({ id, title, rule, why, expected }) => ({
  id,
  title,
  why,
  kind: 'wording',
  needsRuntime: true,
  expected,
  change: `Add this rule under Tone and style: “${rule}”`,
  applied: (config) => readSimple(config).styleRules.includes(rule),
  apply: (config) => {
    const rules = readSimple(config).styleRules;
    return rules.includes(rule) ? config : setStyleRules(config, [...rules, rule]);
  },
});

function fasterModel(config) {
  const llm = readModels(config).llm;
  if (!llm.provider) return null;
  const options = modelsFor('llm', llm.provider);
  const current = options.find((m) => m.id === llm.model);
  if ((current?.tags || []).includes('fast')) return null;
  return options.find((m) => m.id !== llm.model && (m.tags || []).includes('fast')) || null;
}

// The suggestions for one finding: [{ id, title, why, change, kind, needsRuntime, expected, applied(config), apply(config) }]
export function fixesFor(finding, config) {
  const out = [];
  switch (finding.kind) {
    case 'tool_failed': {
      const tool = finding.tool || 'a tool';
      out.push(
        ruleFix({
          id: `rule:tool_failed:${tool}`,
          title: `Say what to do when “${tool}” fails`,
          rule: `If the “${tool}” tool fails, say so plainly, never guess what it would have returned, and offer to try again or to hand over to a person.`,
          why: 'Without a rule the agent may carry on as if the tool had worked, or give up. This tells it what to say and what to offer.',
          expected: `when the “${tool}” tool fails, the agent says so honestly and offers to try again or hand over, and does not make up a result`,
        }),
      );
      break;
    }
    case 'cut_off':
      out.push(
        ruleFix({
          id: 'rule:wrap_up',
          title: 'Finish the request before the call ends',
          rule: 'Before ending the call, make sure the caller’s request is done and ask whether there is anything else.',
          why: 'A call that stops with no ending often stopped while something was still open. This asks the agent to close it properly.',
          expected: 'the agent finishes the request and asks whether there is anything else before the call ends',
        }),
      );
      break;
    case 'no_answer':
      out.push(
        ruleFix({
          id: 'rule:always_answer',
          title: 'Always answer the caller',
          rule: 'Always answer the caller. If you cannot help with something, say so and offer to hand over to a person.',
          why: 'The agent said nothing here. This asks for an answer every time, even when the answer is “I can’t help with that”.',
          expected: 'the agent always answers, and when it cannot help it says so and offers a person',
        }),
      );
      break;
    case 'slow_answer': {
      const faster = fasterModel(config);
      if (faster) {
        const llm = readModels(config).llm;
        out.push({
          id: `model:${faster.id}`,
          title: `Use a faster model: ${faster.label}`,
          why: `Most of a wait is the language model thinking. ${faster.label} is the faster choice from ${providerLabel(llm.provider)}; it can be a little less capable on hard requests.`,
          kind: 'setting',
          needsRuntime: true,
          expected: '',
          change: `Change the language model from “${modelLabel('llm', llm.provider, llm.model) || 'none'}” to “${faster.label}”.`,
          applied: (c) => readModels(c).llm.model === faster.id,
          apply: (c) => setModel(c, 'llm', faster.id),
        });
      }
      out.push(
        ruleFix({
          id: 'rule:short',
          title: 'Keep answers short',
          rule: 'Keep each answer to one or two short sentences, and ask one question at a time.',
          why: 'A shorter answer is ready sooner and is easier to follow when heard.',
          expected: 'the agent keeps each answer to one or two short sentences',
        }),
      );
      break;
    }
    case 'long_reply':
      out.push(
        ruleFix({
          id: 'rule:short',
          title: 'Keep answers short',
          rule: 'Keep each answer to one or two short sentences, and ask one question at a time.',
          why: 'A caller cannot skim. Long answers are hard to follow by ear; this keeps each one short.',
          expected: 'the agent keeps each answer to one or two short sentences',
        }),
      );
      break;
    case 'repeated_answer':
      out.push(
        ruleFix({
          id: 'rule:no_repeat',
          title: 'Don’t repeat an answer word for word',
          rule: 'Never repeat an answer word for word. If the caller asks again, put it a different way, or offer to hand over to a person.',
          why: 'Saying the same thing twice is what a stuck agent does. This asks for a different try, or a person.',
          expected: 'when asked again the agent says it a different way, or offers a person, and never repeats itself word for word',
        }),
      );
      break;
    case 'caller_repeated':
      out.push(
        ruleFix({
          id: 'rule:acknowledge',
          title: 'Acknowledge a caller who repeats themselves',
          rule: 'If the caller repeats themselves, acknowledge it, say back what you understood, and move on.',
          why: 'A caller who repeats themselves was not understood. Saying back what was understood fixes it quickly.',
          expected: 'when the caller repeats themselves the agent acknowledges it and says back what it understood',
        }),
      );
      break;
    case 'handed_over':
      out.push(
        ruleFix({
          id: 'rule:handoff_when',
          title: 'Hand over only when it is needed',
          rule: 'Only hand over when the caller asks for a person, or after you have tried to solve it twice.',
          why: 'If this call did not need a person, a rule about when to hand over keeps the agent trying first.',
          expected: 'the agent hands over only when asked for a person or after trying twice to solve it',
        }),
      );
      break;
    default:
  }
  return out;
}

// The draft with these suggestions applied, in order. `undefined` suggestions are skipped.
export const applyFixes = (config, fixes) =>
  list(fixes)
    .filter(Boolean)
    .reduce((c, fix) => fix.apply(c), config);
