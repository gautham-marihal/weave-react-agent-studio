// Ready sets of picture steps, for any agent (canvas page "11 · Images & Videos", board M6 and decision 4): a starting
// point adds ask → read → forget (the check in code is the request's own standard) at the end of a list of steps, each
// with the remembered values it needs; and "Double-check with a second reading" (decision 3) adds, after a reading, a
// second one of the same picture and a comparison of the two in code. Only steps the schema already has. Pure.

import { STRICTNESS } from '../../../pictures/strictness.js';
import { channelGap, withInput } from '../../../pictures/pictureSteps.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- small path helpers (copies; the draft is never changed in place)
const getAt = (obj, path) => path.reduce((node, key) => (node == null ? undefined : node[key]), obj);
function setAt(obj, path, value) {
  if (!path.length) return value;
  const [key, ...rest] = path;
  const base = Array.isArray(obj) ? [...obj] : isObj(obj) ? { ...obj } : typeof key === 'number' ? [] : {};
  base[key] = setAt(base[key], rest, value);
  return base;
}
// a remembered value's name not taken yet: photo, photo_2…
export function freshVar(config, base, also = []) {
  const taken = new Set([...Object.keys(isObj(config?.state?.variables) ? config.state.variables : {}), ...also]);
  let name = base;
  let n = 2;
  while (taken.has(name)) {
    name = `${base}_${n}`;
    n += 1;
  }
  return name;
}
const VAR_TYPE = { string: 'string', number: 'number', boolean: 'boolean', date: 'string' };
const declare = (config, name, type = 'string') => setAt(config, ['state', 'variables', name], { type, nullable: true, default: null });

// the starting points, by what the picture is of
export const RECIPES = [
  {
    id: 'document',
    name: 'A photo of a document',
    help: 'An ID card, a licence or a letter: read its name, number and expiry',
    kind: 'upload',
    picture: 'document_photo',
    prompt: 'A clear photo of the front of your document, all four edges in view',
    picky: 'standard',
    instructions:
      'The picture should show the front of a document, photographed by the customer. Copy each value exactly as printed. If a value is blurred, cut off or covered by glare, leave it empty.',
    fields: { full_name: ['string', 'The name as printed'], document_number: ['string', 'The document’s number'], expiry_date: ['date', 'When it expires'] },
    required: ['full_name', 'document_number'],
  },
  {
    id: 'damage',
    name: 'A photo of damage or a product',
    help: 'A parcel, a device or a part: note what is shown and what is wrong',
    kind: 'upload',
    picture: 'damage_photo',
    prompt: 'A photo of the damage, close up and in good light',
    picky: 'relaxed',
    instructions: 'Describe what the photo shows. Name the item and what is wrong with it. If you can’t tell, leave the value empty.',
    fields: {
      item: ['string', 'What the item is'],
      damage: ['string', 'What is wrong with it, in a few words'],
      packaging_damaged: ['boolean', 'Whether the packaging is damaged'],
    },
    required: ['item'],
  },
  {
    id: 'receipt',
    name: 'A receipt',
    help: 'Read its total, date and reference, to check with your own system',
    kind: 'upload',
    picture: 'receipt_photo',
    prompt: 'A photo of the whole receipt, flat and in good light',
    picky: 'standard',
    instructions: 'The picture should show a receipt. Copy the values exactly as printed. If a value is blurred or cut off, leave it empty.',
    fields: { total: ['number', 'The total paid'], paid_on: ['date', 'The date on the receipt'], reference: ['string', 'The receipt or order number'] },
    required: ['total', 'reference'],
  },
  {
    id: 'camera',
    name: 'A camera check',
    help: 'Ask them to hold something up to the camera, and read what it shows',
    kind: 'camera',
    picture: 'camera_frame',
    prompt: 'Hold it up to the camera, in good light',
    picky: 'standard',
    instructions: 'Say what the camera shows, in a few words. If you can’t tell, leave the value empty.',
    fields: { shows: ['string', 'What the camera shows'] },
    required: ['shows'],
  },
];

// The ways in on the website take what a request asks for (and the AI is marked as reading pictures), when none does
// yet: a step that can never get a picture is no start.
export function letWaysTake(config, kind) {
  const gap = channelGap(config, kind === 'camera' ? 'camera' : 'upload');
  return gap && !gap.none ? withInput(config, gap.want) : config;
}

