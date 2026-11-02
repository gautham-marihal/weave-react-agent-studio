// The Telephony page's parts, each at its own address (/telephony/numbers), and what Live says about the parts the Agent
// Builder API does not offer. Pure: the page hands in the address and whether the studio runs in Sandbox.

export type TelephonySection = 'calls' | 'dispatch' | 'numbers' | 'trunks';

export interface TelephonySectionInfo {
  id: TelephonySection;
  label: string;
}

/** The parts, in the order of the tabs. Sandbox names the first one after what it holds. */
export const TELEPHONY_SECTIONS: TelephonySectionInfo[] = [
  { id: 'calls', label: 'Test calls' },
  { id: 'dispatch', label: 'Dispatch rules' },
  { id: 'numbers', label: 'Phone numbers' },
  { id: 'trunks', label: 'SIP trunks' },
];

export const isTelephonySection = (value: unknown): value is TelephonySection => TELEPHONY_SECTIONS.some((s) => s.id === value);

/**
 * The part an address opens. Sandbox opens on the test calls (as Weave React did); Live opens on the phone numbers, the
 * one part the API has. An unknown part opens the first one.
 */
export function telephonySection(param: string | undefined, sandbox: boolean): TelephonySection {
  if (isTelephonySection(param)) return param;
  return sandbox ? 'calls' : 'numbers';
}

/** A part's address. */
export const telephonyHref = (section: TelephonySection): string => `/telephony/${section}`;

/** What Live says about a part the Agent Builder API does not offer yet (the phone numbers are real and listed). */
export interface NotOffered {
  title: string;
  body: string;
}

export const LIVE_NOT_OFFERED: Record<Exclude<TelephonySection, 'numbers'>, NotOffered> = {
  calls: {
    title: 'Test calls through your routing aren’t offered yet',
    body: 'The Agent Builder API has no way to run a call through dispatch rules and hold limits to see who would answer and how long a caller would wait. Real calls, from callers and from tests, are on the Calls page.',
  },
  dispatch: {
    title: 'Dispatch rules aren’t offered yet',
    body: 'The Agent Builder API has no endpoint for dispatch rules. When a phone number is set up under Phone numbers, the server makes the one rule that sends its calls to the agent and environment you chose. Business hours, caller-prefix routing, priority, hold limits, hold messages and overflow to another agent are not features of the platform yet.',
  },
  trunks: {
    title: 'SIP trunks aren’t offered yet',
    body: 'The Agent Builder API has no endpoint for SIP trunks. The trunk a phone number needs is made for you when the number is set up under Phone numbers; any other trunk is made on the phone system, outside Studio.',
  },
};

/** Where to try the parts Live does not have. */
export const TRY_IN_SANDBOX = 'You can try this in Sandbox (switch at the top of the page): its numbers, rules and trunks are kept in this browser and route no real call.';
