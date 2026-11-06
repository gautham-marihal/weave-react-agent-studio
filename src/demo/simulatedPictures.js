// Pictures in the SIMULATED agent (demo mode and the "Simulated" preview): the steps of a configuration that ask for a
// picture, run in the browser so the request card, the refusals and the call-record lines can all be tried without a
// server. What can't be done here is said, never faked: nothing reads the text on a picture (that needs the vision
// model), so "Read a picture" leaves its values empty. Quality is measured as the runtime does it (pictures/measure.js).
// Pure: no network, no DOM.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const DEFAULT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_TIMEOUT_S = 120;

// words that make the simulation run a picture flow that isn't run at the start of a call
const PICTURE_WORDS = new Set([
  'photo',
  'photos',
  'picture',
  'pictures',
  'pic',
  'selfie',
  'camera',
  'upload',
  'scan',
  'passport',
  'license',
  'licence',
  'receipt',
  'damage',
  'damaged',
  'verify',
  'verification',
  'kyc',
  'nric',
]);
const PICTURE_PHRASES = /\b(id card|identity card|open (an |a )?(new )?account)\b/i;
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with', 'when', 'their', 'your', 'this', 'that', 'it', 'is', 'on', 'in', 'from']);
const wordsOf = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

const hasRequest = (actions) => list(actions).some((a) => isObj(a) && a.type === 'request_image');

// Every list of steps in the configuration that asks for a picture, with what starts it in the simulation:
//   { path, actions, start: true (as the call starts) | false, words: [...] (what the caller says that starts it), label }
export function findPictureFlows(config) {
  const found = [];
  const entry = config?.agents?.entry || list(config?.agents?.items)[0]?.id;
  const walk = (node, path, owner) => {
    if (Array.isArray(node)) {
      if (hasRequest(node)) {
        const [top, , index] = path;
        const agent = top === 'agents' ? list(config?.agents?.items)[index] : null;
        const event = top === 'events' ? list(config?.events)[path[1]] : null;
        const start = (agent && agent.id === entry && path.includes('on_enter')) || (event && event.on === 'call_started');
        found.push({
          path,
          actions: node,
          start: !!start,
          words: [...new Set([...wordsOf(owner?.id), ...wordsOf(owner?.name), ...wordsOf(owner?.description)])],
          label: owner?.name || owner?.id || path.join('.'),
        });
      }
      node.forEach((item, i) => walk(item, [...path, i], owner));
      return;
    }
    if (!isObj(node)) return;
    // the nearest thing with a name: the tool, task or agent the steps belong to
    const named = typeof node.id === 'string' && (node.description || node.name) ? node : owner;
    Object.entries(node).forEach(([key, value]) => {
      if (key === 'tests') return; // a scenario's own pictures are not the agent's steps
      walk(value, [...path, key], named);
    });
  };
  walk(isObj(config) ? config : {}, [], null);
  return found;
}

// Does this picture flow start with what the caller just said?
export function flowStartsOn(flow, said) {
  const text = String(said || '');
  if (PICTURE_PHRASES.test(text) || wordsOf(text).some((w) => PICTURE_WORDS.has(w))) return true;
  const own = new Set(flow?.words || []);
  return wordsOf(text).filter((w) => own.has(w)).length >= 2;
}

// A condition (the schema's `condition`) against the simulated state: true, false, or null when it can't be known here
// (a tool's result or argument, an event, a schedule).
export function conditionHolds(when, state, channelId) {
  if (when === undefined || when === null) return true;
  if (!isObj(when)) return null;
  if (Array.isArray(when.all)) {
    const parts = when.all.map((w) => conditionHolds(w, state, channelId));
    return parts.includes(false) ? false : parts.includes(null) ? null : true;
  }
  if (Array.isArray(when.any)) {
    const parts = when.any.map((w) => conditionHolds(w, state, channelId));
    return parts.includes(true) ? true : parts.includes(null) ? null : false;
  }
  if ('not' in when) {
    const inner = conditionHolds(when.not, state, channelId);
    return inner === null ? null : !inner;
  }
  if ('channel' in when) return list([].concat(when.channel)).includes(channelId);
  if (typeof when.state !== 'string') return null;
  const value = isObj(state) ? state[when.state] : undefined;
  if ('equals' in when) return value === when.equals;
  if ('not_equals' in when) return value !== when.not_equals;
  if ('in' in when) return list(when.in).includes(value);
  if ('gte' in when) return typeof value === 'number' && value >= when.gte;
  if ('lte' in when) return typeof value === 'number' && value <= when.lte;
  return null;
}

