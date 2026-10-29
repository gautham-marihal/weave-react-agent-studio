// The guided rehearsal scenarios and how each is judged. A scenario passes only on what the gateway actually did in
// this session (tool results, sign-in states, keypad outcomes, confirmation outcomes), never on what was typed.

export type RunEvent =
  | { type: 'greeted' }
  | { type: 'tool'; tool: string; ok: boolean; code?: string; account?: boolean }
  | { type: 'auth'; state: string; method?: string | null; reason?: string | null }
  | { type: 'capture'; purpose: string; accepted: boolean; via: 'voice' | 'chat' | 'keypad' }
  | { type: 'confirmation'; outcome: string }
  | { type: 'gateway_unreachable' }
  | { type: 'reveal' }
  | { type: 'hide' };

export type ScenarioStatus = 'not_run' | 'in_progress' | 'passed';

export interface Scenario {
  id: string;
  title: string;
  login: string | null;
  steps: string[];
}

export interface ScenarioResult {
  status: ScenarioStatus;
  /** What was seen so far, in plain words. */
  note: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'greeting',
    title: 'Greeting and what the assistant can do',
    login: null,
    steps: ['Start a conversation and listen to the greeting.', 'Ask "What can you do?"'],
  },
  {
    id: 'phone_login',
    title: 'Sign in with Phone Code and PIN',
    login: 'phonecode_pin',
    steps: ['Ask "What\'s my balance?"', 'Choose Phone Code and PIN, then give the Phone Code.', 'Key in (or say) the PIN.'],
  },
  {
    id: 'otp_login',
    title: 'Sign in with account number, NRIC and OTP',
    login: 'account_nric_otp',
    steps: ['Ask for a balance and choose account number + NRIC + OTP.', 'Key in the NRIC digits.', 'Key in the OTP from the mock phone.'],
  },
  {
    id: 'balance',
    title: 'Balance enquiry',
    login: 'phonecode_pin',
    steps: ['After signing in, ask "What\'s my balance?"', 'Check current, available, hold and pending amounts on the card.'],
  },
  {
    id: 'multi_account',
    title: 'Choose between several accounts',
    login: 'phonecode_pin',
    steps: ['With the three-account login, ask for a balance.', 'Pick an account by clicking it or saying "the one ending 0102".'],
  },
  { id: 'transactions', title: 'Recent transactions', login: 'phonecode_pin', steps: ['Ask "Show me my recent transactions."'] },
  {
    id: 'lockout',
    title: 'Wrong PIN and lockout',
    login: 'phonecode_pin',
    steps: ['Give the Phone Code, then a wrong PIN three times.', 'The gateway locks sign-in with its own wording.'],
  },
  {
    id: 'unauthorised',
    title: 'Service not allowed for this login',
    login: 'account_nric_otp',
    steps: ['Sign in as the Authorised Contact.', 'Ask for a balance: the gateway refuses it for this access level.'],
  },
  {
    id: 'confirmation',
    title: 'Confirm one request, cancel another',
    login: 'account_nric_otp',
    steps: ['As the Authorised Signatory, say "Stop cheque 100060" and confirm.', 'Ask for a statement for last month and say "no".'],
  },
  {
    id: 'failure',
    title: 'Bank system failure',
    login: null,
    steps: ['Arm a fault under "Break the next bank system call".', 'Ask for the matching service and hear the honest failure.'],
  },
  {
    id: 'pin_modes',
    title: 'Spoken and keyed PIN entry',
    login: 'phonecode_pin',
    steps: ['Sign in once saying the PIN in a voice call.', 'Start over and sign in keying the PIN.'],
  },
  {
    id: 'masking',
    title: 'Account number masking (eye icon)',
    login: 'phonecode_pin',
    steps: ['After signing in, click the eye beside an account number.', 'Click it again to hide it.'],
  },
];

const HOST_FAILURE = (code: string | undefined) =>
  Boolean(code && (code.includes(':') || code === 'timeout' || code === 'internal' || code === 'outcome_unknown'));

