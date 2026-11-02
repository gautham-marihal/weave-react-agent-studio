// What Sandbox makes up on a screen, said where it matters (Weave React's DemoNote and its demo-mode lines, worded for
// Sandbox). Loaded only in Sandbox, through SandboxNoteSlot.
import React from 'react';
import { FlaskConicalIcon } from 'lucide-react';
import { cn } from '../../utils/styles';
import type { SandboxNoteKind } from './SandboxNoteSlot';
import { isSandbox } from '../mode';

const SANDBOX_NOTES: Record<SandboxNoteKind, { title?: string; text: string }> = {
  test: {
    title: 'A simulated conversation',
    text: 'Replies in this conversation are made up in your browser by simple rules. Nothing here is the real agent or its models.',
  },
  trace: { text: 'These records were made by the simulated conversation, in the same shape a real call has. No runtime wrote them.' },
  banking: {
    title: 'A banking conversation in Sandbox',
    text: 'The agent’s turns are played by simple rules in your browser, with no language model. Every banking answer comes from the banking gateway’s own tools and says where it came from; PIN, NRIC and one-time passwords go only through the secure keypad.',
  },
  scenarios: {
    title: 'Sandbox imitation',
    text: 'There is no runtime in Sandbox: scenarios are played by a simple imitation in this browser. A pass here means the scenario is well formed and its checks can be met by the imitation, not that the real agent would pass. Reviewer (“judge”) checks are never graded.',
  },
  callers: {
    text: 'Sandbox: the callers are played by Sandbox’s imitation, which follows tools and hand-overs but does not read instructions or grade the reviewer checks. Nothing is billed.',
  },
  checks: { text: 'Sandbox: checked by simple rules in this browser, not by the server.' },
  calls: { text: 'In Sandbox these are sample calls made up in this browser, plus the test conversations you had here. No real caller is involved.' },
  monitoring: { text: 'In Sandbox the calls are sample ones made up in this browser, so the numbers show what the page does, not how a real agent performs.' },
  replay: {
    text: 'Replaying in the browser is free and instant, but it is a simulation: simple rules for the tools, hand-overs and goodbyes, with no language model, so its wording is not the agent’s. Trust it for what the agent does, not how it says it. The Sandbox runner is an imitation too, run the way the scenario runner would.',
  },
};

/** In Live only a banking rehearsal draws these notes (SandboxNoteSlot `always`); they say what it is there. */
const LIVE_NOTES: Partial<Record<SandboxNoteKind, { title?: string; text: string }>> = {
  banking: {
    title: 'A banking rehearsal on the mock bank',
    text: 'Not the real agent: its turns are played by simple rules in your browser, with no language model. Every banking answer is test data from the mock bank’s gateway and says where it came from; PIN, NRIC and one-time passwords go only through the secure keypad. Choose “The real agent” under Played by to talk to the agent on the runtime.',
  },
  trace: { text: 'These records were made by the rehearsal, in the same shape a real call has. No runtime wrote them; the gateway rows are the mock bank’s own timeline.' },
};

export default function SandboxNote({ kind, className }: { kind: SandboxNoteKind; className?: string }) {
  const note = (!isSandbox() && LIVE_NOTES[kind]) || SANDBOX_NOTES[kind];
  return (
    <div
      role="note"
      data-sandbox-note={kind}
      className={cn('flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/60 px-3 py-2 text-[13px] leading-relaxed text-ink-soft', className)}
    >
      <FlaskConicalIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0">
        {note.title && <strong className="font-medium text-ink">{note.title}. </strong>}
        {note.text}
      </p>
    </div>
  );
}
