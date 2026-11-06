// The picture protocol between a test conversation and the agent's runtime (MEDIA_PROTOCOL.md; FRONTEND_GUIDE 7.1). The
// runtime decides when a picture is wanted and says so on the text topic `agent-builder.ui`; the screen only reacts:
//   request_image  {request_id, kind: upload|camera, prompt, accept, max_bytes, timeout_s}  show the upload or the camera
//   image_rejected {request_id, code, message}                                               say why; the request stays open
//   request_done   {request_id, kind, status: received|timeout|cancelled}                    clean up (sent every time)
// An upload goes back as the file itself on a byte stream (`agent-builder.image`, or the channel's inputs.image.topic); the
// camera is the visitor's normal camera track. A message of a type not known here is ignored (more may be added).
// Pure: no network, no DOM.

export const UI_TOPIC = 'agent-builder.ui';
export const IMAGE_TOPIC = 'agent-builder.image';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

// One message from the runtime, read; null for anything that is not JSON or not a type this screen knows.
export function readUiMessage(raw) {
  let packet = raw;
  if (typeof raw === 'string') {
    try {
      packet = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(packet)) return null;
  const id = typeof packet.request_id === 'string' && packet.request_id ? packet.request_id : null;
  switch (packet.type) {
    case 'request_image':
      if (!id) return null;
      return {
        type: 'request_image',
        id,
        kind: packet.kind === 'camera' ? 'camera' : 'upload',
        prompt: typeof packet.prompt === 'string' ? packet.prompt : '',
        accept: list(packet.accept).filter((t) => typeof t === 'string' && t),
        maxBytes: num(packet.max_bytes),
        timeoutS: num(packet.timeout_s),
      };
    case 'image_rejected':
      return {
        type: 'image_rejected',
        id,
        code: typeof packet.code === 'string' ? packet.code : 'unreadable',
        message: typeof packet.message === 'string' && packet.message.trim() ? packet.message.trim() : REJECTED_WORDS[packet.code] || REJECTED_WORDS.unreadable,
      };
    case 'request_done':
      if (!id) return null;
      return {
        type: 'request_done',
        id,
        kind: packet.kind === 'camera' ? 'camera' : 'upload',
        status: ['received', 'timeout', 'cancelled'].includes(packet.status) ? packet.status : 'cancelled',
      };
    default:
      return null;
  }
}

// What each refusal code means, said to the visitor when the runtime sends no message of its own (it normally does, and
// that sentence is always the one shown). Also the short words the call record uses.
export const REJECTED_WORDS = {
  empty: 'That file is empty. Please choose another photo.',
  too_large: 'That photo is too big. Please choose a smaller one.',
  not_an_image: 'That file is not a picture. Please choose a photo.',
  unsupported_type: 'That kind of picture is not accepted. Please choose a JPG or PNG photo.',
  too_small: 'That photo is too small to read. Please take it closer.',
  too_blurry: 'That photo is blurry. Please hold it still, in good light, and take it again.',
  too_dark: 'That photo is too dark. Please take it in better light.',
  too_bright: 'That photo is washed out. Please avoid glare and take it again.',
  too_many: 'Too many photos were sent in this conversation.',
  not_accepted: 'This conversation does not take photos.',
  unreadable: 'That photo could not be used. Please try again.',
};
export const REJECTED_SHORT = {
  empty: 'empty file',
  too_large: 'too big',
  not_an_image: 'not a picture',
  unsupported_type: 'kind not accepted',
  too_small: 'too small',
  too_blurry: 'too blurry',
  too_dark: 'too dark',
  too_bright: 'too bright',
  too_many: 'too many pictures',
  not_accepted: 'pictures not taken here',
  unreadable: 'could not be read',
};
export const rejectedShort = (code) => REJECTED_SHORT[code] || String(code || 'refused').replace(/_/g, ' ');

// A new open request, from a request_image message.
export const openRequest = (message, now = Date.now()) => ({
  id: message.id,
  kind: message.kind,
  prompt: message.prompt,
  accept: message.accept,
  maxBytes: message.maxBytes,
  timeoutS: message.timeoutS,
  startedAt: now,
  rejection: null, // { code, message } of the last refusal: the request stays open
  sent: null, // { name, size, thumb } of the photo sent for it
  phase: 'open', // open | sending | sent (waiting for the agent's answer)
});

// The next state after a message: { request, done, note }.
//   request  the open request (null when none)
//   done     how a request ended, for the line it leaves in the conversation: { id, kind, status, sent }
//   note     a refusal of a photo nothing asked for (request_id null), to show as a line
// One request is open at a time: a new one replaces any other (the runtime moved on).
export function applyUiMessage(request, message, now = Date.now()) {
  if (!message) return { request, done: null, note: null };
  if (message.type === 'request_image') return { request: openRequest(message, now), done: null, note: null };
  if (message.type === 'image_rejected') {
    if (request && (message.id === request.id || message.id === null))
      return { request: { ...request, rejection: { code: message.code, message: message.message }, phase: 'open' }, done: null, note: null };
    return { request, done: null, note: message.id === null ? message.message : null };
  }
  if (message.type === 'request_done') {
    if (!request || request.id !== message.id) return { request, done: null, note: null };
    return { request: null, done: { id: request.id, kind: request.kind, status: message.status, sent: request.sent }, note: null };
  }
  return { request, done: null, note: null };
}

// "8 MB", "1.2 MB", "418 KB"
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) {
    const mb = n / 1048576;
    const tenths = Math.round(mb * 10) / 10;
    return `${mb >= 100 || Number.isInteger(tenths) ? Math.round(mb) : tenths.toFixed(1)} MB`;
  }
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

const TYPE_WORDS = {
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/heic': 'HEIC',
  'image/bmp': 'BMP',
};
// ['JPG', 'PNG', 'WebP'] for the accepted kinds, as a person names them
export const acceptWords = (accept) => [
  ...new Set(list(accept).map((t) => TYPE_WORDS[t] || (t === 'image/*' ? 'any picture' : t.replace(/^image\//, '').toUpperCase()))),
];

const accepts = (accept, type) => {
  if (!list(accept).length || !type) return true; // nothing said, or the browser doesn't know: the runtime checks the bytes
  return list(accept).some((a) => a === type || (a.endsWith('/*') && type.startsWith(a.slice(0, -1))) || (a === 'image/jpeg' && type === 'image/jpg'));
};

// Why this file can't be sent for this request, in the visitor's words, or '' when it can. Checked before sending, so
// they are told at once (the runtime checks again).
export function uploadProblem(file, { accept = [], maxBytes = 0 } = {}) {
  if (!file) return '';
  if (!file.size) return 'That file is empty. Choose another photo.';
  if (maxBytes && file.size > maxBytes)
    return `Not sent: that photo is ${formatBytes(file.size)}, and this agent takes up to ${formatBytes(maxBytes)}. Choose a smaller one.`;
  if (!accepts(accept, file.type))
    return `Not sent: this agent takes ${acceptWords(accept).join(', ')} photos, and that file is ${file.type || 'another kind'}.`;
  return '';
}

// The same file chosen twice (the protocol: never send the same file twice). Not by its date: a file read again can get a
// new one.
export const fileKey = (file) => (file ? `${file.name}|${file.size}|${file.type}` : '');

// Whole seconds the agent will still wait, 0 at the end; null when it gave no time.
export function secondsLeft(request, now = Date.now()) {
  if (!request?.timeoutS) return null;
  return Math.max(0, Math.ceil(request.timeoutS - (now - request.startedAt) / 1000));
}
// "2:46"
export const clockText = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
