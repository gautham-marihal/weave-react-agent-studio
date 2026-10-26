// SG Investigations (6586 5292): one standalone agent (design section 14, "VIP and Investigations"). The caller chooses a language once, gives the
// 12-digit account number of the case (checked in Siebel), and is put through to the service manager handling it. If that service manager is
// not free, the caller chooses the investigations team or a call-back; outside office hours, a call-back. A failed account check goes to BI.
import { PHONE, WEB, baseConfig, collect, commonState, connections, endCall, httpTool, onDecline, onFailure, onSuccess, params, say, str } from './common.mjs';

export function sgInvestigations(mockUrl) {
  const c = baseConfig({
    id: 'sg-investigations',
    name: 'SG Investigations',
    description:
      'OCBC Singapore investigations line (6586 5292): finds the caller’s case by account number and puts them through to the service manager handling it, or arranges a call-back.',
    tags: ['ocbc', 'singapore', 'business-banking', 'investigations', 'phone'],
    market: 'sg',
    persona: 'OCBC Investigations assistant',
  });
  c.connections = connections(mockUrl, { siebel: '/sg/siebel', cmm: '/sg/cmm', aacc: '/sg/aacc' });
  c.schedules = {
    bbcsc_hours: {
      description: 'When service managers take calls: 8:30 am to 6:00 pm, Monday to Friday, Singapore time.',
      timezone: 'Asia/Singapore',
      weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '08:30', end: '18:00' }],
      holidays: ['2026-12-25', '2027-01-01', '2027-02-06', '2027-02-08'],
    },
  };
  c.messages.push(
    say('greeting', 'Welcome to OCBC Bank Investigations. For English, say English; 请说中文。', '欢迎致电华侨银行调查部。'),
    say(
      'closed_hours',
      'Thank you for calling OCBC Bank. Our Commercial Service Centre is operational from 8:30 am to 6:00 pm, Monday to Friday. I can arrange for the service manager to call you back.',
      '感谢您致电华侨银行。我们的商业服务中心服务时间为星期一至星期五上午8点30分至下午6点。我可以安排客户经理给您回电。',
    ),
    say('sm_unavailable', 'The previous Service Manager you spoke with is unavailable.', '您之前联系的客户经理目前无法接听。'),
  );
  c.state = {
    variables: {
      ...commonState(),
      account_number: { type: 'string', nullable: true, default: null, sensitive: true },
      case_id: { type: 'string', default: '' },
      case_topic: { type: 'string', default: '' },
      last_sm_id: { type: 'string', default: '' },
      last_sm_name: { type: 'string', default: '' },
    },
  };
  const verifyAccount = (keypad) => ({
    id: keypad ? 'find_case_keypad' : 'find_case_spoken',
    kind: 'verification',
    description: 'Find the caller’s case from the 12-digit account number, and who handles it.',
    instructions: 'Ask for the account number; the tools decide. Never repeat the number.',
    use_prior_context: true,
    steps: [
      collect('account', keypad ? 'Ask them to key in the 12-digit account number of the case.' : 'Ask for the 12-digit account number of the case.', {
        keypad,
        digits: 12,
        storeIn: 'account_number',
        validate: { type: 'tool', tool: 'check_account', ...(keypad ? { args: { account: '{{value}}' } } : {}) },
        passWhen: { result: '$.found', equals: true },
        onExhausted: [{ type: 'transfer', transfer: 'bi_queue' }],
      }),
      {
        id: 'case',
        type: 'call',
        do: [
          {
            type: 'http',
            connection: 'siebel',
            method: 'GET',
            path: '/accounts/{{state.account_number}}/investigation',
            to_state: { case_id: '$.case_id', case_topic: '$.topic', last_sm_id: '$.last_service_manager.id', last_sm_name: '$.last_service_manager.name' },
          },
        ],
        pass_when: { state: 'last_sm_id', not_equals: '' },
        max_attempts: 1,
      },
    ],
    max_attempts: 3,
    on_success: onSuccess,
    on_failure: onFailure,
    on_decline: onDecline,
  });
  c.tasks = [verifyAccount(true), verifyAccount(false)];
  const siebel = (...a) => httpTool('siebel', ...a);
  c.tools = [
    endCall,
    {
      id: 'find_case_keypad',
      name: 'find_case',
      type: 'task',
      task: 'find_case_keypad',
      channels: PHONE,
      description: 'Find the caller’s case by account number.',
    },
    {
      id: 'find_case_spoken',
      name: 'find_case',
      type: 'task',
      task: 'find_case_spoken',
      channels: WEB,
      description: 'Find the caller’s case by account number.',
    },
    siebel(
      'check_account',
      'Look up a 12-digit account number in Siebel.',
      { method: 'POST', path: '/account-login', body: { account: '{{args.account}}' } },
      {
        parameters: params({ account: str('Twelve digits.') }),
        result: { to_llm: ['found', 'name'], to_state: { cif: '$.cif' } },
      },
    ),
    {
      id: 'to_case_service_manager',
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'Put the caller through to the service manager handling their case ({{state.last_sm_name}}).',
      params: { transfer: 'case_service_manager', fallback: [{ type: 'say', text: { message: 'sm_unavailable' } }] },
    },
    {
      id: 'to_investigations_team',
      type: 'builtin',
      builtin: 'transfer_or_callback',
      description: 'Put the caller through to the investigations team, when their own service manager is not free and they choose that.',
      params: { transfer: 'investigations_team', fallback: [{ type: 'say', text: { message: 'closed_hours' } }] },
    },
    httpTool(
      'cmm',
      'request_callback',
      'Ask the service manager to call back: on the caller ID, or another number of 5 to 15 digits.',
      { method: 'POST', path: '/callbacks', body: { caller: '{{state.caller_number}}', number: '{{args.number}}', reason: 'Investigation {{state.case_id}}' } },
      {
        parameters: params({ number: str('The number to call back: the caller ID unless they give another.') }),
        result: { to_llm: ['ok', 'request_id', 'reason'] },
        extraEffects: [{ when: { result: '$.ok', equals: true }, do: [{ type: 'say', text: { message: 'callback_saved' } }, { type: 'end_call' }] }],
      },
    ),
  ];
  const aacc = (id, description, skillset, extra = {}) => ({
    id,
    description,
    method: 'http_request',
    target: skillset,
    request: {
      connection: 'aacc',
      method: 'POST',
      path: '/transfer',
      body: { skillset: '{{target}}', cif: '{{state.cif}}', intent: 'investigation', ...extra },
    },
    schedule: 'bbcsc_hours',
    closed: [{ type: 'say', text: { message: 'closed_hours' } }],
    delay_s: 1,
    on_failure: [{ type: 'say', text: { message: 'sm_unavailable' } }],
  });
  c.telephony = {
    transfers: [
      aacc('case_service_manager', 'The service manager handling the caller’s case.', 'INVESTIGATE', {
        service_manager_id: '{{state.last_sm_id}}',
        case_id: '{{state.case_id}}',
      }),
      aacc('investigations_team', 'The investigations team.', 'INVESTIGATE', { case_id: '{{state.case_id}}' }),
      aacc('bi_queue', 'The business banking queue, when the account cannot be found.', 'BI'),
    ],
  };
  c.agents = {
    entry: 'investigations_desk',
    items: [
      {
        id: 'investigations_desk',
        name: 'Investigations desk',
        kind: 'standalone',
        instructions: {
          role: 'You answer the OCBC investigations line: you find the caller’s case and put them through to the service manager handling it.',
          opening: 'Ask once which language they prefer, English or Mandarin, then use it.',
          rules: [
            'Use find_case. Then say the case number and who handles it ({{state.last_sm_name}}), and to_case_service_manager.',
            'If that service manager is not free: offer the investigations team (to_investigations_team) or a call-back (request_callback).',
            'Outside office hours, offer a call-back.',
            'When the call is passed on, or the caller has nothing more, call end_call.',
          ],
        },
        tools: ['find_case_keypad', 'find_case_spoken', 'to_case_service_manager', 'to_investigations_team', 'request_callback', 'end_call'],
      },
    ],
  };
  c.messages = c.messages.filter((m) => m.id !== 'unable_to_proceed' && m.id !== 'host_error');
  c.tests = [
    {
      id: 'case_to_its_service_manager',
      description: 'The caller gives the account number; the case is found and they are put through to Rachel Ng.',
      channel: 'web-chat',
      now: '2026-10-27T11:00:00+08:00',
      http_mocks: [
        { connection: 'siebel', method: 'POST', path: '/account-login', json: { found: true, cif: 'SG0004004', name: 'Goh Holdings Pte Ltd', dormant: false } },
        {
          connection: 'siebel',
          method: 'GET',
          path: '/accounts/509876543210/investigation',
          json: { found: true, case_id: 'INV-77120', topic: 'Inward remittance trace', last_service_manager: { id: 'sm_rachel', name: 'Rachel Ng' } },
        },
        { connection: 'aacc', method: 'POST', path: '/transfer', json: { ok: true, transferred: true } },
      ],
      turns: [{ say: 'English please.' }, { say: '509876543210' }],
      expect: [{ tool_called: 'find_case_spoken' }, { tool_called: 'to_case_service_manager' }, { said_matches: 'INV-77120' }],
    },
  ];
  return c;
}
