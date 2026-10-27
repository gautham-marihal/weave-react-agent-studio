// Plain labels for each setting's choices, keyed by setting name then choice. Only the label changes, never the stored
// value; "Technical names" shows the value beside it. lookup() finds a choice that means the same without its name.
// Pure data and two helpers: no DOM.

export const ENUM_LABELS = {
  status: { draft: 'Draft', published: 'Published', archived: 'Archived' },
  environment: { development: 'Development', staging: 'Staging', production: 'Production' },
  engine: { 'livekit-agents': 'LiveKit Agents' },
  provider_mode: { plugins: 'Your own provider keys', inference: 'LiveKit Inference (LiveKit Cloud only)' },
  transport: { udp: 'UDP', tcp: 'TCP', tls: 'TLS (encrypted)', streamable_http: 'Streaming HTTP', sse: 'Server-sent events' },
  on: {
    call_started: 'A call starts',
    call_ended: 'A call ends',
    handoff: 'An agent passes the call on',
    tool_error: 'A tool fails',
    session_error: 'The session fails',
    escalation: 'The call is passed to a person',
    inactivity: 'The caller goes quiet',
    transfer_succeeded: 'A transfer works',
    transfer_failed: 'A transfer fails',
    state_changed: 'Something it remembers changes',
    guardrail_triggered: 'A safety rule catches what the caller said',
    limit_reached: 'A call limit is reached',
  },
  limit_reached: {
    max_call_duration_s: 'The call has run too long',
    max_silence_s: 'Too much silence',
    max_tool_calls_per_call: 'Too many tool uses in one call',
    max_handoffs_per_call: 'Too many hand-overs in one call',
  },
  attempts_scope: { step: 'On each step', task: 'Across the whole task' },
  return_history: { result_only: 'Only the result', full: 'Everything said during the task' },
  type: {
    // the type of a variable or a parameter
    boolean: 'Yes or no',
    enum: 'One of a list',
    string: 'Text',
    number: 'Number',
    integer: 'Whole number',
    object: 'A group of fields',
    array: 'A list',
    // the type of a field on a form
    text: 'Short text',
    phone: 'Phone number',
    textarea: 'Long text',
    select: 'Choose from a list',
    checkbox: 'Tick box',
    // the type of a channel
    sip_voice: 'Phone line (SIP)',
    web_voice: 'Web voice',
    web_chat: 'Web chat',
    whatsapp: 'WhatsApp',
    sms: 'SMS',
    email: 'Email',
    custom: 'Custom',
    // the type of a task step
    collect: 'Ask the caller',
    call: 'Call a tool',
    say: 'Say something',
  },
  entities: {
    card_number: 'Card numbers',
    bank_account: 'Bank account numbers',
    national_id: 'National ID numbers',
    phone_number: 'Phone numbers',
    email: 'Email addresses',
    date_of_birth: 'Dates of birth',
    otp: 'One-time codes',
    pin: 'PINs',
  },
  kind: {
    router: 'Router: passes callers on',
    specialist: 'Specialist: does one job',
    standalone: 'Standalone: handles calls on its own',
    sms: 'SMS',
    email: 'Email',
    transcript: 'Transcript',
    metrics: 'Metrics',
    uuid: 'Random unique id',
    epoch_hex: 'Time-based id',
    verification: 'Verification',
    collect_fields: 'Collect details',
    confirmation: 'Confirmation',
    custom: 'Custom',
  },
  method: { sip_refer: 'Transfer by SIP', http_request: 'Ask another system over HTTP' },
  log_level: { DEBUG: 'Debug: very detailed', INFO: 'Info', WARNING: 'Warnings and errors', ERROR: 'Errors only' },
  level: { debug: 'Debug: very detailed', info: 'Info', warning: 'Warnings and errors', error: 'Errors only' },
  detail: { events: 'What happened', full: 'Everything (for testing only)' },
  text_transforms: { filter_markdown: 'Remove markdown', filter_emoji: 'Remove emoji' },
  modalities: { text: 'Text', audio: 'Audio' },
  input: { audio: 'Audio', text: 'Text', image: 'Images', video: 'Video', speech: 'Speech', dtmf: 'Keypad tones' },
  output: { audio: 'Audio', text: 'Text' },
  sound: {
    keyboard_typing: 'Keyboard typing',
    keyboard_typing2: 'Keyboard typing 2',
    hold_music: 'Hold music',
    office_ambience: 'Office background',
    city_ambience: 'City background',
    forest_ambience: 'Forest background',
    crowded_room: 'Crowded room',
  },
  style: { spoken_12h: 'Times said aloud (4:30 PM becomes “4 30 P M”)', ordinal_month_name: 'Dates said aloud (27-Feb-2026 becomes “27th February 2026”)' },
  mode: {
    fixed: 'A fixed pause',
    dynamic: 'A pause that adapts to the caller',
    adaptive: 'Adaptive (LiveKit Cloud only)',
    vad: 'Voice detection',
    off: 'Off',
    turn_attach: 'Attach to each thing the caller says',
    continuous: 'Stream to a realtime model',
    tool: 'The model decides when to search',
    inject: 'Search on every caller turn',
  },
  clock: { auto: 'Automatic', silence: 'Both sides quiet', user_activity: 'Since the caller last spoke' },
  model: { auto: 'Automatic', standard: 'Standard', telephony: 'Tuned for phone calls' },
  days: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' },
  strategy: { first_success: 'Stop at the first that works', all: 'Send to all' },
  content_type: { text: 'Plain text', html: 'HTML' },
  format: { text: 'Text', json: 'JSON' },
  participant_kind: { standard: 'Standard', sip: 'Phone (SIP)', ingress: 'Streamed in', egress: 'Streamed out', agent: 'Agent', connector: 'Connector' },
  on_receive: { reply: 'Start a reply right away', attach: 'Wait and attach it to the next message' },
  outcome: { verified: 'Verified', failed: 'Failed', declined: 'Declined' },
  resume: { caller: 'The agent that started the task', entry: 'The first agent' },
  reply: { model: 'The model answers', none: 'Say nothing more' },
  builtin: {
    end_call: 'End the call',
    transfer_or_callback: 'Hand over to a person',
    return_to_entry: 'Go back to the first agent',
    send_dtmf: 'Send keypad tones',
    collect_dtmf: 'Collect keypad digits',
    send_form: 'Show a form',
    noop: 'Do nothing itself',
  },
  runtime: { python: 'Python', javascript: 'JavaScript' },
  query_from: { last_exchange: 'The last reply and the newest words', last_user: 'Only the caller’s newest words' },
  role: { system: 'As an instruction', assistant: 'As the bot’s own earlier note' },
  refresh: { manual: 'Only when I rebuild it', hourly: 'Every hour', daily: 'Every day', weekly: 'Every week' },
  action: {
    deflect: 'Politely decline',
    redact_in_logs: 'Hide it in the call log',
    rewrite: 'Rewrite it',
    block: 'Block it',
    end_call: 'End the call',
    tool: 'Run a tool',
    handoff: 'Pass to another agent',
  },
  enforcement: { code: 'Enforced by the runtime', both: 'Runtime and instructions', prompt: 'Only advised in the instructions' },
  sentiment: { frustrated: 'Frustrated', negative: 'Negative', abusive: 'Abusive' },
};

