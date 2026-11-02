// The changes Studio can suggest for a call's findings: well-known remedies from a checklist, not a model's answer
// (a rule that keeps spoken answers short, a faster model). Each is shown as a sentence before it is applied, and is a
// plain draft edit (see pendingChange.ts), so it lands in the draft like any other edit. Pure: no network, no DOM.
import type { AgentConfig } from '../types/studio';
import { llmProviders, providerLabels } from '../data/providers';
import { applyEdit, isApplied, type DraftEdit } from './pendingChange';
import type { Finding } from './fixcallDiagnose';

export interface Fix {
  id: string;
  title: string;
  why: string;
  /** The change as a sentence, as it would be written in the draft. */
  change: string;
  kind: 'wording' | 'setting';
  /** What a test should check afterwards, in words (used as the test's reviewer check); '' when none. */
  expected: string;
  edit: DraftEdit;
}

const ruleFix = ({ id, title, rule, why, expected }: { id: string; title: string; rule: string; why: string; expected: string }): Fix => ({
  id,
  title,
  why,
  kind: 'wording',
  expected,
  change: `Add this rule under How it speaks: “${rule}”`,
  edit: { op: 'add_style_rules', rules: [rule] },
});

const SHORT = {
  id: 'rule:short',
  title: 'Keep answers short',
  rule: 'Keep each answer to one or two short sentences, and ask one question at a time.',
  expected: 'the agent keeps each answer to one or two short sentences',
};

// "Fast" is what the model catalogue's own note says about a model.
const isFast = (note: string | undefined) => /\bfast\b|low latency/i.test(note ?? '');

/** A faster model from the same provider, when the catalogue has one and the current model is not already fast. */
export function fasterModel(config: AgentConfig | null | undefined): { id: string; label: string; provider: string } | null {
  const llm = config?.defaults?.models?.llm;
  const provider = llm?.provider;
  if (!provider) return null;
  const options = llmProviders.find((p) => p.id === provider)?.models ?? [];
  const current = options.find((m) => m.id === llm?.model);
  if (current && isFast(current.note)) return null;
  const faster = options.find((m) => m.id !== llm?.model && isFast(m.note));
  return faster ? { id: faster.id, label: faster.label, provider } : null;
}

const modelLabel = (provider: string | undefined, model: string | undefined) =>
  llmProviders.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.label ?? model ?? 'none';

/** The suggestions for one finding. */
export function fixesFor(finding: Pick<Finding, 'kind'> & Partial<Pick<Finding, 'tool'>>, config: AgentConfig | null | undefined): Fix[] {
  switch (finding.kind) {
    case 'tool_failed': {
      const tool = finding.tool || 'a tool';
      return [
        ruleFix({
          id: `rule:tool_failed:${tool}`,
          title: `Say what to do when “${tool}” fails`,
          rule: `If the “${tool}” tool fails, say so plainly, never guess what it would have returned, and offer to try again or to hand over to a person.`,
          why: 'Without a rule the agent may carry on as if the tool had worked, or give up. This tells it what to say and what to offer.',
          expected: `when the “${tool}” tool fails, the agent says so honestly and offers to try again or hand over, and does not make up a result`,
        }),
      ];
    }
    case 'cut_off':
      return [
        ruleFix({
          id: 'rule:wrap_up',
          title: 'Finish the request before the call ends',
          rule: 'Before ending the call, make sure the caller’s request is done and ask whether there is anything else.',
          why: 'A call that stops with no ending often stopped while something was still open. This asks the agent to close it properly.',
          expected: 'the agent finishes the request and asks whether there is anything else before the call ends',
        }),
      ];
    case 'no_answer':
      return [
        ruleFix({
          id: 'rule:always_answer',
          title: 'Always answer the caller',
          rule: 'Always answer the caller. If you cannot help with something, say so and offer to hand over to a person.',
          why: 'The agent said nothing here. This asks for an answer every time, even when the answer is “I can’t help with that”.',
          expected: 'the agent always answers, and when it cannot help it says so and offers a person',
        }),
      ];
    case 'slow_answer': {
      const out: Fix[] = [];
      const faster = fasterModel(config);
      if (faster) {
        const llm = config?.defaults?.models?.llm;
        out.push({
          id: `model:${faster.id}`,
          title: `Use a faster model: ${faster.label}`,
          why: `Most of a wait is the language model thinking. ${faster.label} is the faster choice from ${providerLabels[faster.provider] ?? faster.provider}; it can be a little less capable on hard requests.`,
          kind: 'setting',
          expected: '',
          change: `Change the language model from “${modelLabel(llm?.provider, llm?.model)}” to “${faster.label}”.`,
          edit: { op: 'set_model', stage: 'llm', model: faster.id },
        });
      }
      out.push(ruleFix({ ...SHORT, why: 'A shorter answer is ready sooner and is easier to follow when heard.' }));
      return out;
    }
    case 'long_reply':
      return [ruleFix({ ...SHORT, why: 'A caller cannot skim. Long answers are hard to follow by ear; this keeps each one short.' })];
    case 'repeated_answer':
      return [
        ruleFix({
          id: 'rule:no_repeat',
          title: 'Don’t repeat an answer word for word',
          rule: 'Never repeat an answer word for word. If the caller asks again, put it a different way, or offer to hand over to a person.',
          why: 'Saying the same thing twice is what a stuck agent does. This asks for a different try, or a person.',
          expected: 'when asked again the agent says it a different way, or offers a person, and never repeats itself word for word',
        }),
      ];
    case 'caller_repeated':
      return [
        ruleFix({
          id: 'rule:acknowledge',
          title: 'Acknowledge a caller who repeats themselves',
          rule: 'If the caller repeats themselves, acknowledge it, say back what you understood, and move on.',
          why: 'A caller who repeats themselves was not understood. Saying back what was understood fixes it quickly.',
          expected: 'when the caller repeats themselves the agent acknowledges it and says back what it understood',
        }),
      ];
    case 'handed_over':
      return [
        ruleFix({
          id: 'rule:handoff_when',
          title: 'Hand over only when it is needed',
          rule: 'Only hand over when the caller asks for a person, or after you have tried to solve it twice.',
          why: 'If this call did not need a person, a rule about when to hand over keeps the agent trying first.',
          expected: 'the agent hands over only when asked for a person or after trying twice to solve it',
        }),
      ];
    default:
      return [];
  }
}

/** True when the fix is already in the draft. */
export const fixApplied = (config: AgentConfig, fix: Fix): boolean => isApplied(config, fix.edit);

/** The draft with these fixes made, in order. */
export const applyFixes = (config: AgentConfig, fixes: Fix[]): AgentConfig => fixes.reduce((c, fix) => applyEdit(c, fix.edit), config);
