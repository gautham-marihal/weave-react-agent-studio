// The forms an agent has open in a conversation (FORM_PROTOCOL.md): several can be open at once and everything about
// one is matched by its `request_id`. The screen shows the oldest; when it is accepted or cancelled the next one shows.
// A form whose id is already open is ignored. Pure: no React.

const list = (v) => (Array.isArray(v) ? v : []);

// a "form" message, read into what the screen draws; null without a request id
export function readForm(packet) {
  const id = typeof packet?.request_id === 'string' && packet.request_id ? packet.request_id : '';
  if (!id) return null;
  return {
    requestId: id,
    title: packet.title || 'The agent needs some details',
    description: packet.description || '',
    fields: list(packet.fields),
    submitLabel: packet.submit_label || 'Send',
    errors: {},
    busy: false,
  };
}

export const addForm = (queue, form) => (!form || list(queue).some((f) => f.requestId === form.requestId) ? list(queue) : [...list(queue), form]);
export const updateForm = (queue, id, change) => list(queue).map((f) => (f.requestId === id ? { ...f, ...change } : f));
export const removeForm = (queue, id) => list(queue).filter((f) => f.requestId !== id);

// What is sent for a form's values: an optional field left blank is left out (the protocol: "leave an optional field
// out or empty"), a number as a number, everything else as typed.
export function formValues(fields, values) {
  const out = {};
  list(fields).forEach((field) => {
    const value = values?.[field.name];
    const blank = value === undefined || value === null || value === '';
    if (blank && !field.required) return;
    out[field.name] = field.type === 'number' && !blank ? Number(value) : value;
  });
  return out;
}

// The server's errors that belong to no field of the form (form_errors is keyed by field name, but nothing promises
// only those): said under the form, so a refusal is never silent. `_form` is the screen's own (sending failed).
export function otherErrors(form) {
  const names = new Set(list(form?.fields).map((f) => f?.name));
  return Object.entries(form?.errors || {})
    .filter(([key, message]) => !names.has(key) && message && typeof message === 'string')
    .map(([, message]) => message);
}

// How long the person has to fill a form before the agent ends the conversation for silence: the agent's inactivity
// rule (the wait before each nudge × the nudges plus the last wait), a channel's own rule winning. Seconds, or null
// when nothing would end it. config: the agent's config; channelId: the channel the conversation runs on.
export function formTimeLimit(config, channelId) {
  const channel = (Array.isArray(config?.channels) ? config.channels : []).find((c) => c?.id === channelId);
  const rule = channel?.overrides?.conversation?.inactivity || config?.defaults?.conversation?.inactivity;
  const wait = Number(rule?.timeout_s);
  if (!rule || rule.enabled === false || !Number.isFinite(wait) || wait <= 0) return null;
  const nudges = Number.isInteger(rule.max_nudges) && rule.max_nudges > 0 ? rule.max_nudges : 0;
  return Math.round(wait * (nudges + 1));
}
