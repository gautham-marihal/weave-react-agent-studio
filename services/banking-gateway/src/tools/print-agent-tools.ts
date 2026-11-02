// Prints the agent-config `tools`, `connections` and per-agent tool lists generated from the registry, for pasting
// into (or diffing against) the agent's config in Weave Studio's JSON view.
import { buildRegistry, toAgentConfigTools } from './registry.ts';

process.stdout.write(`${JSON.stringify(toAgentConfigTools(buildRegistry()), null, 2)}\n`);
