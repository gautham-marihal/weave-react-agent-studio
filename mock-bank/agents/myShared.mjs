// What the two Malaysia agents share (design section 13, "Malaysia"): logging in with a code and a TPIN, the account, payment, cheque, rate and
// branch tools on the core banking system (/my/core), and hand-overs and call-backs through the contact centre (/my/contact).
import { PHONE, WEB, collect, httpTool, mustBeVerified, mustHaveAccount, num, onDecline, onFailure, onSuccess, params, say, str } from './common.mjs';

export const myHours = {
  description: 'When customer service executives take transferred calls (assumed 9:00 am to 6:00 pm, Monday to Friday: the call-flow pack gives no hours).',
  timezone: 'Asia/Kuala_Lumpur',
  weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' }],
  holidays: ['2026-12-25', '2027-01-01'],
};

// payments placed between 8 pm and midnight take effect the next day (p. 51)
export const myEvening = {
  description: 'From 8 pm to midnight, when payment instructions take effect the next day.',
  timezone: 'Asia/Kuala_Lumpur',
  weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start: '20:00', end: '23:59' }],
};
export const myAfter8pmHook = {
  on: 'handoff',
  when: {
    all: [
      { state: 'intent', equals: 'payments' },
      { schedule: 'my_evening', open: true },
    ],
  },
  do: [{ type: 'say', text: { message: 'after_8pm' } }],
};

export const myMessages = [
  say(
    'closed_hours',
    'Our customer service executives are available from 9 am to 6 pm, Monday to Friday. I can arrange for them to call you back.',
    '我们的客户服务专员服务时间为星期一至星期五上午9点至下午6点。我可以安排他们给您回电。',
    'Eksekutif khidmat pelanggan kami boleh dihubungi dari 9 pagi hingga 6 petang, Isnin hingga Jumaat. Saya boleh aturkan panggilan semula.',
  ),
  say(
    'connecting',
    'Please hold while we connect you to our customer service executive.',
    '请稍候，我们正在为您转接客户服务专员。',
    'Sila tunggu sementara kami menyambungkan anda kepada eksekutif khidmat pelanggan kami.',
  ),
  say(
    'after_8pm',
    'Please note that instructions placed after 8 pm will be effective for tomorrow.',
    '请注意，晚上8点后发出的指示将于明天生效。',
    'Sila ambil perhatian bahawa arahan selepas jam 8 malam akan berkuat kuasa esok.',
  ),
];

export function myState() {
  return {
    code: { type: 'string', nullable: true, default: null, sensitive: true, description: 'The key code or phone code keyed in.' },
    tpin: { type: 'string', nullable: true, default: null, sensitive: true },
    line: { type: 'string', default: '', description: 'business or consumer, from the login.' },
    iq_member: { type: 'boolean', default: false },
    accounts: { type: 'array', default: [] },
    loans: { type: 'array', default: [] },
    selected_account: { type: 'string', nullable: true, default: null },
    selected_account_last4: { type: 'string', nullable: true, default: null },
  };
}

// Log in with a code (key code for Business Banking, phone code or 12-digit IC for Consumer) and the 6-digit TPIN, then load the customer.
export function loginTask({ id, codeName, digits, keypad }) {
  return {
    id: keypad ? `${id}_keypad` : `${id}_spoken`,
    kind: 'verification',
    description: `Confirm who the caller is with their ${codeName} and TPIN, then load their accounts.`,
    instructions:
      'You are one short step in a call: confirm who the caller is. Each answer is checked by a tool; never repeat a code, and talk about nothing else.',
    use_prior_context: true,
    attempts_scope: 'task',
    steps: [
      collect('code', keypad ? `Ask them to key in their ${codeName}, then the hash key.` : `Ask for their ${codeName}.`, {
        keypad,
        digits,
        storeIn: 'code',
        validate: { type: 'tool', tool: 'check_code', ...(keypad ? { args: { code: '{{value}}' } } : {}) },
        passWhen: { result: '$.ok', equals: true },
      }),
      collect('tpin', keypad ? 'Ask them to key in their 6-digit telephone PIN.' : 'Ask for their 6-digit telephone PIN.', {
        keypad,
        digits: 6,
        storeIn: 'tpin',
        validate: { type: 'tool', tool: 'check_tpin', ...(keypad ? { args: { tpin: '{{value}}' } } : {}) },
        passWhen: { result: '$.ok', equals: true },
      }),
      {
        id: 'customer',
        type: 'call',
        do: [{ type: 'http', connection: 'core', method: 'GET', path: '/customers/{{state.cif}}', to_state: { accounts: '$.accounts', loans: '$.loans' } }],
      },
    ],
    max_attempts: 3,
    inactivity: { timeout_s: 30 },
    on_success: onSuccess,
    on_failure: onFailure,
    on_decline: onDecline,
  };
}

