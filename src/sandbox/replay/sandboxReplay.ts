// Sandbox's replay: a call's caller side played again on the imitation agent in this browser (Weave React's
// replay/ReplayView.jsx, the demo branch, and replayRun.js playSimulated), read into the same facts as the call so the
// two can be compared. Free and instant; simple rules for tools, hand-overs and goodbyes, with no language model.
// Loaded only in Sandbox (ReplayPanel imports it with import()).
import type { AgentConfig } from '../../types/studio';
import type { CallFacts } from '../../models/replayFacts';
import { compareReplay, type ReplayComparison } from '../../models/replayCompare';
import { playSimulated } from '../sandboxEngine.js';

/** Said beside every replay the imitation played. */
export const SIMULATION_LABEL = 'This replay is a simulation.';

/** The caller's turns of `original` played to the imitation of `config`, as facts. */
export function playOnImitation(config: AgentConfig, original: CallFacts): CallFacts {
  const played = playSimulated(config, original) as Partial<CallFacts>;
  return {
    channelId: String(played.channelId ?? original.channelId ?? ''),
    startAgent: String(played.startAgent ?? ''),
    finalAgent: String(played.finalAgent ?? ''),
    finalState: played.finalState && typeof played.finalState === 'object' ? played.finalState : {},
    ended: played.ended === true,
    handoffs: Number(played.handoffs) || 0,
    opening: Array.isArray(played.opening) ? played.opening : [],
    turns: Array.isArray(played.turns) ? played.turns : [],
    errors: Array.isArray(played.errors) ? played.errors : [],
  };
}

/** The replay on the imitation, compared with the call, and the words that say it is a simulation. */
export function replayInBrowser(config: AgentConfig, original: CallFacts): { comparison: ReplayComparison; sourceLabel: string } {
  return { comparison: compareReplay(original, playOnImitation(config, original)), sourceLabel: SIMULATION_LABEL };
}
