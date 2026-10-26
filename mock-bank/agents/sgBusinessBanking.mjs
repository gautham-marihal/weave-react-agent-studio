// SG Business Banking (6538 1111): a front desk and eight specialists (design sections 4, 5, 8–15). Callers are verified by phone code and PIN, or
// by account number, NRIC and a one-time password; every account tool needs that first. Hand-overs go to the contact centre's skill queues
// (AACC) while the Commercial Service Centre is open, 8:30 am to 6 pm Monday to Friday; outside those hours the caller is offered a call-back.
import {
  PHONE,
  WEB,
  backToFrontDesk,
  baseConfig,
  collect,
  commonState,
  connections,
  endCall,
  httpTool,
  mustBeVerified,
  mustHaveAccount,
  num,
  onDecline,
  onFailure,
  onSuccess,
  params,
  say,
  str,
} from './common.mjs';

export function sgBusinessBanking(mockUrl) {
  const c = baseConfig({
    id: 'sg-business-banking',
    name: 'SG Business Banking',
    description:
      'OCBC Singapore business banking phone line (6538 1111): balances, incoming funds, statements, cheques, Velocity, new business, rates and forms, card loss, appointments and feedback, in English and Mandarin.',
    tags: ['ocbc', 'singapore', 'business-banking', 'phone'],
    market: 'sg',
    persona: 'OCBC Business Banking assistant',
  });

  c.connections = connections(mockUrl, { as400: '/sg/as400', soa: '/sg/soa', siebel: '/sg/siebel', cmm: '/sg/cmm', aacc: '/sg/aacc', fax: '/sg/fax' });

  c.schedules = {
    bbcsc_hours: {
      description: 'When the Commercial Service Centre takes calls: 8:30 am to 6:00 pm, Monday to Friday, Singapore time.',
      timezone: 'Asia/Singapore',
      weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:30', end: '18:00' }],
      holidays: ['2026-12-25', '2027-01-01', '2027-02-06', '2027-02-08'],
    },
  };
  c.constants = { trade_hotline: '+6563187777', personal_banking_line: '1800 363 3333' };

  c.messages.push(
    say(
      'greeting',
      'Welcome to OCBC Business Banking. How may I help you today? You can ask for your balance, a cheque, a statement, rates, or a service manager.',
      '欢迎致电华侨银行商业银行。请问今天有什么可以帮您？您可以查询余额、支票、月结单、利率，或要求转接客户经理。',
    ),
    say(
      'closed_hours',
      'Thank you for calling OCBC Bank. Our Commercial Service Centre is operational from 8:30 am to 6:00 pm, Monday to Friday. If you would like us to return your call, I can arrange a call-back.',
      '感谢您致电华侨银行。我们的商业服务中心服务时间为星期一至星期五上午8点30分至下午6点。如需回电，我可以为您安排。',
    ),
    say('callback_exists', 'You have already made a request for us to return your call.', '您已经申请了回电服务。'),
    say(
      'personal_customer',
      'This line is for business banking. The correct number to dial is 1800 363 3333.',
      '这条热线为商业银行服务。请拨打1800 363 3333。',
    ),
    say('dormant_account', 'This account is dormant. Please visit your nearest OCBC branch.', '此账户已处于休眠状态。请前往最近的华侨银行分行办理。'),
    say(
      'max_tries',
      'Sorry, that was the last try. You may mail in your request for a new Phone PIN using the Corporate Electronic Services Update Form.',
      '抱歉，您已用完尝试次数。您可以使用企业电子服务更新表格邮寄申请新的电话密码。',
    ),
    say(
      'otp_suspended',
      'Your One-Time Password feature has been suspended. Let me connect you to a service manager.',
      '您的一次性密码功能已暂停。我为您转接客户经理。',
    ),
    say('connecting_trade', 'I’m connecting you to our trade hotline now.', '我现在为您转接贸易热线。'),
  );

  c.state = {
    variables: {
      ...commonState(),
      favourite_txn: { type: 'string', default: '', description: 'What the caller does most, from the contact-centre tables (e.g. balance).' },
      is_vip: { type: 'boolean', default: false },
      otp: { type: 'string', nullable: true, default: null, sensitive: true },
      otp_sent: { type: 'boolean', default: false },
      new_pin: { type: 'string', nullable: true, default: null, sensitive: true },
      confirm_pin: { type: 'string', nullable: true, default: null, sensitive: true },
      account_number: { type: 'string', nullable: true, default: null, sensitive: true, description: 'The 12-digit account number given for verification.' },
      nric_last4: { type: 'string', nullable: true, default: null, sensitive: true },
      access_level: { type: 'string', nullable: true, default: null, description: 'P (phone code), AS (account services) or AC (account check).' },
      user_type: { type: 'string', nullable: true, default: null, description: 'business or personal.' },
      dormant: { type: 'boolean', default: false },
      accounts: { type: 'array', default: [], description: 'The customer’s accounts: number, last four digits, type, currency.' },
      has_ca: { type: 'boolean', default: false },
      has_acu: { type: 'boolean', default: false },
      has_acu_chq: { type: 'boolean', default: false },
      bizconn: { type: 'boolean', default: false },
      selected_account: { type: 'string', nullable: true, default: null, description: 'The account the caller chose (its full number, never said aloud).' },
      selected_account_last4: { type: 'string', nullable: true, default: null },
      pin_changed_this_call: { type: 'boolean', default: false },
    },
  };

  // ---- what happens around the call: the caller's preferences before anyone speaks; a service request after the call
  c.events = [
    {
      on: 'call_started',
      do: [
        {
          type: 'http',
          connection: 'cmm',
          method: 'GET',
          path: '/callers/{{state.caller_number}}',
          skip_when_empty: '{{state.caller_number}}',
          to_state: { language: '$.language', favourite_txn: '$.favourite_txn', is_vip: '$.is_vip' },
        },
      ],
    },
    {
      on: 'call_ended',
      do: [
        {
          type: 'http',
          connection: 'siebel',
          method: 'POST',
          path: '/service-requests',
          skip_when_empty: '{{state.sr_category}}',
          body: {
            cif: '{{state.cif}}',
            account: '{{state.selected_account_last4}}',
            type: '{{state.sr_type}}',
            category: '{{state.sr_category}}',
            subcategory: '{{state.sr_subcategory}}',
            notes: 'Created by the SG Business Banking phone agent',
          },
        },
      ],
    },
  ];

  // ---- verification (section 9): phone code + PIN (access P), or account + NRIC + one-time password (access AS). Keypad on the phone, spoken in the browser.
  const verifyPhoneCode = (keypad) => ({
    id: keypad ? 'verify_phone_code_keypad' : 'verify_phone_code_spoken',
    kind: 'verification',
    description: 'Confirm who the caller is with their phone code and PIN, then load their business profile and accounts.',
    instructions:
      'You are one short step in a call: confirm who the caller is. Each answer is checked by a tool; never judge an answer yourself, never repeat a code, and talk about nothing else.',
    use_prior_context: true,
    attempts_scope: 'task',
    steps: [
      collect('phone_code', keypad ? 'Ask the caller to key in their 7-digit phone code, then the hash key.' : 'Ask for their 7-digit phone code.', {
        keypad,
        digits: 7,
        storeIn: 'phone_code',
        validate: { type: 'tool', tool: 'check_phone_code', ...(keypad ? { args: { phone_code: '{{value}}' } } : {}) },
        passWhen: { result: '$.ok', equals: true },
      }),
      collect('pin', keypad ? 'Ask them to key in their 6-digit phone PIN.' : 'Ask for their 6-digit phone PIN.', {
        keypad,
        digits: 6,
        storeIn: 'pin',
        validate: { type: 'tool', tool: 'check_pin', ...(keypad ? { args: { pin: '{{value}}' } } : {}) },
        passWhen: { result: '$.ok', equals: true },
        onExhausted: [{ type: 'say', text: { message: 'max_tries' } }],
      }),
      {
        id: 'business_profile',
        type: 'call',
        do: [
          {
            type: 'http',
            connection: 'as400',
            method: 'GET',
            path: '/cif/{{state.cif}}',
            to_state: { accounts: '$.accounts', has_ca: '$.has_ca', has_acu: '$.has_acu', has_acu_chq: '$.has_acu_chq', bizconn: '$.bizconn' },
          },
        ],
        pass_when: { state: 'user_type', equals: 'business' },
        max_attempts: 1,
        on_exhausted: [{ type: 'say', text: { message: 'personal_customer' } }],
      },
    ],
    max_attempts: 3,
    inactivity: { timeout_s: 30 },
    on_success: onSuccess,
    on_failure: onFailure,
    on_decline: onDecline,
  });

  const verifyAccountOtp = (keypad) => ({
    id: keypad ? 'verify_account_otp_keypad' : 'verify_account_otp_spoken',
    kind: 'verification',
    description:
      'Confirm who the caller is with a 12-digit account number, the last four characters of their NRIC or passport, and a one-time password sent to their mobile.',
    instructions:
      'You are one short step in a call: confirm who the caller is. Each answer is checked by a tool; never judge an answer yourself, never repeat a number back in full, and talk about nothing else.',
    use_prior_context: true,
    attempts_scope: 'task',
    steps: [
      collect('account', keypad ? 'Ask them to key in the 12-digit account number.' : 'Ask for the 12-digit account number.', {
        keypad,
        digits: 12,
        storeIn: 'account_number',
        validate: { type: 'tool', tool: 'check_account', ...(keypad ? { args: { account: '{{value}}' } } : {}) },
        passWhen: {
          all: [
            { result: '$.found', equals: true },
            { result: '$.dormant', equals: false },
          ],
        },
      }),
      collect('nric', 'Ask for the last four characters of the NRIC or passport of the person calling.', {
        storeIn: 'nric_last4',
        validate: { type: 'tool', tool: 'check_contact' },
        passWhen: { result: '$.valid', equals: true },
      }),
      {
        id: 'send_otp',
        type: 'call',
        do: [{ type: 'http', connection: 'soa', method: 'POST', path: '/otp/send', body: { cif: '{{state.cif}}' }, to_state: { otp_sent: '$.sent' } }],
        pass_when: { state: 'otp_sent', equals: true },
        max_attempts: 1,
        on_exhausted: [{ type: 'say', text: { message: 'otp_suspended' } }],
      },
      collect(
        'otp',
        keypad ? 'Tell them a one-time password was sent by SMS, and ask them to key it in.' : 'Tell them a one-time password was sent by SMS, and ask for it.',
        {
          keypad,
          digits: 6,
          storeIn: 'otp',
          validate: { type: 'tool', tool: 'check_otp', ...(keypad ? { args: { otp: '{{value}}' } } : {}) },
          passWhen: { result: '$.valid', equals: true },
        },
      ),
      {
        id: 'business_profile',
        type: 'call',
        do: [
          {
            type: 'http',
            connection: 'as400',
            method: 'GET',
            path: '/cif/{{state.cif}}',
            to_state: {
              accounts: '$.accounts',
              has_ca: '$.has_ca',
              has_acu: '$.has_acu',
              has_acu_chq: '$.has_acu_chq',
              bizconn: '$.bizconn',
              user_type: '$.user_type',
            },
          },
        ],
        pass_when: { state: 'user_type', equals: 'business' },
        max_attempts: 1,
        on_exhausted: [{ type: 'say', text: { message: 'personal_customer' } }],
      },
    ],
    max_attempts: 3,
    inactivity: { timeout_s: 45 },
    on_success: { ...onSuccess, set_state: { verified: true, access_level: 'AS' } },
    on_failure: onFailure,
    on_decline: onDecline,
  });

  // the phone PIN change (p. 9): phone-code callers only, once a call
  const changePin = (keypad) => ({
    id: keypad ? 'change_phone_pin_keypad' : 'change_phone_pin_spoken',
    kind: 'collect_fields',
    description: 'Change the caller’s 6-digit phone PIN.',
    instructions: 'Collect the new PIN twice and change it. Never repeat a PIN.',
    use_prior_context: true,
    steps: [
      collect('new_pin', keypad ? 'Ask them to key in a new 6-digit PIN.' : 'Ask for a new 6-digit PIN.', {
        keypad,
        digits: 6,
        storeIn: 'new_pin',
        validate: { type: 'regex', pattern: '^\\d{6}$' },
      }),
      collect('confirm_pin', keypad ? 'Ask them to key in the new PIN again.' : 'Ask them to say the new PIN again.', {
        keypad,
        digits: 6,
        storeIn: 'confirm_pin',
        validate: { type: 'tool', tool: 'change_pin', ...(keypad ? { args: { confirm: '{{value}}' } } : {}) },
        passWhen: { result: '$.ok', equals: true },
      }),
    ],
    max_attempts: 3,
    on_success: { set_state: { pin_changed_this_call: true }, resume: 'caller', silent: false },
    on_failure: onFailure,
    on_decline: onDecline,
  });

  // the IVR survey (p. 37): three ratings from 1 to 5
  const survey = {
    id: 'ivr_survey',
    kind: 'collect_fields',
    description: 'Three questions about the phone service, each rated 1 (poor) to 5 (excellent).',
    instructions: 'Ask the three questions in order, one at a time; take a number from 1 to 5 for each. Thank the caller at the end.',
    steps: [
      collect('q1', 'Ask: on a scale of 1 to 5, how would you rate the ease of use of our phone system?', { validate: { type: 'regex', pattern: '^[1-5]$' } }),
      collect('q2', 'Ask: on a scale of 1 to 5, how well do our phone features help you complete your transaction?', {
        validate: { type: 'regex', pattern: '^[1-5]$' },
      }),
      collect('q3', 'Ask: on a scale of 1 to 5, please rate your overall experience with PhoneDirect.', {
        validate: { type: 'tool', tool: 'save_survey' },
        passWhen: { result: '$.ok', equals: true },
      }),
    ],
    max_attempts: 3,
    on_success: { resume: 'caller', silent: false },
    on_failure: onFailure,
    on_decline: onDecline,
  };

  c.tasks = [verifyPhoneCode(true), verifyPhoneCode(false), verifyAccountOtp(true), verifyAccountOtp(false), changePin(true), changePin(false), survey];

  // ---- tools
  const as400 = (...a) => httpTool('as400', ...a);
  const soa = (...a) => httpTool('soa', ...a);
  const siebel = (...a) => httpTool('siebel', ...a);
  const cmm = (...a) => httpTool('cmm', ...a);
  const fax = (...a) => httpTool('fax', ...a);
  const accountPre = [mustBeVerified, mustHaveAccount];
  const servicesPre = [
    mustBeVerified,
    mustHaveAccount,
    {
      require: {
        any: [
          { state: 'access_level', equals: 'P' },
          { state: 'access_level', equals: 'AS' },
        ],
      },
      on_fail: { tool_error: 'This needs a phone code or account-services login; offer a service manager.' },
    },
  ];
  const task = (id, name, taskId, description, channels) => ({ id, name, type: 'task', task: taskId, channels, description });
  const transferTool = (id, transfer, description) => ({
    id,
    type: 'builtin',
    builtin: 'transfer_or_callback',
    description,
    params: { transfer, fallback: [{ type: 'say', text: { message: 'closed_hours' } }] },
  });

  c.tools = [
    endCall,
    backToFrontDesk,
    // verification, keypad on the phone and spoken in the browser (same name to the model)
    task('verify_phone_code_keypad', 'verify_phone_code', 'verify_phone_code_keypad', 'Verify the caller with their phone code and PIN.', PHONE),
    task('verify_phone_code_spoken', 'verify_phone_code', 'verify_phone_code_spoken', 'Verify the caller with their phone code and PIN.', WEB),
    task(
      'verify_account_otp_keypad',
      'verify_account_otp',
      'verify_account_otp_keypad',
      'Verify a caller who has no phone code: account number, NRIC and a one-time password.',
      PHONE,
    ),
    task(
      'verify_account_otp_spoken',
      'verify_account_otp',
      'verify_account_otp_spoken',
      'Verify a caller who has no phone code: account number, NRIC and a one-time password.',
      WEB,
    ),
    { ...task('change_phone_pin_keypad', 'change_phone_pin', 'change_phone_pin_keypad', 'Change the caller’s phone PIN.', PHONE), preconditions: pinPre() },
    { ...task('change_phone_pin_spoken', 'change_phone_pin', 'change_phone_pin_spoken', 'Change the caller’s phone PIN.', WEB), preconditions: pinPre() },
    { id: 'ivr_survey', type: 'task', task: 'ivr_survey', description: 'Run the three-question feedback survey.' },
    // the checks behind verification
    as400(
      'check_phone_code',
      'Check a phone code.',
      { method: 'POST', path: '/login', body: { phone_code: '{{args.phone_code}}' } },
      {
        parameters: params({ phone_code: str('Seven digits.') }),
        result: { to_llm: ['ok', 'code'] },
      },
    ),
    as400(
      'check_pin',
      'Check the phone PIN for the phone code just given.',
      { method: 'POST', path: '/login', body: { phone_code: '{{state.phone_code}}', pin: '{{args.pin}}' } },
      {
        parameters: params({ pin: str('Six digits.') }),
        result: { to_llm: ['ok', 'code', 'user_type'], to_state: { cif: '$.cif', access_level: '$.access_level', user_type: '$.user_type' } },
      },
    ),
    siebel(
      'check_account',
      'Look up a 12-digit account number.',
      { method: 'POST', path: '/account-login', body: { account: '{{args.account}}' } },
      {
        parameters: params({ account: str('Twelve digits.') }),
        result: { to_llm: ['found', 'dormant'], to_state: { cif: '$.cif', dormant: '$.dormant', user_type: '$.user_type' } },
        extraEffects: [{ when: { result: '$.dormant', equals: true }, do: [{ type: 'say', text: { message: 'dormant_account' } }] }],
      },
    ),
    siebel(
      'check_contact',
      'Check the last four characters of the caller’s NRIC or passport.',
      { method: 'POST', path: '/verify-contact', body: { cif: '{{state.cif}}', nric_last4: '{{args.nric_last4}}' } },
      {
        parameters: params({ nric_last4: str('The last four characters, e.g. 567A.') }),
        result: { to_llm: ['valid'] },
      },
    ),
    soa(
      'check_otp',
      'Check the one-time password sent to the caller’s mobile.',
      { method: 'POST', path: '/otp/verify', body: { cif: '{{state.cif}}', otp: '{{args.otp}}' } },
      {
        parameters: params({ otp: str('Six digits.') }),
        result: { to_llm: ['valid', 'reason'] },
      },
    ),
    as400(
      'change_pin',
      'Change the phone PIN to the new one, once it has been entered twice.',
      {
        method: 'POST',
        path: '/pin',
        body: { phone_code: '{{state.phone_code}}', old_pin: '{{state.pin}}', new_pin: '{{state.new_pin}}', confirm: '{{args.confirm}}' },
      },
      {
        parameters: params({ confirm: str('The new PIN, entered again.') }),
        pre: [mustBeVerified],
        result: { to_llm: ['ok', 'reason'] },
        sr: ['Service Request', 'PHONEBANKING', 'T-PIN RESET'],
      },
    ),
    // the account to act on
    as400(
      'choose_account',
      'Choose which of the caller’s accounts to act on, by its last four digits.',
      { method: 'GET', path: '/cif/{{state.cif}}/accounts/{{args.last4}}' },
      {
        parameters: params({ last4: str('The last four digits of the account.') }),
        pre: [mustBeVerified],
        result: { to_llm: ['found', 'last4', 'type', 'currency', 'cheques'], to_state: { selected_account: '$.number', selected_account_last4: '$.last4' } },
      },
    ),
    // Accounts (menu 1)
    soa(
      'get_balance',
      'The ledger and available balance of the chosen account.',
      { method: 'GET', path: '/accounts/{{state.selected_account}}/balance' },
      {
        pre: accountPre,
        result: { to_llm: ['account_last4', 'type', 'currency', 'ledger_balance', 'available_balance'] },
        sr: ['Enquiry', 'ACCOUNT SERVICES', 'ACCOUNT BALANCES'],
      },
    ),
    soa(
      'list_incoming_funds',
      'Recent incoming funds (GIRO, local and overseas transfers) to the chosen account, and whether each is credited.',
      { method: 'GET', path: '/accounts/{{state.selected_account}}/incoming-funds' },
      {
        pre: accountPre,
        result: { to_llm: ['items'] },
        sr: ['Enquiry', 'INWARD REMITTANCE', 'STATUS OF INCOMING FUNDS'],
      },
    ),
    soa(
      'list_recent_activity',
      'The last five debits and credits on the chosen account.',
      { method: 'GET', path: '/accounts/{{state.selected_account}}/history', query: { limit: '5' } },
      {
        pre: accountPre,
        result: { to_llm: ['items'] },
        sr: ['Enquiry', 'ACCOUNT SERVICES', 'DEBIT/CREDIT TXN'],
      },
    ),
    soa(
      'request_statement',
      'Ask for a copy of a statement of the chosen account (the last 3 months; older ones need a service manager).',
      { method: 'POST', path: '/accounts/{{state.selected_account}}/statements', body: { month: '{{args.month}}', delivery: '{{args.delivery}}' } },
      {
        parameters: params({ month: str('The statement month, YYYY-MM.'), delivery: str('How to send it.', { enum: ['mail', 'fax'] }) }),
        pre: servicesPre,
        result: { to_llm: ['reference', 'delivery', 'arrives_in_days'] },
        sr: ['Service Request', 'ACCOUNT SERVICES', 'COPY OF STATEMENT (C/P/I)'],
      },
    ),
    // Cheques (menu 2)
    soa(
      'list_cheque_deposits',
      'Cheques deposited into the chosen account in the last days, and their clearing status.',
      { method: 'GET', path: '/accounts/{{state.selected_account}}/cheque-deposits' },
      {
        pre: accountPre,
        result: { to_llm: ['items'] },
        sr: ['Enquiry', 'LOCAL CHEQUE CLEARING', 'STATUS OF CHEQUE DEPOSIT'],
      },
    ),
    as400(
      'get_issued_cheque_status',
      'Whether a cheque the caller issued has been paid, stopped or not presented yet.',
      { method: 'GET', path: '/cheques/{{state.selected_account}}/{{args.cheque_no}}' },
      {
        parameters: params({ cheque_no: str('The six-digit cheque number.') }),
        pre: accountPre,
        result: { to_llm: ['found', 'cheque_no', 'status', 'amount', 'paid_on', 'stopped_on'] },
        sr: ['Enquiry', 'LOCAL CHEQUE CLEARING', 'STATUS OF CHEQUE ISSUED'],
      },
    ),
    soa(
      'get_last_cheque_book',
      'The range of the last cheque book sent for the chosen account, when and how.',
      { method: 'GET', path: '/accounts/{{state.selected_account}}/cheque-book' },
      {
        pre: accountPre,
        result: { to_llm: ['found', 'from', 'to', 'sent_on', 'delivery'] },
        sr: ['Enquiry', 'CHEQUE BOOK', 'CHEQUE BOOK ENQUIRY'],
      },
    ),
    soa(
      'request_cheque_book',
      'Order a new cheque book for the chosen account. Ask normal, express (S$20) or same day (S$20) first.',
      { method: 'POST', path: '/accounts/{{state.selected_account}}/cheque-book', body: { delivery: '{{args.delivery}}' } },
      {
        parameters: params({ delivery: str('Delivery.', { enum: ['normal', 'express', 'same_day'] }) }),
        pre: servicesPre,
        result: { to_llm: ['reference', 'delivery', 'ready_in_working_days', 'fee_sgd'] },
        sr: ['Service Request', 'CHEQUE BOOK', 'CHEQUE BOOK REQ'],
      },
    ),
    as400(
      'stop_cheque_payment',
      'Stop payment of a cheque the caller issued (S$30). Read back the cheque number and confirm before stopping.',
      { method: 'POST', path: '/cheques/{{state.selected_account}}/stop', body: { cheque_no: '{{args.cheque_no}}', reason: '{{args.reason}}' } },
      {
        parameters: params({ cheque_no: str('The six-digit cheque number.'), reason: str('Why, in a few words.') }),
        pre: servicesPre,
        result: { to_llm: ['ok', 'reason', 'fee_sgd', 'reference', 'paid_on'] },
        sr: ['Service Request', 'LOCAL CHEQUE CLEARING', 'STOP PAYMENT INSTRUCTIONS'],
      },
    ),
    // Business Internet Banking (menu 3)
    fax(
      'send_velocity_form',
      'Fax the Velocity application form or the Velocity user request form.',
      { method: 'POST', path: '/send', body: { fax_number: '{{args.fax_number}}', document_id: '{{args.form}}' } },
      {
        parameters: params({ fax_number: str('The fax number, with area code.'), form: str('Which form.', { enum: ['F02', 'F03'] }) }),
        result: { to_llm: ['ok', 'job_id', 'reason'] },
        sr: ['Service Request', 'REQUEST FOR FORM', 'VELOCITY APPLICATION or USER REQ FORM'],
      },
    ),
    siebel(
      'check_account_number',
      'Check a 12-digit account number before a hand-over or a booking (no PIN needed).',
      { method: 'POST', path: '/account-login', body: { account: '{{args.account}}' } },
      {
        parameters: params({ account: str('Twelve digits.') }),
        result: { to_llm: ['found', 'dormant', 'name'], to_state: { cif: '$.cif' } },
      },
    ),
    // Info Desk (menu 5): no verification
    as400('get_prime_rate', 'OCBC’s prime lending rate.', { method: 'GET', path: '/rates/prime' }, { result: { to_llm: ['prime_rate_pct'] } }),
    soa('get_sgd_td_rates', 'SGD time deposit rates by tenor.', { method: 'GET', path: '/rates/sgd-td' }, { result: { to_llm: ['items'] } }),
    as400(
      'get_fx_rate',
      'Indicative foreign exchange rate for a currency against SGD (below S$40,000).',
      { method: 'GET', path: '/rates/fx/{{args.currency}}' },
      {
        parameters: params({ currency: str('ISO code, e.g. USD.') }),
        result: { to_llm: ['found', 'currency', 'bank_buys_sgd_per_unit', 'bank_sells_sgd_per_unit', 'note'] },
        sr: ['Enquiry', 'FOREIGN EXCHANGE', 'INDICATIVE FX RATES (<S$40K)'],
      },
    ),
    cmm('list_promotions', 'Current business banking promotions.', { method: 'GET', path: '/promotions' }, { result: { to_llm: ['items'] } }),
    fax(
      'fax_promotion',
      'Fax the details of a promotion.',
      { method: 'POST', path: '/send', body: { fax_number: '{{args.fax_number}}', document_id: '{{args.promotion_id}}' } },
      {
        parameters: params({ fax_number: str('The fax number.'), promotion_id: str('The promotion id from list_promotions.') }),
        result: { to_llm: ['ok', 'job_id', 'reason'] },
      },
    ),
    cmm('list_forms', 'The forms that can be sent by fax.', { method: 'GET', path: '/forms' }, { result: { to_llm: ['items'] } }),
    fax(
      'fax_form',
      'Fax a form.',
      { method: 'POST', path: '/send', body: { fax_number: '{{args.fax_number}}', document_id: '{{args.form_id}}' } },
      {
        parameters: params({ fax_number: str('The fax number.'), form_id: str('The form id from list_forms.') }),
        result: { to_llm: ['ok', 'job_id', 'reason'] },
      },
    ),
    cmm(
      'find_branch',
      'Find branches by area or name, with address and opening hours.',
      { method: 'GET', path: '/branches', query: { q: '{{args.query}}' } },
      {
        parameters: params({ query: str('An area or branch name, e.g. Tampines.') }),
        result: { to_llm: ['items'] },
      },
    ),
    cmm(
      'get_bank_codes',
      'OCBC’s GIRO bank code and SWIFT code.',
      { method: 'GET', path: '/bank-codes' },
      { result: { to_llm: ['bank', 'giro_bank_code', 'swift', 'branch_code_note'] } },
    ),
    // Appointments
    cmm(
      'list_appointment_slots',
      'Free appointment slots: foreign worker account opening at a branch, or Velocity Payment or Trade module training.',
      { method: 'GET', path: '/appointments/slots', query: { type: '{{args.purpose}}' } },
      {
        parameters: params({ purpose: str('What for.', { enum: ['foreign_worker', 'payment_training', 'trade_training'] }) }),
        result: { to_llm: ['items'] },
      },
    ),
    cmm(
      'book_appointment',
      'Book one of the free slots. Read back the date, time and branch first.',
      {
        method: 'POST',
        path: '/appointments',
        body: { slot_id: '{{args.slot_id}}', type: '{{args.purpose}}', cif: '{{state.cif}}', contact_name: '{{args.contact_name}}' },
      },
      {
        parameters: params({
          slot_id: str('From list_appointment_slots.'),
          purpose: str('What for.', { enum: ['foreign_worker', 'payment_training', 'trade_training'] }),
          contact_name: str('Who will attend.'),
        }),
        pre: [{ require: { state: 'cif', not_equals: null }, on_fail: { tool_error: 'Check the account number first (check_account_number).' } }],
        result: { to_llm: ['ok', 'booking_id', 'date', 'time', 'branch', 'reason'] },
        sr: ['Service Request', 'ACCOUNT SERVICES', 'FOREIGN WORKER ACC OPENING / VELOCITY TRG REG'],
      },
    ),
    cmm(
      'list_bookings',
      'The caller’s current bookings.',
      { method: 'GET', path: '/appointments', query: { cif: '{{state.cif}}' } },
      {
        pre: [{ require: { state: 'cif', not_equals: null }, on_fail: { tool_error: 'Check the account number first (check_account_number).' } }],
        result: { to_llm: ['items'] },
      },
    ),
    cmm(
      'cancel_booking',
      'Cancel one of the caller’s bookings, after confirming which.',
      { method: 'POST', path: '/appointments/{{args.booking_id}}/cancel' },
      {
        parameters: params({ booking_id: str('From list_bookings.') }),
        result: { to_llm: ['ok', 'reason'] },
      },
    ),
    // service codes, call-backs, survey
    cmm(
      'check_service_code',
      'Check a three-digit service code the caller keyed or said (e.g. 328 for fixed deposits, loans and FX).',
      { method: 'GET', path: '/service-codes/{{args.code}}' },
      {
        parameters: params({ code: str('Three digits.') }),
        result: { to_llm: ['valid', 'route', 'label'] },
      },
    ),
    cmm(
      'check_open_callback',
      'Whether this caller already has a call-back request open. Check it before offering one.',
      { method: 'GET', path: '/callbacks/{{state.caller_number}}' },
      {
        result: { to_llm: ['open'] },
        extraEffects: [{ when: { result: '$.open', equals: true }, do: [{ type: 'say', text: { message: 'callback_exists' } }] }],
      },
    ),
    cmm(
      'request_callback',
      'Ask a service manager to call the caller back (outside office hours, or when no one is free). On their caller ID, or another number of 5 to 15 digits.',
      { method: 'POST', path: '/callbacks', body: { caller: '{{state.caller_number}}', number: '{{args.number}}', reason: '{{state.intent}}' } },
      {
        parameters: params({ number: str('The number to call back: the caller ID unless they give another.') }),
        result: { to_llm: ['ok', 'request_id', 'reason'] },
        extraEffects: [{ when: { result: '$.ok', equals: true }, do: [{ type: 'say', text: { message: 'callback_saved' } }, { type: 'end_call' }] }],
      },
    ),
    cmm(
      'save_survey',
      'Save the three survey ratings.',
      { method: 'POST', path: '/surveys', body: { profile: 'ivr', q1: '{{args.q1}}', q2: '{{args.q2}}', q3: '{{args.q3}}' } },
      {
        parameters: params({ q1: num('Rating 1–5.'), q2: num('Rating 1–5.'), q3: num('Rating 1–5.') }),
        result: { to_llm: ['ok'] },
      },
    ),
    // hand-overs to people (section 14)
    transferTool(
      'to_service_manager',
      'service_manager',
      'Pass the caller to a service manager: when they ask for one, for earlier statements, or when you cannot help.',
    ),
    transferTool('to_fd_loans', 'fd_loans', 'Pass a verified caller to the fixed deposit and loans team (service code 328).'),
    transferTool(
      'to_velocity_desk',
      'velocity_desk',
      'Pass the caller to Velocity (Business Internet Banking) technical support, after checking their account number.',
    ),
    transferTool('to_new_business', 'non_customer', 'Pass the caller to a service manager for a new account or facilities.'),
    transferTool('to_cpl_desk', 'cpl_desk', 'Pass the caller to the commercial property loan team.'),
    transferTool('to_insurance_desk', 'insurance_desk', 'Pass the caller to the business insurance team.'),
    transferTool(
      'to_card_ops',
      'card_ops',
      'Lost corporate ATM card, unauthorised ATM withdrawal or SMS alerts: pass the caller to card operations, after checking their account number. High priority.',
    ),
    {
      id: 'to_trade_hotline',
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'Trade enquiries: put the caller through to the trade hotline (6318 7777).',
      params: { transfer: 'trade_hotline', fallback: [{ type: 'say', text: { message: 'unable_to_proceed' } }] },
    },
  ];

  function pinPre() {
    return [
      mustBeVerified,
      { require: { state: 'access_level', equals: 'P' }, on_fail: { tool_error: 'Only callers who logged in with a phone code can change the PIN.' } },
      {
        require: { state: 'pin_changed_this_call', equals: false },
        on_fail: { tool_error: 'The PIN was already changed on this call; it can be changed once per call.' },
      },
    ];
  }

  // ---- the transfers: into AACC skill queues, registered in CMM first, with the screen-pop headers (section 14)
  const aacc = (id, description, skillset, priority = 'normal', extra = {}) => ({
    id,
    description,
    method: 'http_request',
    target: skillset,
    request: {
      connection: 'aacc',
      method: 'POST',
      path: '/transfer',
      body: { skillset: '{{target}}', priority, intent: '{{state.intent}}', cif: '{{state.cif}}', language: '{{state.language}}' },
    },
    headers: {
      'X-CIF': '{{state.cif}}',
      'X-Account': '{{state.selected_account_last4}}',
      'X-Verified': '{{state.verified}}',
      'X-Access-Level': '{{state.access_level}}',
      'X-Language': '{{state.language}}',
      'X-Intent': '{{state.intent}}',
      'X-SR-Type': '{{state.sr_type}}',
      'X-SR-Category': '{{state.sr_category}}',
      'X-SR-Subcategory': '{{state.sr_subcategory}}',
      'X-Skillset': skillset,
      'X-Priority': priority,
    },
    schedule: 'bbcsc_hours',
    closed: [{ type: 'say', text: { message: 'closed_hours' } }],
    before: [
      { type: 'http', connection: 'cmm', method: 'POST', path: '/calls/register', body: { intent: '{{state.intent}}', skillset, cif: '{{state.cif}}' } },
    ],
    delay_s: 1,
    on_failure: [{ type: 'say', text: { message: 'host_error' } }],
    ...extra,
  });
  c.telephony = {
    transfers: [
      aacc('service_manager', 'A service manager (BI by segment).', 'BI'),
      aacc('fd_loans', 'Fixed deposits and loans (BC).', 'BC-FD-LOANS'),
      aacc('velocity_desk', 'Velocity technical support.', 'VELOCITY'),
      aacc('non_customer', 'New accounts and facilities (non-customer skillset).', 'NON-CUST'),
      aacc('cpl_desk', 'Commercial property loans.', 'CPL'),
      aacc('insurance_desk', 'Business insurance.', 'INSURANCE'),
      aacc('card_ops', 'Card operations, high priority; after hours to the 24-hour card centre.', 'CARD-OPS', 'high', {
        closed: [{ type: 'transfer', transfer: 'card_ops_after_hours' }],
      }),
      {
        id: 'card_ops_after_hours',
        description: 'The 24-hour card centre, when the service centre is closed.',
        method: 'sip_refer',
        target: '+6565381999',
        delay_s: 1,
      },
      {
        id: 'trade_hotline',
        description: 'The trade hotline, 6318 7777.',
        method: 'sip_refer',
        target: '+6563187777',
        before: [{ type: 'say', text: { message: 'connecting_trade' } }],
        delay_s: 1,
      },
    ],
  };

  // ---- the specialists (section 5)
  const notVerified = {
    when: { state: 'verified', equals: false },
    append: 'The caller is not verified yet: use verify_phone_code (or verify_account_otp when they have no phone code) before any account tool.',
  };
  const noAccount = {
    when: { state: 'selected_account', equals: null },
    append: 'Before any account tool, ask which account (their accounts: {{state.accounts}}), by its last four digits, and use choose_account.',
  };
  const language = 'The caller’s favourite language is {{state.language}} (en English, zh Mandarin); use it unless they speak another.';
  const handOff = (id, tool, description, to, intent) => ({ id, tool, description, to, carry_context: true, set_state: { intent } });
  c.agents = {
    entry: 'front_desk',
    items: [
      {
        id: 'front_desk',
        name: 'Front desk',
        kind: 'router',
        instructions: {
          role: 'You answer the OCBC Business Banking line, find out what the caller needs, and pass them to the right specialist. You do no account work yourself.',
          opening: 'The greeting has been said. Listen to what the caller needs.',
          rules: [
            language,
            'Balances, incoming funds, recent transactions, statements, phone PIN changes, fixed deposits and loans: Accounts.',
            'Deposited or issued cheques, cheque books, stopping a cheque: Cheques.',
            'Velocity forms and technical support: Business Internet Banking.',
            'New accounts and facilities, trade, commercial property loans, business insurance: New Business. Foreign worker accounts and training bookings: Appointments.',
            'Rates, promotions, forms by fax, branches, GIRO and SWIFT codes: Info Desk.',
            'A lost corporate ATM card, an ATM withdrawal they did not make, SMS alerts: Card Loss, at once.',
            'A three-digit service code: check it with check_service_code; 328 goes to Accounts for fixed deposits and loans.',
            'Feedback or a survey: Feedback. A service manager: to_service_manager.',
            'If the caller has nothing else, call end_call.',
          ],
          conditional: [
            {
              when: { state: 'favourite_txn', equals: 'balance' },
              append: 'This caller usually checks a balance: offer it first ("Would you like your account balance?").',
            },
            {
              when: { state: 'pending_request', not_equals: null },
              append: 'The caller still needs: {{state.pending_request}}. Pass them on now without asking again.',
            },
          ],
        },
        tools: ['check_service_code', 'to_service_manager', 'check_open_callback', 'request_callback', 'end_call'],
        handoffs: [
          handOff(
            'to_accounts',
            'go_to_accounts',
            'Balances, incoming funds, recent activity, statements, phone PIN, fixed deposits and loans.',
            'accounts',
            'accounts',
          ),
          handOff('to_cheques', 'go_to_cheques', 'Deposited or issued cheques, cheque books, stop payment.', 'cheques', 'cheques'),
          handOff('to_internet_banking', 'go_to_internet_banking', 'Velocity forms and technical support.', 'internet_banking', 'internet_banking'),
          handOff(
            'to_new_business',
            'go_to_new_business',
            'New accounts and facilities, trade, commercial property loans, insurance.',
            'new_business',
            'new_business',
          ),
          handOff('to_info_desk', 'go_to_info_desk', 'Rates, promotions, forms, branches, GIRO and SWIFT codes.', 'info_desk', 'info_desk'),
          handOff('to_card_loss', 'go_to_card_loss', 'Lost corporate ATM card, unauthorised ATM withdrawal, SMS alerts.', 'card_loss', 'card_loss'),
          handOff(
            'to_appointments',
            'go_to_appointments',
            'Foreign worker account opening, Velocity training, cancelling a booking.',
            'appointments',
            'appointments',
          ),
          handOff('to_feedback', 'go_to_feedback', 'The caller wants to give feedback or take the survey.', 'feedback', 'feedback'),
        ],
      },
      specialist(
        'accounts',
        'Accounts',
        'You help verified business customers with their accounts: balances, incoming funds, recent activity, statements, the phone PIN, and fixed deposits and loans.',
        [
          'Verify first; then ask which account (by its last four digits) if they have more than one.',
          'Statements older than three months: offer a service manager (to_service_manager).',
          'Fixed deposits and loans (service code 328): to_fd_loans, once verified.',
          'A PIN change is for phone-code callers only, once per call.',
        ],
        [
          'verify_phone_code_keypad',
          'verify_phone_code_spoken',
          'verify_account_otp_keypad',
          'verify_account_otp_spoken',
          'choose_account',
          'get_balance',
          'list_incoming_funds',
          'list_recent_activity',
          'request_statement',
          'change_phone_pin_keypad',
          'change_phone_pin_spoken',
          'to_fd_loans',
          'to_service_manager',
          'request_callback',
          'back_to_front_desk',
        ],
        [notVerified, noAccount],
      ),
      specialist(
        'cheques',
        'Cheques',
        'You help verified business customers with cheques: deposited cheques, issued cheque status, the last cheque book sent, ordering a cheque book, and stopping a cheque.',
        [
          'Verify first; then choose the account (cheques are on current and ACU accounts).',
          'Before stopping a cheque, read back the cheque number and the S$30 fee, and get a yes.',
          'Before ordering a cheque book, ask normal, express or same day, and say the fee.',
        ],
        [
          'verify_phone_code_keypad',
          'verify_phone_code_spoken',
          'verify_account_otp_keypad',
          'verify_account_otp_spoken',
          'choose_account',
          'list_cheque_deposits',
          'get_issued_cheque_status',
          'get_last_cheque_book',
          'request_cheque_book',
          'stop_cheque_payment',
          'to_service_manager',
          'request_callback',
          'back_to_front_desk',
        ],
        [notVerified, noAccount],
      ),
      specialist(
        'internet_banking',
        'Business Internet Banking',
        'You help with Velocity, OCBC’s business internet banking: you fax its forms, and pass technical problems to the Velocity desk.',
        [
          'Forms need no verification: ask which form and the fax number, then send it.',
          'Technical support: check the 12-digit account number with check_account_number, then to_velocity_desk.',
          'Training bookings: back to the front desk for Appointments.',
        ],
        ['send_velocity_form', 'check_account_number', 'to_velocity_desk', 'request_callback', 'back_to_front_desk'],
      ),
      specialist(
        'new_business',
        'New Business',
        'You help callers who want something new: accounts and facilities, trade, commercial property loans and business insurance.',
        [
          'New accounts and facilities: to_new_business. Trade enquiries: to_trade_hotline. Commercial property loans: to_cpl_desk. Insurance: to_insurance_desk.',
          'Foreign worker accounts are opened at a branch by appointment: back to the front desk for Appointments.',
          'No verification is needed here.',
        ],
        ['to_new_business', 'to_trade_hotline', 'to_cpl_desk', 'to_insurance_desk', 'request_callback', 'back_to_front_desk'],
      ),
      specialist(
        'info_desk',
        'Info Desk',
        'You answer general questions with no verification: the prime rate, SGD time deposit rates, indicative FX rates, promotions, forms by fax, branches and their hours, and OCBC’s GIRO and SWIFT codes.',
        [
          'Say rates exactly as the tool gives them, with "per annum" for interest rates and "indicative" for FX.',
          'For a fax, ask for the fax number and read it back before sending.',
        ],
        [
          'get_prime_rate',
          'get_sgd_td_rates',
          'get_fx_rate',
          'list_promotions',
          'fax_promotion',
          'list_forms',
          'fax_form',
          'find_branch',
          'get_bank_codes',
          'back_to_front_desk',
        ],
      ),
      specialist(
        'card_loss',
        'Card Loss',
        'You handle a lost corporate ATM card, an ATM withdrawal the caller did not make, and SMS alerts, urgently.',
        [
          'Reassure briefly; check the 12-digit account number with check_account_number; then to_card_ops at once (outside office hours it goes to the 24-hour card centre).',
          'Never ask for a card PIN.',
        ],
        ['check_account_number', 'to_card_ops', 'back_to_front_desk'],
      ),
      specialist(
        'appointments',
        'Appointments',
        'You book and cancel appointments: foreign worker account opening at a branch, and Velocity Payment or Trade module training.',
        [
          'Check the 12-digit account number first with check_account_number.',
          'Offer up to three free slots, read back the chosen date, time and branch, then book.',
          'To cancel, list the bookings and confirm which one.',
        ],
        ['check_account_number', 'list_appointment_slots', 'book_appointment', 'list_bookings', 'cancel_booking', 'back_to_front_desk'],
      ),
      specialist(
        'feedback',
        'Feedback',
        'You run the three-question phone survey.',
        ['Run ivr_survey, thank the caller, then end_call.'],
        ['ivr_survey', 'end_call'],
      ),
    ],
  };

  c.tests = sgTests();
  return c;
}

