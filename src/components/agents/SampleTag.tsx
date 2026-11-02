import { StatusChip } from '../ui/StatusChip';
import { isSandboxSample } from '../../sandbox/mode';

/**
 * "Sample" beside one of the agents Sandbox starts with, so a sample is never mistaken for a real agent. Nothing in Live
 * (isSandboxSample is false there).
 */
export function SampleTag({ id, className }: { id: string; className?: string }) {
  if (!isSandboxSample(id)) return null;
  return (
    <StatusChip tone="warning" className={className} title="An example that comes with Sandbox, with calls made up in this browser. Home can hide the samples.">
      <span data-sample-tag>Sample</span>
    </StatusChip>
  );
}
