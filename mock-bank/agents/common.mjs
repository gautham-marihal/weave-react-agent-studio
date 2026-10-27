// What the six business-banking agents share: models, languages, channels, the fixed lines every one of them says, guardrails, what is kept after
// a call, and small builders for tools and verification steps. Each agent's own file (sgBusinessBanking.mjs...) adds its specialists, tools,
// transfers and tests. The bank systems are the mock API (mock-bank/server.mjs) at `mockUrl`.

// ---- the parts of an agent configuration that are the same for every agent
export function baseConfig({ id, name, description, tags, market, persona }) {
  const sg = market === 'sg';
  return {
    schema_version: '1.2',
    meta: { id, name, version: '1.0.0', status: 'draft', description, tags, owner: sg ? 'sg-bbcsc' : 'my-contact-centre' },
    runtime: { engine: 'livekit-agents', provider_mode: 'plugins', timezone: sg ? 'Asia/Singapore' : 'Asia/Kuala_Lumpur' },
    defaults: {
      models: {
        llm: { provider: 'openai', model: 'gpt-4.1-mini', api_key: { secret: 'OPENAI_API_KEY' }, temperature: 0.2 },
        // no fixed language: the caller may speak English, Mandarin or Malay
        stt: { provider: 'openai', model: 'gpt-4o-mini-transcribe', api_key: { secret: 'OPENAI_API_KEY' } },
        tts: { provider: 'elevenlabs', model: 'eleven_flash_v2_5', api_key: { secret: 'ELEVEN_API_KEY' }, voice_id: 'hpp4J3VqNfWAUOO0d1Us' },
      },
      conversation: {
        inactivity: {
          enabled: true,
          timeout_s: 10,
          max_nudges: 2,
          nudges: [
            { type: 'say', text: { message: 'still_there' } },
            { type: 'say', text: { message: 'still_there_final' } },
          ],
          on_exhausted: { do: [{ type: 'end_call', say: { message: 'inactivity_goodbye' } }] },
        },
      },
      language: sg ? { primary: 'en-SG', speaks: ['en', 'zh'] } : { primary: 'en-MY', speaks: ['en', 'ms', 'zh'] },
    },
    persona: {
      name: persona,
      company: 'OCBC Bank',
      tone: 'professional, warm and efficient; plain language',
      style_rules: [
        'One question at a time.',
        'Short sentences: this is a phone call.',
        'Say amounts, dates and account endings in words.',
        'Answer in the language the caller uses; switch at once if they ask for another.',
      ],
      shared_rules: [
        'Only state account, cheque, card and rate facts a tool returned; never guess them.',
        'Before anything about an account, the caller must be verified by the verification tool.',
        'Never read out a full account number, NRIC, IC, phone code, PIN or one-time password; say only the last four digits of an account.',
        'Banking topics only: politely decline anything else, and offer a service manager if the caller insists.',
        'If the caller asks for a person, or is upset, offer a service manager straight away.',
      ],
      disclosures: { recording_notice: 'This call may be recorded for quality and training purposes.' },
    },
    messages: [
      say('still_there', 'Are you still there?', '您还在吗？', 'Adakah anda masih di talian?'),
      say(
        'still_there_final',
        'I haven’t heard from you. I’ll end the call if there is no reply.',
        '我没有听到您的回应。如果没有回复，我将结束通话。',
        'Saya tidak mendengar sebarang jawapan. Panggilan akan ditamatkan jika tiada jawapan.',
      ),
      say(
        'inactivity_goodbye',
        'Thank you for calling OCBC Bank. Goodbye.',
        '感谢您致电华侨银行。再见。',
        'Terima kasih kerana menghubungi OCBC Bank. Selamat tinggal.',
      ),
      say('goodbye', 'Thank you for banking with OCBC. Goodbye.', '感谢您选择华侨银行。再见。', 'Terima kasih kerana berurusan dengan OCBC. Selamat tinggal.'),
      say(
        'unable_to_proceed',
        'Sorry, we are unable to proceed with your request.',
        '抱歉，我们无法处理您的请求。',
        'Maaf, kami tidak dapat meneruskan permintaan anda.',
      ),
      say(
        'host_error',
        'Sorry, our system is not available right now. Let me connect you to a service manager.',
        '抱歉，系统暂时无法使用。我为您转接客户经理。',
        'Maaf, sistem kami tidak tersedia sekarang. Saya akan sambungkan anda kepada pegawai perkhidmatan.',
      ),
      say(
        'callback_saved',
        'Our Service Manager will return your call as soon as possible. Goodbye.',
        '我们的客户经理会尽快给您回电。再见。',
        'Pegawai Perkhidmatan kami akan menghubungi anda semula secepat mungkin. Selamat tinggal.',
      ),
    ],
    identity: {
      caller_id: {
        sources: [
          { from: 'participant_attribute', name: 'sip.phoneNumber' },
          { from: 'participant_identity', strip: ['^sip[:_]', '@.*$'] },
        ],
        normalize: { type: 'e164', default_country: sg ? 'SG' : 'MY' },
      },
    },
    channels: channels(id),
    guardrails: guardrails(),
    post_call: postCall(),
  };
}