export function loginTools(taskId, codeKey, description) {
  const core = (...a) => httpTool('core', ...a);
  return [
    { id: `${taskId}_keypad`, name: taskId, type: 'task', task: `${taskId}_keypad`, channels: PHONE, description },
    { id: `${taskId}_spoken`, name: taskId, type: 'task', task: `${taskId}_spoken`, channels: WEB, description },
    core(
      'check_code',
      'Check the code just given.',
      { method: 'POST', path: '/login', body: { [codeKey]: '{{args.code}}' } },
      { parameters: params({ code: str('The digits.') }), result: { to_llm: ['ok', 'reason'] } },
    ),
    core(
      'check_tpin',
      'Check the TPIN for the code just given.',
      { method: 'POST', path: '/login', body: { [codeKey]: '{{state.code}}', tpin: '{{args.tpin}}' } },
      {
        parameters: params({ tpin: str('Six digits.') }),
        result: { to_llm: ['ok', 'reason'], to_state: { cif: '$.cif', line: '$.line', iq_member: '$.iq_member' } },
      },
    ),
  ];
}

// The account, payment, cheque, rate and branch tools both lines use
export function coreTools() {
  const core = (...a) => httpTool('core', ...a);
  const pre = [mustBeVerified, mustHaveAccount];
  return [
    core(
      'choose_account',
      'Choose which of the caller’s accounts to act on, by its last four digits.',
      { method: 'GET', path: '/customers/{{state.cif}}/accounts/{{args.last4}}' },
      {
        parameters: params({ last4: str('The last four digits of the account.') }),
        pre: [mustBeVerified],
        result: { to_llm: ['found', 'last4', 'type', 'currency', 'cheques'], to_state: { selected_account: '$.number', selected_account_last4: '$.last4' } },
      },
    ),
    core(
      'get_balance',
      'The balance of the chosen account.',
      { method: 'GET', path: '/accounts/{{state.selected_account}}/balance' },
      { pre, result: { to_llm: ['account_last4', 'type', 'currency', 'balance'] } },
    ),
    core(
      'list_recent_activity',
      'The last five transactions on the chosen account.',
      { method: 'GET', path: '/accounts/{{state.selected_account}}/history' },
      { pre, result: { to_llm: ['items'] } },
    ),
    core(
      'request_statement',
      'Ask for a statement of the chosen account to be posted.',
      { method: 'POST', path: '/accounts/{{state.selected_account}}/statements', body: { month: '{{args.month}}' } },
      {
        parameters: params({ month: str('The statement month, YYYY-MM.') }),
        pre,
        result: { to_llm: ['reference', 'arrives_in_days'] },
      },
    ),
    core(
      'transfer_own_accounts',
      'Move money between two of the caller’s own accounts in the same currency. Read back the amount and both accounts, and get a yes first.',
      {
        method: 'POST',
        path: '/transfers/own',
        body: { from_account: '{{state.selected_account}}', to_account: '{{args.to_account}}', amount: '{{args.amount}}' },
      },
      {
        parameters: params({
          to_account: str('The full number of the receiving account, from the caller’s accounts list.'),
          amount: num('Amount in the account’s currency.'),
        }),
        pre,
        result: { to_llm: ['ok', 'reference', 'reason', 'new_balance_from'] },
      },
    ),
    core(
      'pay_ocbc_loan',
      'Pay an OCBC loan or financing from the chosen account. Name the loan and the amount, and get a yes first.',
      {
        method: 'POST',
        path: '/payments/loan',
        body: { from_account: '{{state.selected_account}}', reference: '{{args.loan_id}}', amount: '{{args.amount}}' },
      },
      {
        parameters: params({ loan_id: str('From the caller’s loans list.'), amount: num('Amount in MYR.') }),
        pre: [
          ...pre,
          {
            require: { state: 'loans', not_equals: [] },
            on_fail: { tool_error: 'The caller has no loan. Say: "Sorry, you do not have any loan account with OCBC Bank."' },
          },
        ],
        result: { to_llm: ['ok', 'reference', 'reason', 'new_balance'] },
      },
    ),
    core(
      'get_issued_cheque_status',
      'Whether a cheque the caller issued has been paid or not presented yet.',
      { method: 'GET', path: '/cheques/{{state.selected_account}}/{{args.cheque_no}}' },
      {
        parameters: params({ cheque_no: str('The six-digit cheque number.') }),
        pre,
        result: { to_llm: ['found', 'status', 'amount', 'paid_on'] },
      },
    ),
    core(
      'stop_cheque_payment',
      'Stop a cheque (RM10). Confirm the cheque number and fee first.',
      { method: 'POST', path: '/cheques/{{state.selected_account}}/stop', body: { cheque_no: '{{args.cheque_no}}' } },
      {
        parameters: params({ cheque_no: str('The six-digit cheque number.') }),
        pre,
        result: { to_llm: ['ok', 'fee_myr', 'reference'] },
      },
    ),
    core(
      'request_cheque_book',
      'Order a cheque book for the chosen account.',
      { method: 'POST', path: '/accounts/{{state.selected_account}}/cheque-book' },
      { pre, result: { to_llm: ['ok', 'reference', 'ready_in_working_days'] } },
    ),
    core(
      'get_rates',
      'Malaysia rates: base rate, BLR, Islamic BFR, fixed deposit and foreign currency deposit rates, and indicative FX.',
      { method: 'GET', path: '/rates' },
      {
        result: { to_llm: ['base_rate', 'blr', 'islamic_bfr', 'fd', 'fcy_fd', 'fx'] },
      },
    ),
    core(
      'find_branch',
      'Find branches by area or name.',
      { method: 'GET', path: '/branches', query: { q: '{{args.query}}' } },
      { parameters: params({ query: str('An area or branch name.') }), result: { to_llm: ['items'] } },
    ),
  ];
}

