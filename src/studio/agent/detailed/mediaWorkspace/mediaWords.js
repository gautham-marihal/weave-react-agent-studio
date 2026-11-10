// Build › Images & Videos in plain words, for any agent: which ways in take photos and the camera, whether the AI sees
// them, every picture step wherever it runs (asked, checked in code, read by the AI, compared, forgotten), how picky the
// checks are, and what plainly needs a look. Pure: no React, no DOM, so the tests run it.
//
// From the schema 1.2 picture steps (request_image, analyze_image, compare_values, discard_image), channels[].modalities
// and inputs, defaults.models.llm.vision, agents.items[].vision and MEDIA_PROTOCOL: a picture stays in the call's memory
// and is never logged, saved or sent; only a reading step passes it to the AI; everything is forgotten when the call
// ends. The picture steps ran end to end on the real server (2026-11-05); seeing pictures during the conversation (an
// agent's `vision`) is kept but not run, as the server's own report says.

import { pictureSteps, pictureGroups, aiSeesPictures, forgetting } from '../../../pictures/mediaModel.js';
import { channelGap } from '../../../pictures/pictureSteps.js';
import { STRICTNESS_WORDS, strictnessOf } from '../../../pictures/strictness.js';
import { channelName } from '../../../simple/simpleModel.js';
import { DEFAULT_ACCEPT, DEFAULT_MAX_BYTES } from '../../../../demo/simulatedPictures.js';
import { lineOf } from '../../../form/speechLine.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (t, n = 48) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
export const together = (words, last = 'and') => (words.length > 1 ? `${words.slice(0, -1).join(', ')} ${last} ${words.at(-1)}` : words[0] || '');
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// a line's words, a fixed line's too
const speech = (v, config) => lineOf(config, v).text;
export const WEB = new Set(['web_chat', 'web_voice']);