// a fixed line in English, Mandarin and (for Malaysia) Malay
export function say(id, en, zh, ms, extra = {}) {
  return { id, text: { en, ...(zh ? { zh } : {}), ...(ms ? { ms } : {}) }, ...extra };
}

// The phone line (keypad on), and a voice and a chat channel in the browser so the agent can be tried from the studio's Test page.
function channels(id) {
  return [
    {
      id: 'phone',
      type: 'sip_voice',
      enabled: true,
      entry: {},
      modalities: { input: ['audio'], output: ['audio'] },
      capabilities: { dtmf: true, human_transfer: true },
      greeting: { say: { message: 'greeting' }, allow_interruptions: false },
      instructions_append:
        'This is a phone call. Phone codes, PINs and one-time passwords are only ever keyed in on the keypad, through the verification tools.',
    },
    {
      id: 'web-voice',
      type: 'web_voice',
      enabled: true,
      entry: { widget_id: `${id}-voice` },
      modalities: { input: ['audio'], output: ['audio'] },
      greeting: { say: { message: 'greeting' } },
      instructions_append: 'This is a voice call in the browser (a test line): there is no keypad, so the caller says codes and digits aloud.',
    },
    {
      id: 'web-chat',
      type: 'web_chat',
      enabled: true,
      entry: { widget_id: `${id}-chat` },
      modalities: { input: ['text'], output: ['text'] },
      greeting: { say: { message: 'greeting' } },
      instructions_append: 'This is a web chat (a test line): the customer types codes and digits.',
    },
  ];
}

export const PHONE = ['phone'];
export const WEB = ['web-voice', 'web-chat'];

function guardrails() {
  return {
    input: [
      { id: 'prompt_injection', type: 'prompt_injection', enforcement: 'code', on_trigger: { action: 'deflect', say: 'I can only help with OCBC banking.' } },
      {
        id: 'card_and_id_numbers',
        type: 'pii_detect',
        entities: ['card_number', 'bank_account', 'national_id'],
        enforcement: 'code',
        on_trigger: { action: 'redact_in_logs' },
      },
    ],
    output: [
      {
        id: 'no_secrets',
        type: 'statement',
        text: 'Never ask for or repeat a phone code, PIN or one-time password; they are keyed in through the verification tools.',
        enforcement: 'prompt',
      },
      { id: 'no_advice', type: 'statement', text: 'Give no investment, tax or legal advice; offer a service manager instead.', enforcement: 'prompt' },
    ],
    // the design's limits (section 15): three tries per input, a long silence ends the call
    limits: { max_call_duration_s: 1200, max_silence_s: 600, max_tool_calls_per_call: 40, max_handoffs_per_call: 10 },
  };
}

function postCall() {
  return {
    redaction: {
      enabled: true,
      entities: ['card_number', 'bank_account', 'national_id', 'otp', 'pin', 'phone_number'],
      mask_sensitive_state: true,
    },
    artifacts: [{ kind: 'transcript', sink: { type: 'file', directory: 'transcripts' } }],
  };
}

// ---- connections to the mock bank systems
export function connections(mockUrl, names) {
  const base = String(mockUrl).replace(/\/+$/, '');
  return Object.fromEntries(
    Object.entries(names).map(([id, path]) => [id, { type: 'http', base_url: `${base}${path}`, auth: { type: 'none' }, timeout_s: 8 }]),
  );
}