export function evaluate(id: string, events: readonly RunEvent[]): ScenarioResult {
  const tools = events.filter((e): e is Extract<RunEvent, { type: 'tool' }> => e.type === 'tool');
  const auths = events.filter((e): e is Extract<RunEvent, { type: 'auth' }> => e.type === 'auth');
  const captures = events.filter((e): e is Extract<RunEvent, { type: 'capture' }> => e.type === 'capture');
  const confirmations = events.filter((e): e is Extract<RunEvent, { type: 'confirmation' }> => e.type === 'confirmation');
  const okTool = (name: string) => tools.some((t) => t.tool === name && t.ok);
  const verified = (method: string) => auths.some((a) => a.state === 'authenticated' && a.method === method);
  const notRun: ScenarioResult = { status: 'not_run', note: 'Not tried in this session yet.' };

  switch (id) {
    case 'greeting':
      if (events.some((e) => e.type === 'greeted') && okTool('list_services'))
        return { status: 'passed', note: 'Greeted, and the gateway listed the services.' };
      return events.some((e) => e.type === 'greeted') ? { status: 'in_progress', note: 'Greeted. Ask what the assistant can do.' } : notRun;
    case 'phone_login':
    case 'otp_login': {
      const method = id === 'phone_login' ? 'phonecode_pin' : 'account_nric_otp';
      if (verified(method)) return { status: 'passed', note: 'The gateway verified the caller.' };
      const started = auths.some((a) => (method === 'phonecode_pin' ? a.state === 'awaiting_pin' : a.state === 'awaiting_nric' || a.state === 'awaiting_otp'));
      return started ? { status: 'in_progress', note: 'Sign-in started; not verified yet.' } : notRun;
    }
    case 'balance': {
      if (okTool('get_balance')) return { status: 'passed', note: 'The gateway returned a balance.' };
      const last = [...tools].reverse().find((t) => t.tool === 'get_balance');
      return last ? { status: 'in_progress', note: `Last attempt: ${last.code ?? 'refused'}.` } : notRun;
    }
    case 'multi_account': {
      const asked = tools.findIndex((t) => !t.ok && t.code === 'choose_account');
      if (asked >= 0 && tools.slice(asked + 1).some((t) => t.ok && t.account))
        return { status: 'passed', note: 'Asked which account, then answered for the chosen one.' };
      return asked >= 0 ? { status: 'in_progress', note: 'The gateway asked which account. Choose one.' } : notRun;
    }
    case 'transactions':
      if (okTool('get_recent_transactions')) return { status: 'passed', note: 'The gateway returned recent transactions.' };
      return tools.some((t) => t.tool === 'get_recent_transactions') ? { status: 'in_progress', note: 'Asked; no transactions returned yet.' } : notRun;
    case 'lockout': {
      if (auths.some((a) => a.state === 'locked' && a.reason === 'too_many_failures')) return { status: 'passed', note: 'Wrong attempts locked sign-in.' };
      const wrong = captures.filter((c) => !c.accepted).length;
      return wrong ? { status: 'in_progress', note: `${wrong} wrong ${wrong === 1 ? 'entry' : 'entries'} so far; not locked yet.` } : notRun;
    }
    case 'unauthorised':
      if (tools.some((t) => t.code === 'not_entitled' || t.code === 'no_eligible_account'))
        return { status: 'passed', note: 'The gateway refused a service this login may not use.' };
      return verified('account_nric_otp') ? { status: 'in_progress', note: 'Signed in. Ask for a balance.' } : notRun;
    case 'confirmation': {
      const confirmed = confirmations.some((c) => c.outcome === 'confirmed');
      const cancelled = confirmations.some((c) => c.outcome === 'cancelled');
      if (confirmed && cancelled) return { status: 'passed', note: 'One request completed, one cancelled; nothing ran without a clear yes.' };
      if (confirmed || cancelled)
        return { status: 'in_progress', note: confirmed ? 'Confirmed one. Now cancel another.' : 'Cancelled one. Now confirm another.' };
      return tools.some((t) => t.tool.startsWith('prepare_') && t.ok) ? { status: 'in_progress', note: 'A request is waiting for confirmation.' } : notRun;
    }
    case 'failure':
      if (
        tools.some((t) => HOST_FAILURE(t.code)) ||
        confirmations.some((c) => c.outcome === 'failed' || c.outcome === 'unknown') ||
        events.some((e) => e.type === 'gateway_unreachable')
      ) {
        return { status: 'passed', note: 'A failure was reported honestly, with no success claimed.' };
      }
      return notRun;
    case 'pin_modes': {
      const spoken = captures.some((c) => c.accepted && c.via === 'voice');
      const keyed = captures.some((c) => c.accepted && c.via !== 'voice');
      if (spoken && keyed) return { status: 'passed', note: 'Accepted once spoken and once keyed.' };
      if (spoken || keyed)
        return { status: 'in_progress', note: spoken ? 'Spoken entry accepted. Try a keyed one.' : 'Keyed entry accepted. Try a spoken one in a voice call.' };
      return notRun;
    }
    case 'masking': {
      const shown = events.findIndex((e) => e.type === 'reveal');
      if (shown >= 0 && events.slice(shown + 1).some((e) => e.type === 'hide')) return { status: 'passed', note: 'Shown on request, then hidden again.' };
      return shown >= 0 ? { status: 'in_progress', note: 'Shown. Click the eye again to hide it.' } : notRun;
    }
    default:
      return notRun;
  }
}