// What a picture request asks of the screen, from the step and the channel (`inputs.image`): the request_image message.
export function requestMessage(action, channel, id) {
  const image = isObj(channel?.inputs?.image) ? channel.inputs.image : {};
  const prompt = typeof action?.prompt === 'string' ? action.prompt : isObj(action?.prompt) ? action.prompt.text || '' : '';
  return {
    type: 'request_image',
    request_id: id,
    kind: action?.kind === 'camera' ? 'camera' : 'upload',
    prompt: prompt || null,
    accept: list(image.accepted_mime).length ? image.accepted_mime : DEFAULT_ACCEPT,
    max_bytes: image.max_bytes || DEFAULT_MAX_BYTES,
    timeout_s: typeof action?.timeout_s === 'number' ? action.timeout_s : DEFAULT_TIMEOUT_S,
  };
}

// The step's quality standard against a picture's measurements: '' when it passes, else the refusal code.
export function qualityVerdict(quality, measured) {
  const q = isObj(quality) ? quality : {};
  const m = isObj(measured) ? measured : {};
  if (typeof q.min_dimension === 'number' && Math.min(m.width || 0, m.height || 0) < q.min_dimension) return 'too_small';
  if (typeof q.min_sharpness === 'number' && (m.sharpness ?? 0) < q.min_sharpness) return 'too_blurry';
  if (typeof q.min_brightness === 'number' && (m.brightness ?? 0) < q.min_brightness) return 'too_dark';
  if (typeof q.max_brightness === 'number' && (m.brightness ?? 0) > q.max_brightness) return 'too_bright';
  return '';
}

// ---- comparing values the way "Compare values" does: in code, never by a model
const fold = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const nameWords = (text) =>
  fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
// similarity of two strings, 0 to 1 (1 minus the edit distance over the longer length)
export function similarity(a, b) {
  const x = String(a);
  const y = String(b);
  if (!x.length && !y.length) return 1;
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return 1 - row[y.length] / Math.max(x.length, y.length);
}
// a date in any common writing, as YYYY-MM-DD, or ''
export function readDate(value, order = 'dmy') {
  const text = String(value ?? '').trim();
  if (!text) return '';
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const [d, mo] = order === 'mdy' ? [m[2], m[1]] : [m[1], m[2]];
    return `${m[3]}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}
const empty = (v) => v === undefined || v === null || String(v).trim() === '';

// One pair: { label, matched, score, skipped }.
export function comparePair(pair, state) {
  const left = state?.[pair?.left];
  const right = state?.[pair?.right];
  const label = pair?.label || pair?.left || 'a pair';
  if (empty(left) || empty(right)) return pair?.optional ? { label, matched: true, score: 1, skipped: true } : { label, matched: false, score: 0 };
  const method = pair?.method || 'text';
  let score = 0;
  if (method === 'text') score = similarity(nameWords(left), nameWords(right));
  else if (method === 'id') score = fold(left).replace(/[^a-z0-9]/g, '') === fold(right).replace(/[^a-z0-9]/g, '') ? 1 : 0;
  else if (method === 'exact') score = fold(left).trim() === fold(right).trim() ? 1 : 0;
  else if (method === 'number') score = Number(left) === Number(right) ? 1 : 0;
  else if (method === 'date' || method === 'date_on_or_after') {
    const a = readDate(left, pair.date_order);
    const b = readDate(right, pair.date_order);
    score = a && b && (method === 'date' ? a === b : a >= b) ? 1 : 0;
  }
  const threshold = method === 'text' ? (typeof pair?.threshold === 'number' ? pair.threshold : 0.85) : 1;
  return { label, matched: score >= threshold, score: Math.round(score * 100) / 100 };
}

// A whole "Compare values" step: { matched, score, pairs, differences }.
export function compareValues(action, state) {
  const pairs = list(action?.pairs)
    .filter(isObj)
    .map((p) => comparePair(p, state));
  const counted = pairs.filter((p) => !p.skipped);
  const matched = action?.require === 'any' ? counted.some((p) => p.matched) : counted.length > 0 && counted.every((p) => p.matched);
  const score = counted.length ? Math.min(...counted.map((p) => p.score)) : 0;
  return { matched, score, pairs, differences: pairs.filter((p) => !p.matched).map((p) => p.label) };
}
