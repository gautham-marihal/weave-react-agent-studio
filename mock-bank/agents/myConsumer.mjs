// MY Consumer (CFS: 1300 88 5000 Mass and iQ, 1300 88 0310 Al-Amin): a front desk and three specialists (design section 13, "Malaysia"). Callers
// log in with their phone code (or 12-digit IC) and TPIN. iQ members can ask for their iQ service executive, who is reached after the same login.
import { backToFrontDesk, baseConfig, commonState, connections, endCall, httpTool, mustBeVerified, mustHaveAccount, num, params, say, str } from './common.mjs';
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

export function myConsumer(mockUrl) {
  const c = baseConfig({
    id: 'my-consumer-banking',
    name: 'MY Consumer Banking',
    description:
      'OCBC Malaysia consumer banking phone lines (Mass and iQ, Al-Amin): credit cards (activation, fee waiver, credit limit, balance transfer, statements, applications), banking enquiries and payments, in English, Malay and Mandarin.',
    tags: ['ocbc', 'malaysia', 'consumer-banking', 'cards', 'phone'],
    market: 'my',
    persona: 'OCBC assistant',
  });
  c.connections = connections(mockUrl, { core: '/my/core', contact: '/my/contact' });
  c.schedules = { my_hours: myHours, my_evening: myEvening };
  c.events = [myAfter8pmHook];
  c.messages.push(
    say(
      'greeting',
      'Welcome to OCBC Bank. How may I help you today? You can ask about your credit card, your accounts, or a payment.',
      '欢迎致电华侨银行。请问今天有什么可以帮您？您可以查询信用卡、账户或付款。',
      'Selamat datang ke OCBC Bank. Bagaimana saya boleh membantu anda hari ini? Anda boleh bertanya tentang kad kredit, akaun atau pembayaran.',
    ),
    ...myMessages,
  );
  c.state = { variables: { ...commonState(), ...myState(), card_last4: { type: 'string', nullable: true, default: null } } };
  c.tasks = [
    loginTask({ id: 'verify_phone_code', codeName: '8-digit phone code or 12-digit IC number', digits: 12, keypad: true }),
    loginTask({ id: 'verify_phone_code', codeName: '8-digit phone code or 12-digit IC number', digits: 12, keypad: false }),
  ];
  // a phone code has 8 digits, an IC 12: on the keypad the caller ends either with #
  c.tasks[0].steps[0].dtmf = { num_digits: 12, terminator: '#', timeout_s: 15 };

  const core = (...a) => httpTool('core', ...a);
  const cardPre = [
    mustBeVerified,
    { require: { state: 'card_last4', not_equals: null }, on_fail: { tool_error: 'Ask which card, by its last four digits, and use choose_card first.' } },
  ];
  c.tools = [
    endCall,
    backToFrontDesk,
    ...loginTools('verify_phone_code', 'phone_code', 'Verify the caller with their phone code (or IC number) and TPIN.'),
    ...coreTools(),
    // cards (credit card services, p. 50)
    core(
      'choose_card',
      'Choose which of the caller’s cards to act on, by its last four digits.',
      { method: 'GET', path: '/cards/{{args.last4}}' },
      {
        parameters: params({ last4: str('The last four digits of the card.') }),
        pre: [mustBeVerified],
        result: { to_llm: ['found', 'product', 'status'], to_state: { card_last4: '$.last4' } },
      },
    ),
    core(
      'get_card_summary',
      'The card’s balance, minimum payment, due date and limit.',
      { method: 'GET', path: '/cards/{{state.card_last4}}' },
      {
        pre: cardPre,
        result: { to_llm: ['product', 'status', 'limit', 'balance', 'minimum_due', 'due'] },
      },
    ),
    core(
      'activate_card',
      'Activate the caller’s new card.',
      { method: 'POST', path: '/cards/{{state.card_last4}}/activate' },
      { pre: cardPre, result: { to_llm: ['ok', 'status', 'reason'] } },
    ),
    core(
      'request_fee_waiver',
      'Ask for this year’s annual fee to be waived.',
      { method: 'POST', path: '/cards/{{state.card_last4}}/fee-waiver' },
      { pre: cardPre, result: { to_llm: ['ok', 'reference', 'reason'] } },
    ),
    core(
      'change_credit_limit',
      'Change the card’s credit limit. A lower limit is immediate; a higher one is reviewed within 3 working days.',
      { method: 'POST', path: '/cards/{{state.card_last4}}/credit-limit', body: { new_limit: '{{args.new_limit}}' } },
      {
        parameters: params({ new_limit: num('The new limit in MYR.') }),
        pre: cardPre,
        result: { to_llm: ['ok', 'outcome', 'note', 'limit', 'reference', 'reason'] },
      },
    ),
    core(
      'card_balance_transfer',
      'Move a balance from another bank’s card onto this card.',
      { method: 'POST', path: '/cards/{{state.card_last4}}/balance-transfer', body: { amount: '{{args.amount}}', from_bank: '{{args.from_bank}}' } },
      {
        parameters: params({ amount: num('Amount in MYR.'), from_bank: str('The other bank.') }),
        pre: cardPre,
        result: { to_llm: ['ok', 'reference', 'reason'] },
      },
    ),
    core(
      'get_application_status',
      'The status of a card application, by the applicant’s 12-digit IC number.',
      { method: 'GET', path: '/card-applications/{{args.ic}}' },
      {
        parameters: params({ ic: str('Twelve digits.') }),
        result: { to_llm: ['found', 'status', 'card', 'sent_on'] },
      },
    ),
    // payments (p. 50)
    core(
      'pay_credit_card',
      'Pay the caller’s OCBC credit card from the chosen account. Confirm the amount first.',
      {
        method: 'POST',
        path: '/payments/credit_card',
        body: { from_account: '{{state.selected_account}}', payee: '{{state.card_last4}}', amount: '{{args.amount}}' },
      },
      {
        parameters: params({ amount: num('Amount in MYR.') }),
        pre: [mustBeVerified, mustHaveAccount],
        result: { to_llm: ['ok', 'reference', 'reason', 'new_balance'] },
      },
    ),
    core(
      'pay_utility_bill',
      'Pay a utility bill the caller has registered. Name the bill and the amount, and get a yes first.',
      { method: 'POST', path: '/payments/utility', body: { from_account: '{{state.selected_account}}', payee: '{{args.bill}}', amount: '{{args.amount}}' } },
      {
        parameters: params({ bill: str('The registered bill, e.g. TNB-221144.'), amount: num('Amount in MYR.') }),
        pre: [mustBeVerified, mustHaveAccount],
        result: { to_llm: ['ok', 'reference', 'reason', 'new_balance'] },
      },
    ),
    core(
      'interbank_giro',
      'Send money to another bank’s account by Interbank GIRO. Read back the bank, the account and the amount, and get a yes first.',
      {
        method: 'POST',
        path: '/payments/giro',
        body: { from_account: '{{state.selected_account}}', payee: '{{args.bank}} {{args.account}}', amount: '{{args.amount}}' },
      },
      {
        parameters: params({ bank: str('The receiving bank.'), account: str('The receiving account number.'), amount: num('Amount in MYR.') }),
        pre: [mustBeVerified, mustHaveAccount],
        result: { to_llm: ['ok', 'reference', 'reason', 'new_balance'] },
      },
    ),
    myCallbackTool,
    myTransferTool(
      'to_service_executive',
      'service_executive',
      'Pass the caller to a customer service executive: a lost card, account services, card services, housing loans, other services.',
    ),
    myTransferTool('to_iq_executive', 'iq_executive', 'An iQ member who asks for their iQ service executive: once logged in, put them through.'),
  ];
  c.telephony = {
    transfers: [
      myTransfer('service_executive', 'Customer service executives (consumer).', 'MY-CFS'),
      { ...myTransfer('iq_executive', 'The iQ service executive team.', 'MY-IQ'), schedule: undefined, closed: undefined },
    ],
  };
  // iQ executives answer around the clock (no schedule)
  c.telephony.transfers[1] = Object.fromEntries(Object.entries(c.telephony.transfers[1]).filter(([, v]) => v !== undefined));

  const verify = myNotVerified('verify_phone_code');
  c.agents = {
    entry: 'front_desk',
    items: [
      {
        id: 'front_desk',
        name: 'Front desk',
        kind: 'router',
        instructions: {
          role: 'You answer OCBC Malaysia’s consumer banking lines, find out what the caller needs, and pass them to the right specialist.',
          opening: 'The greeting has been said. Listen to what the caller needs.',
          rules: [
            'Answer in the caller’s language: English, Malay or Mandarin.',
            'Credit cards (activation, fee waiver, credit limit, balance transfer, balance and statement, application status): Cards.',
            'Account balance, cheques, statements, rates, branches, a PIN change: Banking. Transfers to own accounts, loan, card and bill payments, Interbank GIRO: Payments.',
            'An iQ member who wants their iQ service executive: verify_phone_code first, then to_iq_executive.',
            'A lost card, or someone who asks for a person: to_service_executive.',
            'If the caller has nothing else, call end_call.',
          ],
          conditional: [
            {
              when: { state: 'pending_request', not_equals: null },
              append: 'The caller still needs: {{state.pending_request}}. Pass them on now without asking again.',
            },
          ],
        },
        tools: ['verify_phone_code_keypad', 'verify_phone_code_spoken', 'to_iq_executive', 'to_service_executive', 'request_callback', 'end_call'],
        handoffs: [
          { id: 'to_cards', tool: 'go_to_cards', description: 'Credit card services.', to: 'cards', carry_context: true, set_state: { intent: 'cards' } },
          {
            id: 'to_banking',
            tool: 'go_to_banking',
            description: 'Balances, cheques, statements, rates, branches, PIN change.',
            to: 'banking',
            carry_context: true,
            set_state: { intent: 'banking' },
          },
          {
            id: 'to_payments',
            tool: 'go_to_payments',
            description: 'Transfers and payments.',
            to: 'payments',
            carry_context: true,
            set_state: { intent: 'payments' },
          },
        ],
      },
      mySpecialist(
        'cards',
        'Cards',
        'You help verified customers with their OCBC credit cards: activation, fee waivers, credit limit changes, balance transfers, balance and statement, and application status.',
        [
          'Verify first; then ask which card by its last four digits (choose_card). Application status needs only the IC number.',
          'Confirm before changing a limit or moving a balance.',
        ],
        [
          'verify_phone_code_keypad',
          'verify_phone_code_spoken',
          'choose_card',
          'get_card_summary',
          'activate_card',
          'request_fee_waiver',
          'change_credit_limit',
          'card_balance_transfer',
          'get_application_status',
          'to_service_executive',
          'back_to_front_desk',
        ],
        [verify],
      ),
      mySpecialist(
        'banking',
        'Banking',
        'You answer banking enquiries: balances, cheque services and statements (after login), and rates and branches (no login needed).',
        ['Rates and branches need no login.'],
        [
          'verify_phone_code_keypad',
          'verify_phone_code_spoken',
          'choose_account',
          'get_balance',
          'list_recent_activity',
          'request_statement',
          'get_issued_cheque_status',
          'stop_cheque_payment',
          'request_cheque_book',
          'get_rates',
          'find_branch',
          'to_service_executive',
          'back_to_front_desk',
        ],
        [verify, myNoAccount],
      ),
      mySpecialist(
        'payments',
        'Payments',
        'You move money for verified customers: transfers to their own accounts, OCBC loan or financing, credit card and utility bill payments, and Interbank GIRO.',
        [
          'Read back the amount, the paying account (last four digits) and the payee, and get a yes before any payment.',
          'Instructions placed after 8 pm take effect the next day.',
        ],
        [
          'verify_phone_code_keypad',
          'verify_phone_code_spoken',
          'choose_account',
          'transfer_own_accounts',
          'pay_ocbc_loan',
          'pay_credit_card',
          'pay_utility_bill',
          'interbank_giro',
          'to_service_executive',
          'back_to_front_desk',
        ],
        [verify, myNoAccount],
      ),
    ],
  };
  c.messages = c.messages.filter((m) => m.id !== 'unable_to_proceed');

  const login = { connection: 'core', method: 'POST', path: '/login' };
  const loggedIn = [
    { ...login, body_contains: { tpin: '654321' }, json: { ok: true, cif: 'MY2002', line: 'consumer', iq_member: true } },
    { ...login, json: { ok: true, code_valid: true } },
    {
      connection: 'core',
      method: 'GET',
      path: '/customers/MY2002',
      json: { found: true, accounts: [{ number: '7022334455', last4: '4455', type: 'Savings Account', currency: 'MYR' }], loans: [{ id: 'HL-8810' }] },
    },
  ];
  c.tests = [
    {
      id: 'activate_card',
      description: 'A caller logs in and activates the new card ending 4321.',
      channel: 'web-chat',
      http_mocks: [
        ...loggedIn,
        {
          connection: 'core',
          method: 'GET',
          path: '/cards/4321',
          json: { found: true, last4: '4321', product: 'OCBC Titanium MasterCard', status: 'inactive' },
        },
        { connection: 'core', method: 'POST', path: '/cards/4321/activate', json: { ok: true, status: 'active', reference: 'CRD-500001' } },
      ],
      turns: [{ say: 'I want to activate my new credit card.' }, { say: '87654321' }, { say: '654321' }, { say: 'The one ending 4321.' }],
      expect: [{ tool_called: 'activate_card' }, { judge: 'Says the card ending 4321 is now active and never repeats the phone code or TPIN.' }],
    },
    {
      id: 'iq_member_to_executive',
      description: 'An iQ member asks for their iQ service executive: logged in first, then put through.',
      channel: 'web-chat',
      http_mocks: [...loggedIn, { connection: 'contact', method: 'POST', path: '/transfer', json: { ok: true, transferred: true } }],
      turns: [{ say: 'I’m an iQ member, I want to speak to my iQ service executive.' }, { say: '87654321' }, { say: '654321' }],
      expect: [{ tool_called: 'verify_phone_code_spoken' }, { tool_called: 'to_iq_executive' }],
    },
  ];
  return c;
}