export const myCallbackTool = httpTool(
  'contact',
  'request_callback',
  'Ask a customer service executive to call the caller back.',
  { method: 'POST', path: '/callbacks', body: { caller: '{{state.caller_number}}', number: '{{args.number}}', reason: '{{state.intent}}' } },
  {
    parameters: params({ number: str('The number to call back: the caller ID unless they give another.') }),
    result: { to_llm: ['ok', 'request_id', 'reason'] },
    extraEffects: [{ when: { result: '$.ok', equals: true }, do: [{ type: 'say', text: { message: 'callback_saved' } }, { type: 'end_call' }] }],
  },
);

// a hand-over into a contact-centre queue
export function myTransfer(id, description, queue) {
  return {
    id,
    description,
    method: 'http_request',
    target: queue,
    request: {
      connection: 'contact',
      method: 'POST',
      path: '/transfer',
      body: { skillset: '{{target}}', cif: '{{state.cif}}', intent: '{{state.intent}}', language: '{{state.language}}' },
    },
    schedule: 'my_hours',
    closed: [{ type: 'say', text: { message: 'closed_hours' } }],
    before: [{ type: 'say', text: { message: 'connecting' } }],
    delay_s: 1,
    on_failure: [{ type: 'say', text: { message: 'host_error' } }],
  };
}

export function myTransferTool(id, transfer, description) {
  return {
    id,
    type: 'builtin',
    builtin: 'transfer_or_callback',
    description,
    params: { transfer, fallback: [{ type: 'say', text: { message: 'closed_hours' } }] },
  };
}

export function mySpecialist(id, name, role, rules, tools, conditional = []) {
  return {
    id,
    name,
    kind: 'specialist',
    instructions: {
      role,
      opening: 'Acknowledge what they need in a few words.',
      rules: [
        ...rules,
        'Answer in the caller’s language (English, Malay or Mandarin).',
        'When the request is done, ask if there is anything else; for something outside your role, use back_to_front_desk.',
      ],
      ...(conditional.length ? { conditional } : {}),
    },
    tools,
  };
}

export const myNotVerified = (tool) => ({
  when: { state: 'verified', equals: false },
  append: `The caller is not verified yet: use ${tool} before any account tool.`,
});
export const myNoAccount = {
  when: { state: 'selected_account', equals: null },
  append: 'Before any account tool, ask which account (their accounts: {{state.accounts}}), by its last four digits, and use choose_account.',
};