function specialist(id, name, role, rules, tools, conditional = []) {
  return {
    id,
    name,
    kind: 'specialist',
    instructions: {
      role,
      opening: 'Acknowledge what they need in a few words.',
      rules: [
        ...rules,
        'Answer in the caller’s language ({{state.language}}).',
        'When the request is done, ask if there is anything else; for something outside your role, use back_to_front_desk.',
      ],
      ...(conditional.length ? { conditional } : {}),
    },
    tools,
  };
}

// ---- tests (section 19): each answers the bank systems with made-up data, so nothing real is called
function sgTests() {
  const login = { connection: 'as400', method: 'POST', path: '/login' };
  const profile = {
    connection: 'as400',
    method: 'GET',
    path: '/cif/SG0001001',
    json: {
      found: true,
      cif: 'SG0001001',
      user_type: 'business',
      access_level: 'P',
      accounts: [{ number: '501234567001', last4: '7001', type: 'Current Account', currency: 'SGD' }],
      has_ca: true,
      has_acu: false,
      has_acu_chq: false,
      bizconn: true,
    },
  };
  const caller = { connection: 'cmm', method: 'GET', path: '/callers/*', json: { found: true, language: 'en', favourite_txn: 'balance', is_vip: false } };
  return [
    {
      id: 'balance_by_phone_code',
      description: 'A caller keys in their phone code and PIN, picks the account ending 7001, and hears the balance.',
      channel: 'phone',
      caller: { phone: '+6591234567', persona: 'Finance manager of a trading company, in a hurry' },
      http_mocks: [
        caller,
        { ...login, body_contains: { pin: '246810' }, json: { ok: true, code: 0, cif: 'SG0001001', user_type: 'business', access_level: 'P' } },
        { ...login, json: { ok: true, code: 0, phone_code_valid: true } },
        profile,
        {
          connection: 'as400',
          method: 'GET',
          path: '/cif/SG0001001/accounts/7001',
          json: { found: true, number: '501234567001', last4: '7001', type: 'Current Account', currency: 'SGD', cheques: true },
        },
        {
          connection: 'soa',
          method: 'GET',
          path: '/accounts/501234567001/balance',
          json: { found: true, account_last4: '7001', type: 'Current Account', currency: 'SGD', ledger_balance: 128450.75, available_balance: 126900.75 },
        },
        { connection: 'siebel', method: 'POST', path: '/service-requests', json: { ok: true, sr_number: 'SR-0000001' } },
      ],
      turns: [{ say: 'I’d like my account balance please.' }, { keys: '1234567#' }, { keys: '246810' }, { say: 'The one ending 7001.' }],
      expect: [
        { tool_called: 'verify_phone_code_keypad' },
        { tool_called: 'get_balance' },
        { state_equals: { state: 'verified', value: true } },
        { judge: 'Says the available balance (about 126,900 Singapore dollars) and never says the phone code or PIN aloud.' },
      ],
    },
    {
      id: 'stop_cheque_in_chat',
      description: 'A verified customer stops a cheque: the cheque number and the S$30 fee are confirmed before it is stopped.',
      channel: 'web-chat',
      http_mocks: [
        { ...login, body_contains: { pin: '246810' }, json: { ok: true, code: 0, cif: 'SG0001001', user_type: 'business', access_level: 'P' } },
        { ...login, json: { ok: true, code: 0, phone_code_valid: true } },
        profile,
        {
          connection: 'as400',
          method: 'GET',
          path: '/cif/SG0001001/accounts/7001',
          json: { found: true, number: '501234567001', last4: '7001', type: 'Current Account', currency: 'SGD', cheques: true },
        },
        {
          connection: 'as400',
          method: 'POST',
          path: '/cheques/501234567001/stop',
          json: { ok: true, cheque_no: '000232', fee_sgd: 30, reference: 'STP-100232' },
        },
      ],
      turns: [
        { say: 'I need to stop a cheque.' },
        { say: '1234567' },
        { say: '246810' },
        { say: 'Account ending 7001, cheque number 000232, it was lost in the mail.' },
        { say: 'Yes, please stop it.' },
      ],
      expect: [
        { tool_called: 'stop_cheque_payment' },
        { said_matches: 'STP-100232' },
        { judge: 'Mentions the S$30 fee and confirms the cheque number before stopping it.' },
      ],
    },
    {
      id: 'personal_customer_redirected',
      description: 'A personal banking customer on the business line is told the right number.',
      channel: 'web-chat',
      http_mocks: [
        { ...login, body_contains: { pin: '111111' }, json: { ok: true, code: 0, cif: 'SG0009009', user_type: 'personal', access_level: 'P' } },
        { ...login, json: { ok: true, code: 0, phone_code_valid: true } },
        { connection: 'as400', method: 'GET', path: '/cif/SG0009009', json: { found: true, cif: 'SG0009009', user_type: 'personal', accounts: [] } },
      ],
      turns: [{ say: 'What is my balance?' }, { say: '1111111' }, { say: '111111' }],
      expect: [{ said_matches: '1800 363 3333' }, { tool_not_called: 'get_balance' }],
    },
    {
      id: 'prime_rate_no_verification',
      description: 'Scripted (no model): the prime rate is answered by the Info Desk with no verification.',
      channel: 'web-chat',
      http_mocks: [{ connection: 'as400', method: 'GET', path: '/rates/prime', json: { prime_rate_pct: 5.35 } }],
      turns: [{ say: 'What is your prime rate?' }],
      model_script: [{ tool: 'go_to_info_desk' }, { tool: 'get_prime_rate' }, 'Our prime lending rate is 5.35 per cent per annum.'],
      expect: [{ tool_called: 'get_prime_rate' }, { tool_not_called: 'verify_phone_code_spoken' }, { said_matches: '5\\.35' }],
    },
    {
      id: 'card_loss_after_hours',
      description: 'A lost corporate ATM card on a Saturday goes to the 24-hour card centre.',
      channel: 'phone',
      now: '2026-10-31T21:00:00+08:00',
      http_mocks: [
        caller,
        { connection: 'siebel', method: 'POST', path: '/account-login', json: { found: true, cif: 'SG0001001', name: 'Acme Trading Pte Ltd', dormant: false } },
      ],
      turns: [{ say: 'I lost our company ATM card!' }, { say: '501234567001' }],
      expect: [{ tool_called: 'check_account_number' }, { tool_called: 'to_card_ops' }],
    },
    {
      id: 'foreign_worker_booking',
      description: 'A foreign worker account opening is booked at a branch after the account number is checked.',
      channel: 'web-chat',
      http_mocks: [
        { connection: 'siebel', method: 'POST', path: '/account-login', json: { found: true, cif: 'SG0001001', name: 'Acme Trading Pte Ltd', dormant: false } },
        {
          connection: 'cmm',
          method: 'GET',
          path: '/appointments/slots',
          json: { items: [{ slot_id: 'S1', date: '2026-10-28', time: '10:00', branch_name: 'Tampines' }] },
        },
        {
          connection: 'cmm',
          method: 'POST',
          path: '/appointments',
          json: { ok: true, booking_id: 'BK-424242', date: '2026-10-28', time: '10:00', branch: 'Tampines' },
        },
      ],
      turns: [
        { say: 'I want to open accounts for our foreign workers.' },
        { say: '501234567001' },
        { say: 'The Tampines one is fine. Tan Wei Ming will attend.' },
        { say: 'Yes, book it.' },
      ],
      expect: [{ tool_called: 'book_appointment' }, { said_matches: 'BK-424242' }],
    },
    {
      id: 'survey_three_ratings',
      description: 'The caller gives feedback: three ratings are saved.',
      channel: 'web-chat',
      http_mocks: [{ connection: 'cmm', method: 'POST', path: '/surveys', json: { ok: true } }],
      turns: [{ say: 'I’d like to give some feedback.' }, { say: '5' }, { say: '4' }, { say: '5' }],
      expect: [{ tool_called: 'ivr_survey' }, { http_called: { method: 'POST', path: '/surveys' } }],
    },
  ];
}
