// SG Service Manager Survey (an internal number, reached only by a service manager's transfer): one standalone agent (design sections 4 and 17).
// Three questions about the service manager, each rated 1 to 5, under the service manager's profile (BI or BC); the answers are saved in CMM.
import { baseConfig, commonState, connections, endCall, httpTool, num, onDecline, onFailure, params, say, str } from './common.mjs';

export function sgServiceManagerSurvey(mockUrl) {
  const c = baseConfig({
    id: 'sg-sm-survey',
    name: 'SG Service Manager Survey',
    description:
      'OCBC Singapore service manager survey: three questions about the service manager the caller just spoke with, rated 1 to 5, for the BI and BC profiles.',
    tags: ['ocbc', 'singapore', 'business-banking', 'survey'],
    market: 'sg',
    persona: 'OCBC survey assistant',
  });
  c.connections = connections(mockUrl, { cmm: '/sg/cmm' });
  c.messages.push(
    say(
      'greeting',
      'Thank you for taking our short survey about your Service Manager. There are three questions; please answer each from 1 for poor to 5 for excellent.',
      '感谢您参与关于客户经理的简短调查。共有三个问题，请以1（差）至5（优秀）作答。',
    ),
    say('thanks', 'Thank you for your feedback. Goodbye.', '感谢您的宝贵意见。再见。'),
  );
  c.state = {
    variables: {
      ...commonState(),
      profile: {
        type: 'string',
        default: 'BI',
        description: 'The service manager’s profile, BI or BC, from the transfer (participant attribute or the service manager’s choice).',
      },
    },
  };
  c.tasks = [
    {
      id: 'sm_survey',
      kind: 'collect_fields',
      description: 'Three ratings from 1 (poor) to 5 (excellent) about the service manager.',
      instructions: 'Ask the three questions in order, one at a time; take a number from 1 to 5 for each.',
      steps: [
        {
          id: 'q1',
          type: 'collect',
          ask: 'On a scale of 1 to 5, how would you rate the officer’s greeting and overall manner?',
          input: 'speech',
          validate: { type: 'regex', pattern: '^[1-5]$' },
        },
        {
          id: 'q2',
          type: 'collect',
          ask: 'On a scale of 1 to 5, how well was the officer able to answer your query?',
          input: 'speech',
          validate: { type: 'regex', pattern: '^[1-5]$' },
        },
        {
          id: 'q3',
          type: 'collect',
          ask: 'On a scale of 1 to 5, please rate your overall experience with your Service Manager.',
          input: 'speech',
          validate: { type: 'tool', tool: 'save_survey' },
          pass_when: { result: '$.ok', equals: true },
        },
      ],
      max_attempts: 3,
      on_success: { resume: 'caller', silent: true },
      on_failure: onFailure,
      on_decline: onDecline,
    },
  ];
  c.tools = [
    endCall,
    { id: 'sm_survey', type: 'task', task: 'sm_survey', description: 'Run the three-question survey about the service manager.' },
    httpTool(
      'cmm',
      'save_survey',
      'Save the three ratings under the service manager’s profile.',
      { method: 'POST', path: '/surveys', body: { profile: '{{args.profile}}', q1: '{{args.q1}}', q2: '{{args.q2}}', q3: '{{args.q3}}' } },
      {
        parameters: params({ profile: str('BI or BC.', { enum: ['BI', 'BC'] }), q1: num('Rating 1–5.'), q2: num('Rating 1–5.'), q3: num('Rating 1–5.') }),
        result: { to_llm: ['ok'] },
      },
    ),
  ];
  c.agents = {
    entry: 'survey_desk',
    items: [
      {
        id: 'survey_desk',
        name: 'Survey desk',
        kind: 'standalone',
        instructions: {
          role: 'You run a three-question survey about the service manager the caller has just spoken with. Nothing else.',
          opening: 'The introduction has been said. Start the survey at once with sm_survey.',
          rules: [
            'The profile is {{state.profile}} (BI or BC): save the ratings under it.',
            'After the third answer, thank the caller and call end_call.',
            'If they want something else, tell them kindly that this line only takes the survey, and end the call.',
          ],
        },
        tools: ['sm_survey', 'end_call'],
      },
    ],
  };
  // a survey ends with thanks, not the bank's usual goodbye
  c.tools[0] = { ...endCall, params: { say: { message: 'thanks' } } };
  c.messages = c.messages.filter((m) => !['unable_to_proceed', 'host_error', 'callback_saved', 'goodbye'].includes(m.id));
  c.guardrails.limits = { ...c.guardrails.limits, max_call_duration_s: 300 };
  c.tests = [
    {
      id: 'three_ratings_saved',
      description: 'The caller answers the three questions; the ratings are saved under the BC profile.',
      channel: 'web-chat',
      state: { profile: 'BC' },
      http_mocks: [{ connection: 'cmm', method: 'POST', path: '/surveys', json: { ok: true } }],
      turns: [{ say: '5' }, { say: '4' }, { say: '5' }],
      expect: [{ tool_called: 'sm_survey' }, { http_called: { method: 'POST', path: '/surveys' } }],
    },
  ];
  return c;
}
