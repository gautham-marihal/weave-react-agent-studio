import { useCallback } from 'react';
import { changeMember, roleOf } from './teamModel.js';
import { useTeam } from './useTeam.js';

// The signed-in person's place in the open workspace's team, found by their email, so their role reads the same on the
// Team page, in Account and in the top bar. Changes go through the team's own rules (one owner, an admin kept).
//   -> { member (null when they are not on the team), role: { id, label, blurb } | null, isOwner,
//        changeRole(roleId) -> '' or why it can't be, rename(name) }
export function useMyMembership(profile) {
  const { members, update } = useTeam();
  const email = String(profile?.email || '').toLowerCase();
  const member = (email && members.find((m) => String(m.email || '').toLowerCase() === email)) || null;

  const changeRole = useCallback(
    (roleId) => {
      if (!member) return 'You are not on this workspace’s team.';
      let problem = '';
      update((current) => {
        const result = changeMember(current, member.id, { role: roleId });
        problem = result.problem;
        return problem ? current : result.members;
      });
      return problem;
    },
    [member, update],
  );

  const rename = useCallback(
    (name) => {
      if (!member) return;
      update((current) => current.map((m) => (m.id === member.id ? { ...m, name } : m)));
    },
    [member, update],
  );

  return { member, role: member ? roleOf(member.role) : null, isOwner: member?.role === 'owner', changeRole, rename };
}