// "2 minutes", "45 seconds"
export const timeWords = (s) => (typeof s !== 'number' || s <= 0 ? '' : s >= 60 && s % 60 === 0 ? plural(s / 60, 'minute') : plural(s, 'second'));
// "8 MB", "512 KB"
export const sizeWords = (bytes) => (bytes >= 1024 * 1024 ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB` : `${Math.round(bytes / 1024)} KB`);
const MIME_WORDS = { 'image/jpeg': 'JPEG', 'image/jpg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'image/heic': 'HEIC', 'image/gif': 'GIF' };
export const mimeWords = (types) =>
  together(
    [
      ...new Set(
        list(types).map(
          (t) =>
            MIME_WORDS[t] ||
            String(t)
              .replace(/^image\//, '')
              .toUpperCase(),
        ),
      ),
    ],
    'or',
  );

// What the server keeps but does not run: from its report when it has answered, else the guide's list (an agent's
// `vision` other than off). { vision: [agent indexes] }
export function notRunOf(config, unsupported) {
  if (Array.isArray(unsupported))
    return {
      vision: unsupported
        .map((u) => /^agents\.items\[(\d+)\]\.vision/.exec(String(u?.where || ''))?.[1])
        .filter((i) => i !== undefined)
        .map(Number),
    };
  return {
    vision: list(config?.agents?.items)
      .map((a, i) => (isObj(a) && isObj(a.vision) && a.vision.mode && a.vision.mode !== 'off' ? i : -1))
      .filter((i) => i >= 0),
  };
}

// ---- where pictures come in ---------------------------------------------------------------------------------------
// each way in: whether it is on the website, and what it takes
export function waysIn(config) {
  return list(config?.channels)
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => isObj(c))
    .map(({ c, index }) => {
      const input = list(c.modalities?.input);
      const image = isObj(c.inputs?.image) ? c.inputs.image : {};
      const video = isObj(c.inputs?.video) ? c.inputs.video : {};
      const web = WEB.has(c.type);
      return {
        index,
        key: str(c.id) || String(index),
        id: str(c.id),
        type: c.type,
        name: channelName(c.type),
        web,
        on: c.enabled !== false,
        photo: web && input.includes('image'),
        camera: web && input.includes('video'),
        screen: video.screen_share === true,
        onReceive: image.on_receive === 'reply' ? 'reply' : 'attach',
        maxBytes: typeof image.max_bytes === 'number' ? image.max_bytes : null,
        accept: list(image.accepted_mime).filter((t) => typeof t === 'string'),
      };
    });
}
// a way in's pictures in a line: "Photos and the camera · answers once the next message comes · up to 8 MB · JPEG…"
export function wayWords(w) {
  if (!w.web) return { main: 'Voice only', more: 'a phone call carries no pictures' };
  const takes = w.photo && w.camera ? 'Photos and the camera' : w.photo ? 'Photos' : w.camera ? 'The camera' : 'No pictures';
  if (!w.photo && !w.camera) return { main: takes, more: '' };
  const more = [];
  if (w.photo) {
    more.push(w.onReceive === 'reply' ? 'answers as soon as one arrives' : 'answers once the next message comes');
    more.push(`up to ${sizeWords(w.maxBytes || DEFAULT_MAX_BYTES)}`);
    more.push(mimeWords(w.accept.length ? w.accept : DEFAULT_ACCEPT));
  }
  if (w.screen) more.push('screen sharing too');
  return { main: takes, more: more.join(' · ') };
}

// ---- seeing during the conversation (each agent's own `vision`) --------------------------------------------------------
export const SEEING = {
  off: 'Off',
  turn_attach: 'Every turn: the latest picture goes with what the caller says',
  continuous: 'A live camera feed, for a realtime model',
};
export function seeingIn(config, unsupported) {
  const notRun = notRunOf(config, unsupported).vision;
  return list(config?.agents?.items)
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => isObj(a))
    .map(({ a, index }) => {
      const mode = isObj(a.vision) && a.vision.mode ? a.vision.mode : 'off';
      return {
        index,
        key: str(a.id) || String(index),
        name: str(a.name) || str(a.id) || `Agent ${index + 1}`,
        mode,
        words: SEEING[mode] || mode,
        kept: notRun.includes(index),
      };
    });
}

// ---- every picture step ---------------------------------------------------------------------------------------------
export const STEP_NAMES = {
  request_image: (s) => (s.kind === 'camera' ? 'Ask for the camera' : 'Ask for a photo'),
  analyze_image: () => 'Read a picture',
  compare_values: () => 'Compare in code',
  discard_image: () => 'Forget pictures',
};
export const STEP_ICONS = {
  request_image: (s) => (s.kind === 'camera' ? 'camera' : 'image'),
  analyze_image: () => 'read',
  compare_values: () => 'compare',
  discard_image: () => 'forget',
};
export const LIST_OF = { request_image: 'requests', analyze_image: 'reads', compare_values: 'compares', discard_image: 'forgets' };
export const stepKey = (path) => path.join('.');
const METHOD_WORDS = {
  text: 'a small slip is fine',
  id: 'letters and digits',
  exact: 'exactly',
  date: 'the same day',
  date_on_or_after: 'on or after',
  number: 'the same number',
};
export const methodWords = (m) => METHOD_WORDS[m || 'text'] || m;

// which variable each field of a reading goes into (a field not listed goes to one of its own name)
export const fieldVar = (step, field) => (isObj(step?.into) && str(step.into[field])) || field;

// Every picture step: { key, path, list, at, type, name, icon, item, group, words, more, gap, fix }
export function stepsIn(config) {
  const groups = pictureGroups(config);
  const asked = new Set(pictureSteps(config).flatMap((h) => (h.step.type === 'request_image' && h.step.into ? [h.step.into] : [])));
  return groups.flatMap((g) =>
    g.steps.map((hit) => {
      const s = hit.step;
      const base = {
        key: stepKey(hit.path),
        path: hit.path,
        list: LIST_OF[s.type],
        at: hit.index + 1,
        type: s.type,
        name: STEP_NAMES[s.type](s),
        icon: STEP_ICONS[s.type](s),
        item: s,
        group: g,
        when: isObj(s.when),
      };
      if (s.type === 'request_image') {
        const kind = s.kind === 'camera' ? 'camera' : 'upload';
        const picky = strictnessOf(kind, s.quality);
        const pickyWord = STRICTNESS_WORDS.find((w) => w.value === picky)?.label || (picky === 'custom' ? 'Its own numbers' : 'Not checked');
        const gap = channelGap(config, kind);
        const sharp = isObj(s.quality) ? s.quality.min_sharpness : undefined;
        return {
          ...base,
          kind,
          picky,
          pickyWord,
          words: kind === 'camera' ? 'Camera' : 'Upload',
          more: [
            speech(s.prompt, config) ? `“${clip(speech(s.prompt, config), 44)}”` : '',
            pickyWord,
            timeWords(typeof s.timeout_s === 'number' ? s.timeout_s : 120),
          ]
            .filter(Boolean)
            .join(' · '),
          gap: !str(s.into)
            ? 'Keeps the picture nowhere: choose where it goes'
            : gap
              ? gap.none
                ? 'No way in is on the website, so this step can never get a picture'
                : `No way in takes ${kind === 'camera' ? 'the camera' : 'photos'}, so this step can never get a picture`
              : kind === 'camera' && typeof sharp === 'number' && sharp < 15
                ? 'Too lenient for a camera: video lifts a blurred frame to about 10, so blur gets through'
                : '',
          fix: gap && !gap.none ? { kind: 'input', want: gap.want } : kind === 'camera' && typeof sharp === 'number' && sharp < 15 ? { kind: 'sharp' } : null,
        };
      }
      if (s.type === 'analyze_image') {
        const fields = isObj(s.fields) ? Object.keys(s.fields) : [];
        const required = list(s.required).filter((f) => fields.includes(f));
        const images = list(s.images).filter((v) => typeof v === 'string' && v);
        const orphan = images.find((v) => !asked.has(v));
        const model = isObj(s.model) ? str(s.model.model) : '';
        return {
          ...base,
          fields,
          images,
          words: fields.length ? plural(fields.length, 'detail') : 'No details',
          more: [
            model || 'as the agent',
            required.length === fields.length && fields.length ? 'all must be read' : required.length ? `${required.length} must be read` : 'none must be read',
          ].join(' · '),
          gap: !images.length
            ? 'Reads no picture: choose which'
            : orphan
              ? `Reads ${orphan}, which no step asks for`
              : !fields.length
                ? 'No details to read: name at least one'
                : !str(s.instructions)
                  ? 'Says nothing about what to look for'
                  : '',
          fix: null,
        };
      }
      if (s.type === 'compare_values') {
        const pairs = list(s.pairs).filter(isObj);
        const broken = pairs.find((p) => !str(p.left) || !str(p.right));
        return {
          ...base,
          pairs,
          words: pairs.length
            ? `${plural(pairs.length, 'pair')}, ${s.require === 'any' ? 'any one may match' : pairs.length === 1 ? 'it must match' : 'all must match'}`
            : 'No pairs',
          more: pairs.length ? pairs.map((p) => `${p.label || p.left || 'a pair'} (${methodWords(p.method)})`).join(', ') : '',
          gap: !pairs.length ? 'Compares nothing: add a pair' : broken ? 'A pair is missing one side' : '',
          fix: null,
        };
      }
      const images = list(s.images).filter((v) => typeof v === 'string' && v);
      return {
        ...base,
        images,
        words: images.length ? together(images) : 'Nothing chosen',
        more: '',
        gap: images.length ? '' : 'Forgets nothing: choose which pictures',
        fix: null,
      };
    }),
  );
}

// ---- the picture: one picture's journey, a lane per request, meeting where they are compared and forgotten -----------
export function journeyOf(config) {
  const steps = stepsIn(config);
  const { forgotten } = forgetting(config);
  // a lane per picture (the value a request keeps it in): a request asked again (a retry, or a photo when the camera
  // fails) joins the lane of its picture
  const lanes = [];
  steps
    .filter((s) => s.type === 'request_image')
    .forEach((req) => {
      const v = str(req.item.into);
      const lane = v ? lanes.find((l) => l.v === v) : null;
      if (lane) {
        lane.again.push(req);
        return;
      }
      const read = steps.find((s) => s.type === 'analyze_image' && v && s.images.includes(v)) || null;
      lanes.push({ req, read, v, again: [], forgotten: !!v && forgotten.includes(v) });
    });
  const compares = steps.filter((s) => s.type === 'compare_values');
  const forgets = steps.filter((s) => s.type === 'discard_image');
  return { lanes, compares, forgets, steps };
}

// ---- the whole part ---------------------------------------------------------------------------------------------------
export function mediaIn(config, unsupported) {
  const ways = waysIn(config);
  const ai = aiSeesPictures(config);
  const j = journeyOf(config);
  const { asked, forgotten } = forgetting(config);
  const kept = asked.filter((v) => !forgotten.includes(v));
  const takes = ways.filter((w) => w.photo || w.camera);
  const problems = j.steps.filter((s) => s.gap).length + (takes.length && !ai.sees ? 1 : 0) + (kept.length ? 1 : 0);
  return {
    ways,
    takes,
    ai,
    seeing: seeingIn(config, unsupported),
    ...j,
    asked,
    kept,
    problems,
    llm: str(config?.defaults?.models?.llm?.model),
  };
}

// the line under the name: what is set, in counts; or how many need a look
export function summaryLine(m) {
  const n = (type, one, many) => {
    const c = m.steps.filter((s) => s.type === type).length;
    return c ? plural(c, one, many) : '';
  };
  const parts = [
    m.takes.length ? `${plural(m.takes.length, 'way in takes', 'ways in take')} pictures` : '',
    n('request_image', 'request'),
    n('analyze_image', 'reading'),
    n('compare_values', 'comparison'),
    m.asked.length ? (m.kept.length ? '' : 'all forgotten') : '',
  ].filter(Boolean);
  const first = parts.length ? parts.join(' · ') : 'No pictures yet';
  const line = first.charAt(0).toUpperCase() + first.slice(1);
  return m.problems ? `${line} · ${m.problems} ${m.problems === 1 ? 'needs' : 'need'} a look` : line;
}
