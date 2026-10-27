// MY Business Banking (1300-88-7000 General, 1300 88 0255 Islamic, 1300-88-7200 Premier): a front desk and four specialists (design section 13,
// "Malaysia"). Callers log in with their key code and TPIN. The Premier line greets, sets the language and puts the caller through to the
// Premier desk; customer service executives take calls in office hours, otherwise the caller is offered a call-back.
import { backToFrontDesk, baseConfig, commonState, connections, endCall, httpTool, mustBeVerified, params, say, str } from './common.mjs';
import {
  coreTools,
  loginTask,
  loginTools,
  myAfter8pmHook,
  myCallbackTool,
  myEvening,
  myHours,
  myMessages,
  myNoAccount,
  myNotVerified,
  mySpecialist,
  myState,
  myTransfer,
  myTransferTool,
} from './myShared.mjs';

export function myBusinessBanking(mockUrl) {
  const c = baseConfig({
    id: 'my-business-banking',
    name: 'MY Business Banking',
    description:
      'OCBC Malaysia business banking phone lines (General, Islamic and Premier): balances, statements, own-account transfers, loan payments, cheques, FPX direct debits, rates, forms and branches, in English, Malay and Mandarin.',
    tags: ['ocbc', 'malaysia', 'business-banking', 'phone'],
    market: 'my',
    persona: 'OCBC Business Banking assistant',
  });
  c.connections = connections(mockUrl, { core: '/my/core', contact: '/my/contact' });
  c.schedules = { my_hours: myHours, my_evening: myEvening };
  c.events = [myAfter8pmHook];
  c.messages.push(
    say(
      'greeting',
      'Welcome to OCBC Business Banking. How may I help you? At any time, you can ask to speak to a customer service executive.',
      '欢迎致电华侨银行商业银行。请问有什么可以帮您？您可以随时要求与客户服务专员通话。',
      'Selamat datang ke OCBC Perbankan Perniagaan. Bagaimana saya boleh membantu? Anda boleh meminta untuk bercakap dengan eksekutif khidmat pelanggan pada bila-bila masa.',
    ),
    ...myMessages,
  );
  c.state = { variables: { ...commonState(), ...myState(), fpx: { type: 'array', default: [] } } };
  c.tasks = [
    loginTask({ id: 'verify_key_code', codeName: '8-digit key code', digits: 8, keypad: true }),
    loginTask({ id: 'verify_key_code', codeName: '8-digit key code', digits: 8, keypad: false }),
  ];
  const core = (...a) => httpTool('core', ...a);
  c.tools = [
    endCall,
    backToFrontDesk,
    ...loginTools('verify_key_code', 'key_code', 'Verify the caller with their key code and TPIN.'),
    ...coreTools(),
    core(
      'list_fpx_direct_debits',
      'The caller’s FPX direct debits.',
      { method: 'GET', path: '/fpx/{{state.cif}}' },
      { pre: [mustBeVerified], result: { to_llm: ['items'] } },
    ),
    core(
      'terminate_fpx_direct_debit',
      'End one FPX direct debit, after confirming which.',
      { method: 'POST', path: '/fpx/{{state.cif}}/{{args.direct_debit_id}}/terminate' },
      {
        parameters: params({ direct_debit_id: str('From list_fpx_direct_debits.') }),
        pre: [mustBeVerified],
        result: { to_llm: ['ok', 'reason'] },
      },
    ),
    core('list_forms', 'The forms that can be sent by fax.', { method: 'GET', path: '/forms' }, { result: { to_llm: ['items'] } }),
    core(
      'fax_form',
      'Fax a form.',
      { method: 'POST', path: '/fax', body: { fax_number: '{{args.fax_number}}', document_id: '{{args.form_id}}' } },
      {
        parameters: params({ fax_number: str('The fax number.'), form_id: str('From list_forms.') }),
        result: { to_llm: ['ok', 'job_id', 'reason'] },
      },
    ),
    myCallbackTool,
    myTransferTool(
      'to_service_executive',
      'service_executive',
      'Pass the caller to a customer service executive: banking transactions, Velocity, a lost card, trade or the SME hotline.',
    ),
    myTransferTool('to_premier_desk', 'premier_desk', 'Premier line callers: put them through to the Premier desk.'),
  ];
  c.telephony = {
    transfers: [
      myTransfer('service_executive', 'Customer service executives (business banking).', 'MY-BB'),
      myTransfer('premier_desk', 'The Premier desk.', 'MY-PREMIER'),
    ],
  };

  const verify = myNotVerified('verify_key_code');
  c.agents = {
    entry: 'front_desk',
    items: [
      {
        id: 'front_desk',
        name: 'Front desk',
        kind: 'router',
        instructions: {
          role: 'You answer OCBC Malaysia’s business banking lines (General and Islamic), find out what the caller needs, and pass them to the right specialist.',
          opening: 'The greeting has been said. Listen to what the caller needs.',
          rules: [
            'Answer in the caller’s language: English, Malay or Mandarin.',
            'Balances, recent activity, statements, a PIN change: Accounts. Transfers between own accounts, loan payments, FPX direct debits: Payments.',
            'Cheque status, stopping a cheque, a cheque book: Cheques. Branches, forms, FX, deposit and Islamic rates, the prime rate: Info Desk.',
            'A Premier customer, or someone who asks for a person: to_premier_desk for Premier, else to_service_executive.',
            'If the caller has nothing else, call end_call.',
          ],
          conditional: [
            {
              when: { state: 'pending_request', not_equals: null },
              append: 'The caller still needs: {{state.pending_request}}. Pass them on now without asking again.',
            },
          ],
        },
        tools: ['to_service_executive', 'to_premier_desk', 'request_callback', 'end_call'],
        handoffs: [
          {
            id: 'to_accounts',
            tool: 'go_to_accounts',
            description: 'Balances, recent activity, statements, PIN change.',
            to: 'accounts',
            carry_context: true,
            set_state: { intent: 'accounts' },
          },
          {
            id: 'to_payments',
            tool: 'go_to_payments',
            description: 'Transfers between own accounts, OCBC loan payments, FPX direct debits.',
            to: 'payments',
            carry_context: true,
            set_state: { intent: 'payments' },
          },
          {
            id: 'to_cheques',
            tool: 'go_to_cheques',
            description: 'Cheque status, stop payment, cheque book.',
            to: 'cheques',
            carry_context: true,
            set_state: { intent: 'cheques' },
          },
          {
            id: 'to_info_desk',
            tool: 'go_to_info_desk',
            description: 'Branches, forms, rates.',
            to: 'info_desk',
            carry_context: true,
            set_state: { intent: 'info_desk' },
          },
        ],
      },
      mySpecialist(
        'accounts',
        'Accounts',
        'You help verified business customers with balances, recent activity and statements of their savings, current and foreign currency accounts.',
        ['Verify first; then ask which account by its last four digits.'],
        [
          'verify_key_code_keypad',
          'verify_key_code_spoken',
          'choose_account',
          'get_balance',
          'list_recent_activity',
          'request_statement',
          'to_service_executive',
          'back_to_front_desk',
        ],
        [verify, myNoAccount],
      ),
      mySpecialist(
        'payments',
        'Payments',
        'You move money for verified business customers: transfers between their own accounts, OCBC loan payments, and their FPX direct debits.',
        [
          'Read back the amount and both accounts (by their last four digits), and get a yes before any transfer or payment.',
          'Instructions placed after 8 pm take effect the next day.',
        ],
        [
          'verify_key_code_keypad',
          'verify_key_code_spoken',
          'choose_account',
          'transfer_own_accounts',
          'pay_ocbc_loan',
          'list_fpx_direct_debits',
          'terminate_fpx_direct_debit',
          'to_service_executive',
          'back_to_front_desk',
        ],
        [verify, myNoAccount],
      ),
      mySpecialist(
        'cheques',
        'Cheques',
        'You help verified business customers with cheques: status, stop payment and cheque books.',
        ['Confirm the cheque number and the RM10 fee before stopping a cheque.'],
        [
          'verify_key_code_keypad',
          'verify_key_code_spoken',
          'choose_account',
          'get_issued_cheque_status',
          'stop_cheque_payment',
          'request_cheque_book',
          'to_service_executive',
          'back_to_front_desk',
        ],
        [verify, myNoAccount],
      ),
      mySpecialist(
        'info_desk',
        'Info Desk',
        'You answer general questions with no verification: branches, forms by fax, FX rates, deposit and foreign currency deposit rates, Islamic banking rates and the base rate.',
        ['Say rates exactly as the tool gives them; FX rates are indicative.'],
        ['get_rates', 'find_branch', 'list_forms', 'fax_form', 'back_to_front_desk'],
      ),
    ],
  };

  c.messages = c.messages.filter((m) => m.id !== 'unable_to_proceed');

  const login = { connection: 'core', method: 'POST', path: '/login' };
  c.tests = [
    {
      id: 'own_transfer_with_key_code',
      description: 'A caller logs in with key code and TPIN and moves RM5,000 between two current accounts after confirming.',
      channel: 'web-chat',
      http_mocks: [
        { ...login, body_contains: { tpin: '123456' }, json: { ok: true, cif: 'MY1001', line: 'business', iq_member: false } },
        { ...login, json: { ok: true, code_valid: true } },
        {
          connection: 'core',
          method: 'GET',
          path: '/customers/MY1001',
          json: {
            found: true,
            accounts: [
              { number: '7011223344', last4: '3344', type: 'Current Account', currency: 'MYR' },
              { number: '7099887766', last4: '7766', type: 'Current Account', currency: 'MYR' },
            ],
            loans: [],
          },
        },
        {
          connection: 'core',
          method: 'GET',
          path: '/customers/MY1001/accounts/3344',
          json: { found: true, number: '7011223344', last4: '3344', type: 'Current Account', currency: 'MYR' },
        },
        { connection: 'core', method: 'POST', path: '/transfers/own', json: { ok: true, reference: 'TRF-777001', new_balance_from: 251780.4 } },
      ],
      turns: [
        { say: 'I want to transfer money between my accounts.' },
        { say: '12345678' },
        { say: '123456' },
        { say: 'From 3344 to 7766, five thousand ringgit.' },
        { say: 'Yes, confirm.' },
      ],
      expect: [{ tool_called: 'transfer_own_accounts' }, { said_matches: 'TRF-777001' }],
    },
    {
      id: 'base_rate_no_login',
      description: 'Scripted (no model): rates need no login.',
      channel: 'web-chat',
      http_mocks: [{ connection: 'core', method: 'GET', path: '/rates', json: { base_rate: 3.0, blr: 6.68 } }],
      turns: [{ say: 'What is your base rate?' }],
      model_script: [{ tool: 'go_to_info_desk' }, { tool: 'get_rates' }, 'Our base rate is 3.00 per cent per annum.'],
      expect: [{ tool_called: 'get_rates' }, { tool_not_called: 'verify_key_code_spoken' }],
    },
  ];
  return c;
}
