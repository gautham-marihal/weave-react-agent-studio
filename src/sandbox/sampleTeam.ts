// Sandbox's sample team (Weave React's teamModel.js demoTeam): people to try the Team page with, made up for Sandbox
// and marked "Sample" on the page. An admin on the whole workspace, an editor on one agent, one invitation waiting.
// Loaded with import() by src/pages/Team.tsx, only in Sandbox, the first time its team is opened.
import { WHOLE_WORKSPACE, agentsScope, type Member } from '../models/team';

const PREFIX = 'sample_';

/** One of the made-up people (only ever added in Sandbox). */
export const isSampleMember = (member: Pick<Member, 'id'>): boolean => member.id.startsWith(PREFIX);

/** The owner (the person signed in) and three sample people. `agentIds`: the sandbox's agents, for the editor's one agent. */
export function sampleTeam(owner: Member, agentIds: string[], now = Date.now()): Member[] {
  const one = agentIds.includes('acme-support') ? 'acme-support' : agentIds[0] || 'acme-support';
  const day = 86_400_000;
  return [
    owner,
    { id: `${PREFIX}a`, email: 'priya.shah@example.com', name: 'Priya Shah', role: 'admin', scope: WHOLE_WORKSPACE, status: 'active', invitedBy: owner.email, at: now - 9 * day },
    { id: `${PREFIX}b`, email: 'marco.rossi@example.com', name: 'Marco Rossi', role: 'editor', scope: agentsScope([one]), status: 'active', invitedBy: owner.email, at: now - 4 * day },
    { id: `${PREFIX}c`, email: 'dana.lee@example.com', name: 'Dana Lee', role: 'viewer', scope: WHOLE_WORKSPACE, status: 'invited', invitedBy: owner.email, at: now - day },
  ];
}