// ---- tools
// An HTTP tool on one connection. `sr`: the service request category it files under ([type, category, subcategory]), set in state when it succeeds.
export function httpTool(connection, id, description, request, { parameters, result, pre = [], channels: only, sr, onError, extraEffects = [] } = {}) {
  const effects = [...(sr ? [{ do: [{ type: 'set_state', values: { sr_type: sr[0], sr_category: sr[1], sr_subcategory: sr[2] } }] }] : []), ...extraEffects];
  return {
    id,
    type: 'http',
    description,
    ...(only ? { channels: only } : {}),
    connection,
    request,
    parameters: parameters || { type: 'object', properties: {} },
    ...(pre.length ? { preconditions: pre } : {}),
    ...(result ? { result } : {}),
    ...(effects.length ? { effects } : {}),
    timeout_s: 8,
    retries: 1,
    on_error: { tool_error: onError || 'The bank system did not answer. Say sorry, and offer a service manager.' },
  };
}

export const params = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
export const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
export const num = (description) => ({ type: 'number', description });

export const mustBeVerified = {
  require: { state: 'verified', equals: true },
  on_fail: { tool_error: 'The caller is not verified yet. Use the verification tool first.' },
};
export const mustHaveAccount = {
  require: { state: 'selected_account', not_equals: null },
  on_fail: { tool_error: 'No account is chosen yet. Use choose_account first (the caller says or keys the last four digits).' },
};

// ---- verification steps: on the phone the caller keys them in (the model never hears them); in the browser they are said or typed
export function collect(id, ask, { keypad, digits, storeIn, validate, passWhen, maxAttempts, onExhausted } = {}) {
  return {
    id,
    type: 'collect',
    ask,
    ...(keypad ? { input: 'dtmf', dtmf: { num_digits: digits, timeout_s: 15 } } : { input: 'speech' }),
    ...(storeIn ? { store_in: storeIn } : {}),
    ...(validate ? { validate } : {}),
    ...(passWhen ? { pass_when: passWhen } : {}),
    ...(maxAttempts ? { max_attempts: maxAttempts } : {}),
    ...(onExhausted ? { on_exhausted: onExhausted } : {}),
  };
}

export const onSuccess = { set_state: { verified: true }, resume: 'caller', silent: true };
export const onFailure = { outcome: 'failed', resume: 'caller', silent: false };
export const onDecline = { outcome: 'declined', resume: 'caller', silent: false };

// The state every business-banking agent keeps.
export function commonState() {
  return {
    caller_number: { type: 'string', nullable: true, source: { caller_id: true }, description: 'The number the call came from.' },
    language: { type: 'string', default: 'en', description: 'The caller’s favourite language (en, zh or ms), from the contact-centre tables.' },
    verified: { type: 'boolean', default: false },
    cif: { type: 'string', nullable: true, default: null, description: 'The customer’s CIF, once verified.' },
    phone_code: { type: 'string', nullable: true, default: null, sensitive: true },
    pin: { type: 'string', nullable: true, default: null, sensitive: true },
    tries: { type: 'number', default: 0, description: 'Failed inputs so far; three in total (section 15).' },
    intent: { type: 'string', nullable: true, default: null, description: 'The specialist in charge.' },
    sr_type: { type: 'string', nullable: true, default: null },
    sr_category: { type: 'string', nullable: true, default: null },
    sr_subcategory: { type: 'string', nullable: true, default: null },
    pending_request: { type: 'string', nullable: true, default: null, description: 'What the caller still needs when a specialist hands them back.' },
  };
}

export const backToFrontDesk = {
  id: 'back_to_front_desk',
  type: 'builtin',
  builtin: 'return_to_entry',
  description: 'This request is finished, or the caller needs something outside your role.',
  params: { pending_request_into: 'pending_request', guard_loops: true },
};
export const endCall = {
  id: 'end_call',
  type: 'builtin',
  builtin: 'end_call',
  description: 'Ends the call after the goodbye, when the caller has nothing more to ask.',
  params: { say: { message: 'goodbye' } },
};