// Choices best left as written: standard names a technical person expects, or field names a template reads.
export const KEEP_AS_WRITTEN = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', '1.1', '1.2', 'text', 'json', 'id', 'room', 'started_at', 'type', 'modality']);

// A choice that has the same label wherever it is found, so a setting with an unlisted name still reads well.
const ALL = new Map();
Object.values(ENUM_LABELS).forEach((byValue) =>
  Object.entries(byValue).forEach(([value, label]) => {
    ALL.set(value, ALL.has(value) && ALL.get(value) !== label ? null : label);
  }),
);

// The label of one choice, or the choice itself when nothing is known.
export function enumLabel(name, value) {
  const text = String(value);
  return ENUM_LABELS[name]?.[text] ?? ALL.get(text) ?? text;
}

// { value: label } for one setting's choices, only where the label differs (what Select and CheckGroup take).
//   technical: show the value after the label, for people who work with the file
export function enumLabels(name, values, { technical = false, suffix = {} } = {}) {
  const out = {};
  values.forEach((value) => {
    const text = String(value);
    const label = enumLabel(name, text);
    const shown = technical && label !== text ? `${label} (${text})` : label;
    const extra = suffix[text] ? ` ${suffix[text]}` : '';
    if (shown !== text || extra) out[text] = `${shown}${extra}`;
  });
  return out;
}
