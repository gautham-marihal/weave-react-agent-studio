// Plain words for the kind of a thing ("Looks something up", not "http"), for card hints and chips. Ids are the
// author's and shown as written. A kind with no phrase shows as it is, and a test checks every schema kind is covered.
// Pure: no React, no DOM.

export const PLAIN_KIND = {
  // tools
  http: 'Looks something up',
  builtin: 'Built-in action',
  knowledge: 'Searches your knowledge',
  mcp: 'Uses another system’s tools',
  task: 'Multi-step task',
  code: 'Runs your own code',
  // channels
  sip_voice: 'Phone line',
  web_voice: 'Web voice',
  web_chat: 'Web chat',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  custom: 'Custom',
  // safety rules
  prompt_injection: 'Refuses tricks to change its instructions',
  pii_detect: 'Hides personal details',
  field_firewall: 'Keeps secret fields out',
  regex_block: 'Blocks words or patterns',
  statement: 'A rule in words',
  // connections
  sms_service: 'Text messages',
  // agents
  router: 'Passes callers on',
  specialist: 'Does one job',
  standalone: 'Answers on its own',
  // tasks
  verification: 'Checks who the caller is',
  collect_fields: 'Collects details',
  confirmation: 'Asks the caller to confirm',
};

export const BUILTIN_WORDS = {
  end_call: 'Ends the call',
  transfer_or_callback: 'Hands over to a person',
  return_to_entry: 'Back to the first agent',
  send_form: 'Shows a form',
  collect_dtmf: 'Collects keypad digits',
  send_dtmf: 'Presses keypad tones',
  noop: 'Only runs its rules',
};

export const plainKind = (kind) => PLAIN_KIND[kind] || String(kind || '');

// A web-request tool either reads (GET) or changes something (POST, PUT, PATCH, DELETE), and "Looks something up" is
// wrong for the second, so the method decides. No method means a read, as before.
const CHANGES_THINGS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HTTP_WRITES = 'Sends something to your systems';
export const changesSomething = (tool) => CHANGES_THINGS.has(String(tool?.request?.method || '').toUpperCase());

// What a tool is, in words: a built-in by what it does, any other by its kind.
export function plainToolKind(tool) {
  if (!tool || typeof tool !== 'object') return '';
  if ((tool.type === 'builtin' || (!tool.type && tool.builtin)) && tool.builtin) return BUILTIN_WORDS[tool.builtin] || PLAIN_KIND.builtin;
  if (tool.type === 'http' && changesSomething(tool)) return HTTP_WRITES;
  return plainKind(tool.type);
}
