import { Link } from 'react-router-dom';
import { FlaskConicalIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { StatusChip } from '../ui/StatusChip';
import { hideAgent } from '../../models/manage';
import { isSandboxSample } from '../../sandbox/mode';
import type { Agent } from '../../types/studio';

/**
 * Sandbox only: says which agents on Home are the samples Sandbox starts with, so a new workspace isn't mistaken for
 * someone else's, and hides them ("Removed from your list" on the Agents page brings them back). Nothing in Live.
 */
export function SampleAgentsNotice({ agents }: { agents: Pick<Agent, 'id' | 'name'>[] }) {
  const samples = agents.filter((a) => isSandboxSample(a.id));
  if (!samples.length) return null;
  const one = samples.length === 1;
  return (
    <section
      aria-label="Sample agents"
      data-testid="sample-agents"
      className="mt-6 flex flex-wrap items-start gap-x-4 gap-y-3 rounded-xl border border-warning/30 bg-warning-soft px-5 py-4 text-sm text-ink-soft">
      <FlaskConicalIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {one ? 'This agent is a sample' : `These ${samples.length} agents are samples`}
          <StatusChip tone="warning">Sample</StatusChip>
        </p>
        <p className="mt-1">
          {samples.map((a) => a.name).join(', ')} {one ? 'comes' : 'come'} with Sandbox, with calls made up in this browser, so there is something to
          explore. Hide {one ? 'it' : 'them'} to start with an empty workspace; <Link to="/agents" className="font-medium text-accent hover:underline">Agents</Link>{' '}
          can bring {one ? 'it' : 'them'} back from “Removed from your list”.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => samples.forEach((a) => hideAgent(a.id))}>
        Hide the samples
      </Button>
    </section>
  );
}
