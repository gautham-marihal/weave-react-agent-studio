// SG Business Banking VIP (6538 2222): one standalone agent (design section 14, "VIP and Investigations"). The caller ID is looked up in the VIP
// table before anyone speaks; a VIP is checked the way their entry says (account number, phone code, or nothing), then put through to the service
// manager they spoke with last. If that service manager is not free, the caller chooses another service manager or a call-back. Outside office
// hours the caller is offered a call-back. A caller who is not a VIP is pointed to the main business banking line.
import { PHONE, WEB, baseConfig, collect, commonState, connections, endCall, httpTool, onDecline, onFailure, onSuccess, params, say, str } from './common.mjs';

export function sgVip(mockUrl) {
  const c = baseConfig({
    id: 'sg-vip-desk',
    name: 'SG Business Banking VIP',
    description:
      'OCBC Singapore VIP business banking line (6538 2222): greets a VIP by name in their language, checks them, and puts them through to their own service manager, or arranges a call-back.',
    tags: ['ocbc', 'singapore', 'business-banking', 'vip', 'phone'],
    market: 'sg',
    persona: 'OCBC VIP Banking assistant',
  });
  c.connections = connections(mockUrl, { as400: '/sg/as400', cmm: '/sg/cmm', aacc: '/sg/aacc' });
  c.schedules = {
    bbcsc_hours: {
      description: 'When service managers take calls: 8:30 am to 6:00 pm, Monday to Friday, Singapore time.',
      timezone: 'Asia/Singapore',
      weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:30', end: '18:00' }],
      holidays: ['2026-12-25', '2027-01-01', '2027-02-06', '2027-02-08'],
    },
  };
  c.messages.push(
    say('greeting', 'Welcome to OCBC Business Banking VIP service.', '欢迎致电华侨银行商业银行贵宾服务。'),
    say(
      'closed_hours',
      'Thank you for calling OCBC Bank. Our Commercial Service Centre is operational from 8:30 am to 6:00 pm, Monday to Friday. I can arrange for your service manager to call you back.',
      '感谢您致电华侨银行。我们的商业服务中心服务时间为星期一至星期五上午8点30分至下午6点。我可以安排您的客户经理给您回电。',
    ),
    say('sm_unavailable', 'The previous Service Manager you spoke with is unavailable.', '您之前联系的客户经理目前无法接听。'),
    say(
      'not_vip',
      'This line is for our VIP customers. Please call our business banking line on 6538 1111.',
      '这条热线为贵宾客户服务。请拨打商业银行热线6538 1111。',
    ),
  );
  c.state = {
    variables: {
      ...commonState(),
      is_vip: { type: 'boolean', default: false },
      vip_name: { type: 'string', default: '' },
      vip_type: { type: 'string', default: '', description: 'account (check the account number), phone_code (phone code and PIN), or default (no check).' },
      last_sm_id: { type: 'string', default: '' },
      last_sm_name: { type: 'string', default: '' },
      account_number: { type: 'string', nullable: true, default: null, sensitive: true },
    },
  };
  // the VIP table, read by caller ID before anyone speaks
  c.events = [
    {
      on: 'call_started',
      do: [
        {
          type: 'http',
          connection: 'cmm',
          method: 'GET',
          path: '/vip/{{state.caller_number}}',
          skip_when_empty: '{{state.caller_number}}',
          to_state: {
            is_vip: '$.found',
            vip_name: '$.name',
            vip_type: '$.vip_type',
            language: '$.language',
            last_sm_id: '$.last_service_manager.id',
            last_sm_name: '$.last_service_manager.name',
          },
        },
      ],
    },
    // not in the VIP table: the main business banking line (p. 31)
    { on: 'call_started', when: { state: 'is_vip', equals: false }, do: [{ type: 'end_call', say: { message: 'not_vip' } }] },
  ];
  // checking a VIP by account number or by phone code and PIN (keypad on the phone, spoken in the browser)
  const verifyAccount = (keypad) => ({
    id: keypad ? 'verify_vip_account_keypad' : 'verify_vip_account_spoken',
    kind: 'verification',
    description: 'Check a VIP by their 12-digit account number.',
    instructions: 'Confirm who the caller is; the tool decides. Never repeat the number.',
    use_prior_context: true,
    steps: [
      collect('account', keypad ? 'Ask them to key in their 12-digit account number.' : 'Ask for their 12-digit account number.', {
        keypad,
        digits: 12,
        storeIn: 'account_number',
        validate: { type: 'tool', tool: 'check_vip_account', ...(keypad ? { args: { account: '{{value}}' } } : {}) },
        passWhen: { result: '$.valid', equals: true },
      }),
    ],
    max_attempts: 3,
    on_success: onSuccess,
    on_failure: onFailure,
    on_decline: onDecline,
  });
  const verifyPhoneCode = (keypad) => ({
    id: keypad ? 'verify_vip_phone_code_keypad' : 'verify_vip_phone_code_spoken',
    kind: 'verification',
    description: 'Check a VIP by their phone code and PIN.',
    instructions: 'Confirm who the caller is; the tool decides. Never repeat a code.',
    use_prior_context: true,
    attempts_scope: 'task',
    steps: [
      collect('phone_code', keypad ? 'Ask them to key in their 7-digit phone code.' : 'Ask for their 7-digit phone code.', {
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
      }),
    ],
    max_attempts: 3,
    on_success: onSuccess,
    on_failure: onFailure,
    on_decline: onDecline,
  });
  c.tasks = [verifyAccount(true), verifyAccount(false), verifyPhoneCode(true), verifyPhoneCode(false)];

  const cmm = (...a) => httpTool('cmm', ...a);
  const as400 = (...a) => httpTool('as400', ...a);
  c.tools = [
    endCall,
    {
      id: 'verify_vip_account_keypad',
      name: 'verify_vip_account',
      type: 'task',
      task: 'verify_vip_account_keypad',
      channels: PHONE,
      description: 'Check a VIP whose type is account.',
    },
    {
      id: 'verify_vip_account_spoken',
      name: 'verify_vip_account',
      type: 'task',
      task: 'verify_vip_account_spoken',
      channels: WEB,
      description: 'Check a VIP whose type is account.',
    },
    {
      id: 'verify_vip_phone_code_keypad',
      name: 'verify_vip_phone_code',
      type: 'task',
      task: 'verify_vip_phone_code_keypad',
      channels: PHONE,
      description: 'Check a VIP whose type is phone code.',
    },
    {
      id: 'verify_vip_phone_code_spoken',
      name: 'verify_vip_phone_code',
      type: 'task',
      task: 'verify_vip_phone_code_spoken',
      channels: WEB,
      description: 'Check a VIP whose type is phone code.',
    },
    cmm(
      'check_vip_account',
      'Check the account number against the VIP table.',
      { method: 'POST', path: '/vip/{{state.caller_number}}/check-account', body: { account: '{{args.account}}' } },
      {
        parameters: params({ account: str('Twelve digits.') }),
        result: { to_llm: ['valid'] },
      },
    ),
    as400(
      'check_phone_code',
      'Check a phone code.',
      { method: 'POST', path: '/login', body: { phone_code: '{{args.phone_code}}' } },
      { parameters: params({ phone_code: str('Seven digits.') }), result: { to_llm: ['ok', 'code'] } },
    ),
    as400(
      'check_pin',
      'Check the PIN for the phone code just given.',
      { method: 'POST', path: '/login', body: { phone_code: '{{state.phone_code}}', pin: '{{args.pin}}' } },
      {
        parameters: params({ pin: str('Six digits.') }),
        result: { to_llm: ['ok', 'code'], to_state: { cif: '$.cif' } },
      },
    ),
    {
      id: 'to_last_service_manager',
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'Put the VIP through to the service manager they spoke with last ({{state.last_sm_name}}). Once they are checked.',
      params: { transfer: 'last_service_manager', fallback: [{ type: 'say', text: { message: 'sm_unavailable' } }] },
    },
    {
      id: 'to_service_manager_group',
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'Put the caller through to another service manager in the same group, when their own is not free and they choose that.',
      params: { transfer: 'service_manager_group', fallback: [{ type: 'say', text: { message: 'closed_hours' } }] },
    },
    cmm(
      'request_callback',
      'Ask the service manager to call back: on the caller ID, or another number of 5 to 15 digits.',
      {
        method: 'POST',
        path: '/callbacks',
        body: { caller: '{{state.caller_number}}', number: '{{args.number}}', reason: 'VIP call-back for {{state.last_sm_name}}' },
      },
      {
        parameters: params({ number: str('The number to call back: the caller ID unless they give another.') }),
        result: { to_llm: ['ok', 'request_id', 'reason'] },
        extraEffects: [{ when: { result: '$.ok', equals: true }, do: [{ type: 'say', text: { message: 'callback_saved' } }, { type: 'end_call' }] }],
      },
    ),
  ];
  const aacc = (id, description, body) => ({
    id,
    description,
    method: 'http_request',
    target: 'VIP',
    request: { connection: 'aacc', method: 'POST', path: '/transfer', body },
    schedule: 'bbcsc_hours',
    closed: [{ type: 'say', text: { message: 'closed_hours' } }],
    delay_s: 1,
    on_failure: [{ type: 'say', text: { message: 'sm_unavailable' } }],
  });
  c.telephony = {
    transfers: [
      aacc('last_service_manager', 'The service manager the VIP spoke with last.', {
        skillset: 'VIP',
        service_manager_id: '{{state.last_sm_id}}',
        cif: '{{state.cif}}',
        intent: 'vip',
      }),
      aacc('service_manager_group', 'Any service manager in the VIP’s group.', { skillset: 'VIP-GROUP', cif: '{{state.cif}}', intent: 'vip' }),
    ],
  };
  c.agents = {
    entry: 'vip_desk',
    items: [
      {
        id: 'vip_desk',
        name: 'VIP desk',
        kind: 'standalone',
        instructions: {
          role: 'You answer the OCBC VIP business banking line. You greet the VIP by name, check them the way their VIP entry says, and put them through to their own service manager.',
          opening: 'Greet {{state.vip_name}} by name in their language ({{state.language}}), and ask if they would like to speak with {{state.last_sm_name}}.',
          rules: [
            'VIP type account: verify_vip_account. Type phone_code: verify_vip_phone_code. Type default: no check.',
            'Then to_last_service_manager. If that service manager is not free, offer: another service manager (to_service_manager_group), or a call-back (request_callback).',
            'Outside office hours, offer a call-back.',
            'When the call is passed on, or the caller has nothing more, call end_call.',
          ],
        },
        tools: [
          'verify_vip_account_keypad',
          'verify_vip_account_spoken',
          'verify_vip_phone_code_keypad',
          'verify_vip_phone_code_spoken',
          'to_last_service_manager',
          'to_service_manager_group',
          'request_callback',
          'end_call',
        ],
        on_enter: [{ type: 'say', text: { message: 'greeting' } }],
      },
    ],
  };
  // the greeting is said by the agent itself (it names the VIP), so the channels do not repeat one
  c.channels.forEach((ch) => delete ch.greeting);
  c.messages = c.messages.filter((m) => m.id !== 'unable_to_proceed' && m.id !== 'host_error');

  c.tests = [
    {
      id: 'vip_to_own_service_manager',
      description: 'A VIP checked by account number is put through to Rachel Ng, the service manager they spoke with last.',
      channel: 'web-chat',
      state: {
        caller_number: '+6598765432',
        is_vip: true,
        vip_name: 'Mr Goh Kian Huat',
        vip_type: 'account',
        last_sm_id: 'sm_rachel',
        last_sm_name: 'Rachel Ng',
      },
      now: '2026-10-27T10:00:00+08:00',
      http_mocks: [
        { connection: 'cmm', method: 'POST', path: '/vip/*/check-account', json: { valid: true } },
        { connection: 'aacc', method: 'POST', path: '/transfer', json: { ok: true, transferred: true, queue: 'VIP' } },
      ],
      turns: [{ say: 'Yes, I’d like to speak to Rachel.' }, { say: '509876543210' }],
      expect: [{ tool_called: 'verify_vip_account_spoken' }, { tool_called: 'to_last_service_manager' }],
    },
    {
      id: 'vip_callback_after_hours',
      description: 'After hours, a VIP is offered a call-back and it is saved.',
      channel: 'web-chat',
      state: {
        caller_number: '+6596660000',
        is_vip: true,
        vip_name: 'Mr Arjun Pillai',
        vip_type: 'default',
        last_sm_id: 'sm_rachel',
        last_sm_name: 'Rachel Ng',
      },
      now: '2026-10-31T20:00:00+08:00',
      http_mocks: [{ connection: 'cmm', method: 'POST', path: '/callbacks', json: { ok: true, request_id: 'CB-100200' } }],
      turns: [{ say: 'I need to speak to Rachel.' }, { say: 'Yes, call me back on this number please.' }],
      expect: [{ tool_called: 'request_callback' }],
    },
  ];
  return c;
}
