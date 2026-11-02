// What the search (Ctrl/⌘ K) finds in Sandbox telephony: each test number, dispatch rule and SIP trunk, opening the
// part of the Telephony page it is on (as Weave React's search did for numbers and rules).

import type { PaletteTelephony } from '../../models/paletteSearch';
import { readTelephony } from './store';
import { describeRuleHours, type TelephonyData } from './model';

/** The search results for what is kept. `names` gives an agent's name by id. */
export function telephonyResults(data: TelephonyData, names: Record<string, string>): PaletteTelephony[] {
  return [
    ...data.numbers.map((n) => ({
      id: n.id,
      section: 'numbers' as const,
      title: n.number,
      description: n.label ? `Sandbox test number, ${n.label}` : 'Sandbox test number',
      words: `${n.number.replace(/\D/g, '')} phone number telephony`,
    })),
    ...data.rules.map((r) => ({
      id: r.id,
      section: 'dispatch' as const,
      title: r.name,
      description: `Sandbox dispatch rule to ${names[r.agentId] || 'a deleted agent'} (${describeRuleHours(r)})`,
      words: 'dispatch rule routing telephony',
    })),
    ...data.trunks.map((t) => ({
      id: t.id,
      section: 'trunks' as const,
      title: t.name,
      description: `Sandbox ${t.direction} SIP trunk`,
      words: `sip trunk carrier telephony ${t.address}`,
    })),
  ];
}

/** The results for what this browser keeps now. */
export const sandboxTelephonyResults = (names: Record<string, string>): PaletteTelephony[] => telephonyResults(readTelephony(), names);