// The steps of a starting point added at the end of a list (`listPath`, made when missing).
// -> { config, path: the path of its first step }
export function addRecipe(config, listPath, id) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) return { config, path: null };
  let next = config;
  const picture = freshVar(next, r.picture);
  next = declare(next, picture);
  const into = {};
  Object.entries(r.fields).forEach(([field, [type]]) => {
    const name = freshVar(next, field);
    next = declare(next, name, VAR_TYPE[type]);
    if (name !== field) into[field] = name;
  });
  const ok = freshVar(next, `${r.picture.replace(/_(photo|frame)$/, '')}_read`);
  next = declare(next, ok, 'boolean');
  const steps = [
    {
      type: 'request_image',
      kind: r.kind,
      into: picture,
      prompt: r.prompt,
      timeout_s: r.kind === 'camera' ? 90 : 180,
      quality: { ...STRICTNESS[r.kind === 'camera' ? 'camera' : 'upload'][r.picky] },
    },
    {
      type: 'analyze_image',
      images: [picture],
      instructions: r.instructions,
      fields: Object.fromEntries(Object.entries(r.fields).map(([field, [type, description]]) => [field, { type, description }])),
      ...(Object.keys(into).length ? { into } : {}),
      required: r.required,
      ok_into: ok,
    },
    { type: 'discard_image', images: [picture] },
  ];
  const before = list(getAt(next, listPath));
  next = setAt(next, listPath, [...before, ...steps]);
  return { config: letWaysTake(next, r.kind), path: [...listPath, before.length] };
}

// how two readings of one field are compared: words loosely (a model may write a name a little differently), the rest
// exactly
const METHOD_FOR = { string: 'text', number: 'number', date: 'date', boolean: 'exact' };

// After the reading at `path`: a second reading of the same pictures (the same model until another is chosen on its page)
// into values of its own, then a comparison of the two readings, field by field, all of which must match.
// -> { config, path: the path of the second reading }
export function addSecondReading(config, path) {
  const first = getAt(config, path);
  if (!isObj(first) || first.type !== 'analyze_image') return { config, path: null };
  const listPath = path.slice(0, -1);
  const at = path.at(-1);
  let next = config;
  const fields = isObj(first.fields) ? first.fields : {};
  const into = {};
  const pairs = [];
  Object.entries(fields).forEach(([field, spec]) => {
    const own = (isObj(first.into) && first.into[field]) || field;
    const second = freshVar(next, `${own}_check`);
    next = declare(next, second, VAR_TYPE[spec?.type] || 'string');
    into[field] = second;
    // words that are a number or a code (an id, a reference) compare by their letters and digits, not loosely
    const code = spec?.type === 'string' && /(^|_)(number|no|id|code|ref|reference|last4)($|_)/.test(field);
    pairs.push({
      left: own,
      right: second,
      method: code ? 'id' : METHOD_FOR[spec?.type] || 'text',
      label: field,
      optional: !list(first.required).includes(field),
    });
  });
  const agree = freshVar(next, 'readings_agree');
  next = declare(next, agree, 'boolean');
  const differ = freshVar(next, 'readings_differ');
  next = declare(next, differ, 'string');
  const reading = { ...clone(first), into };
  delete reading.ok_into;
  const compare = { type: 'compare_values', pairs, require: 'all', into: { matched: agree, differences: differ } };
  const steps = list(getAt(next, listPath));
  next = setAt(next, listPath, [...steps.slice(0, at + 1), reading, compare, ...steps.slice(at + 1)]);
  return { config: next, path: [...listPath, at + 1] };
}

// ---- one-click fixes the workspace offers

// Every language model in play marked as reading pictures (the default, each agent's own and each channel's own): the
// server refuses a way in that takes pictures unless the model it ends up with can read them (agent config guide 3.9).
const seeing = (llm) => (isObj(llm) && llm.vision !== true ? { ...llm, vision: true } : llm);
const ownSeeing = (owner) => {
  const llm = owner?.overrides?.models?.llm;
  if (!isObj(llm) || llm.vision === true) return owner;
  return { ...owner, overrides: { ...owner.overrides, models: { ...owner.overrides.models, llm: seeing(llm) } } };
};
export function markSeeing(config) {
  const next = { ...config };
  const llm = config?.defaults?.models?.llm;
  if (isObj(llm)) next.defaults = { ...config.defaults, models: { ...config.defaults.models, llm: seeing(llm) } };
  if (Array.isArray(config?.agents?.items)) next.agents = { ...config.agents, items: config.agents.items.map((a) => (isObj(a) ? ownSeeing(a) : a)) };
  if (Array.isArray(config?.channels)) next.channels = config.channels.map((c) => (isObj(c) ? ownSeeing(c) : c));
  return next;
}

// A "Forget pictures" step for the pictures no step forgets, after the last step that asks for one of them.
// -> { config, path }
export function forgetKept(config, kept, requests) {
  const last = [...requests].reverse().find((r) => kept.includes(r.item?.into));
  if (!last || !kept.length) return { config, path: null };
  const listPath = last.path.slice(0, -1);
  const steps = list(getAt(config, listPath));
  return { config: setAt(config, listPath, [...steps, { type: 'discard_image', images: [...kept] }]), path: [...listPath, steps.length] };
}
