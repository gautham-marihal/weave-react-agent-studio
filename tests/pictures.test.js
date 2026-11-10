import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_TOPIC,
  UI_TOPIC,
  acceptWords,
  applyUiMessage,
  clockText,
  fileKey,
  formatBytes,
  readUiMessage,
  secondsLeft,
  uploadProblem,
} from '../src/studio/pictures/pictureProtocol.js';
import {
  compareValues,
  comparePair,
  conditionHolds,
  findPictureFlows,
  flowStartsOn,
  qualityVerdict,
  readDate,
  requestMessage,
} from '../src/demo/simulatedPictures.js';
import { measureGrey } from '../src/studio/pictures/measure.js';
import { describeRecords, groupCounts, filterRows } from '../src/studio/trace/records.js';
import { chatOf } from '../src/studio/calls/callChat.js';
import { describeAction } from '../src/studio/form/effects.js';
import { channelGap, fromScale, sharpnessAdvice, toScale, withInput } from '../src/studio/pictures/pictureSteps.js';

// ---- the protocol (MEDIA_PROTOCOL.md): what the runtime sends on agent-builder.ui, and the open request it makes

test('the topics are the protocol’s own', () => {
  assert.equal(UI_TOPIC, 'agent-builder.ui');
  assert.equal(IMAGE_TOPIC, 'agent-builder.image', 'uploads go on agent-builder.image (they went to image-upload before)');
});

test('the three messages are read, and anything else is ignored', () => {
  const ask = readUiMessage(
    JSON.stringify({
      type: 'request_image',
      request_id: 'r_1',
      kind: 'upload',
      prompt: 'Upload a photo of the front of your ID card',
      accept: ['image/jpeg', 'image/png', 'image/webp'],
      max_bytes: 8388608,
      timeout_s: 180,
    }),
  );
  assert.deepEqual(ask, {
    type: 'request_image',
    id: 'r_1',
    kind: 'upload',
    prompt: 'Upload a photo of the front of your ID card',
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 8388608,
    timeoutS: 180,
  });
  assert.equal(readUiMessage('{"type":"request_image","request_id":"r","kind":"camera","prompt":null}').prompt, '', 'a null prompt is none');
  assert.equal(readUiMessage('not json'), null);
  assert.equal(readUiMessage('{"type":"something_new","request_id":"r"}'), null, 'a type not known here is ignored (more may be added)');
  assert.equal(readUiMessage('{"type":"request_image"}'), null, 'a request without an id can’t be answered');
  const refused = readUiMessage('{"type":"image_rejected","request_id":null,"code":"too_blurry","message":"That photo is blurry."}');
  assert.deepEqual(refused, { type: 'image_rejected', id: null, code: 'too_blurry', message: 'That photo is blurry.' });
  assert.match(readUiMessage('{"type":"image_rejected","request_id":"r","code":"too_dark"}').message, /too dark/, 'its own words when the runtime sends none');
  assert.equal(readUiMessage('{"type":"request_done","request_id":"r","kind":"camera","status":"weird"}').status, 'cancelled');
});

test('one request is open at a time: refused keeps it open, done closes it and leaves a line', () => {
  const ask = readUiMessage({ type: 'request_image', request_id: 'r_1', kind: 'upload', accept: [], max_bytes: 0, timeout_s: 60 });
  let step = applyUiMessage(null, ask, 1000);
  assert.equal(step.request.id, 'r_1');
  assert.equal(step.request.startedAt, 1000);
  step = applyUiMessage(step.request, readUiMessage({ type: 'image_rejected', request_id: 'r_1', code: 'too_blurry', message: 'Blurry.' }));
  assert.equal(step.request.id, 'r_1', 'still open');
  assert.deepEqual(step.request.rejection, { code: 'too_blurry', message: 'Blurry.' });
  // a refusal of a photo nothing asked for becomes a note, and changes nothing open
  assert.equal(
    applyUiMessage(null, readUiMessage({ type: 'image_rejected', request_id: null, code: 'not_accepted', message: 'No photos here.' })).note,
    'No photos here.',
  );
  // done for another request changes nothing; for this one it closes it
  assert.equal(applyUiMessage(step.request, readUiMessage({ type: 'request_done', request_id: 'r_9', kind: 'upload', status: 'received' })).request.id, 'r_1');
  const done = applyUiMessage(step.request, readUiMessage({ type: 'request_done', request_id: 'r_1', kind: 'upload', status: 'received' }));
  assert.equal(done.request, null);
  assert.deepEqual(done.done, { id: 'r_1', kind: 'upload', status: 'received', sent: null });
  // a new request replaces an older one
  const next = applyUiMessage(step.request, readUiMessage({ type: 'request_image', request_id: 'r_2', kind: 'camera' }));
  assert.equal(next.request.id, 'r_2');
  assert.equal(next.request.kind, 'camera');
});

test('a photo asked for straight after the camera is the camera check’s retake: the camera only, never a file', () => {
  const photo = (id) => readUiMessage({ type: 'request_image', request_id: id, kind: 'upload' });
  // after a camera request that ended (its picture taken, or none came)
  assert.equal(applyUiMessage(null, photo('r_3'), 0, 'camera').request.cameraOnly, true);
  // or one it replaced while still open
  const open = applyUiMessage(null, readUiMessage({ type: 'request_image', request_id: 'r_2', kind: 'camera' })).request;
  assert.equal(applyUiMessage(open, photo('r_3')).request.cameraOnly, true);
  // any other photo request takes a file as usual
  assert.equal(applyUiMessage(null, photo('r_1')).request.cameraOnly, false);
  assert.equal(applyUiMessage(null, photo('r_4'), 0, 'upload').request.cameraOnly, false);
  // and a camera request is a camera request
  assert.equal(applyUiMessage(null, readUiMessage({ type: 'request_image', request_id: 'r_5', kind: 'camera' }), 0, 'camera').request.cameraOnly, false);
});

test('a photo is checked before it is sent: empty, too big, the wrong kind; and the same file is recognised', () => {
  const file = (size, type, name = 'id.jpg') => ({ size, type, name, lastModified: 5 });
  assert.equal(uploadProblem(file(1000, 'image/jpeg'), { accept: ['image/jpeg'], maxBytes: 8388608 }), '');
  assert.match(uploadProblem(file(0, 'image/jpeg'), {}), /empty/);
  assert.match(uploadProblem(file(13002342, 'image/jpeg'), { maxBytes: 8388608 }), /12\.4 MB.*up to 8 MB/);
  assert.match(uploadProblem(file(10, 'image/gif'), { accept: ['image/jpeg', 'image/png'] }), /JPG, PNG/);
  assert.equal(uploadProblem(file(10, ''), { accept: ['image/png'] }), '', 'a type the browser doesn’t know is left to the runtime, which reads the bytes');
  assert.equal(uploadProblem(file(10, 'image/heic'), { accept: ['image/*'] }), '');
  assert.equal(fileKey(file(10, 'image/png', 'a.png')), fileKey(file(10, 'image/png', 'a.png')));
  assert.notEqual(fileKey(file(10, 'image/png', 'a.png')), fileKey(file(11, 'image/png', 'a.png')));
  assert.equal(fileKey({ ...file(10, 'image/png', 'a.png'), lastModified: 9 }), fileKey(file(10, 'image/png', 'a.png')), 'read again, the same file');
  assert.deepEqual(acceptWords(['image/jpeg', 'image/png', 'image/webp']), ['JPG', 'PNG', 'WebP']);
  assert.equal(formatBytes(8388608), '8 MB');
  assert.equal(formatBytes(1258291), '1.2 MB');
  assert.equal(formatBytes(428032), '418 KB');
});

test('the countdown', () => {
  const request = { startedAt: 0, timeoutS: 180 };
  assert.equal(secondsLeft(request, 14000), 166);
  assert.equal(secondsLeft(request, 999999), 0);
  assert.equal(secondsLeft({ startedAt: 0, timeoutS: 0 }, 5), null, 'no time given: no countdown');
  assert.equal(clockText(166), '2:46');
});

// ---- the simulated agent's pictures

const onboarding = () => ({
  agents: {
    entry: 'desk',
    items: [{ id: 'desk', name: 'Desk', on_enter: [{ type: 'say', text: 'Hi' }] }],
  },
  channels: [{ id: 'web', type: 'web_chat', modalities: { input: ['text', 'image'] }, inputs: { image: { accepted_mime: ['image/png'], max_bytes: 1000 } } }],
  tools: [
    {
      id: 'verify_id',
      description: 'Check the caller’s identity card when they open an account',
      effects: [
        {
          do: [
            { type: 'say', text: 'Please upload your ID card.' },
            { type: 'request_image', kind: 'upload', into: 'id_photo', quality: { min_sharpness: 8 } },
            { type: 'analyze_image', images: ['id_photo'], instructions: 'Read it', fields: { full_name: { type: 'string' } } },
          ],
        },
      ],
    },
  ],
  tests: [{ id: 't', turns: [{ upload: 'x' }], images: { x: { lines: [] } }, expect: [] }],
});

test('the simulation finds the steps that ask for a picture, and what starts them', () => {
  const flows = findPictureFlows(onboarding());
  assert.equal(flows.length, 1, 'a scenario’s own pictures are not the agent’s steps');
  assert.equal(flows[0].start, false);
  assert.equal(flows[0].label, 'verify_id');
  assert.ok(flowStartsOn(flows[0], 'Can I send a photo?'));
  assert.ok(flowStartsOn(flows[0], 'I would like to open an account'));
  assert.ok(flowStartsOn(flows[0], 'check my identity card please'), 'the words of the tool it belongs to');
  assert.equal(flowStartsOn(flows[0], 'What are your opening hours?'), false);
  const atStart = onboarding();
  atStart.agents.items[0].on_enter.push({ type: 'request_image', kind: 'camera', into: 'selfie' });
  assert.equal(
    findPictureFlows(atStart)
      .find((f) => f.start)
      ?.path.join('.'),
    'agents.items.0.on_enter',
    'the entry agent’s on_enter runs as the call starts',
  );
});

test('the request the simulation shows comes from the step and the channel', () => {
  const config = onboarding();
  const msg = requestMessage({ kind: 'upload', prompt: 'Front of the card', timeout_s: 30 }, config.channels[0], 'sim_1');
  assert.deepEqual(msg, {
    type: 'request_image',
    request_id: 'sim_1',
    kind: 'upload',
    prompt: 'Front of the card',
    accept: ['image/png'],
    max_bytes: 1000,
    timeout_s: 30,
  });
  assert.equal(requestMessage({ kind: 'camera' }, null, 'x').timeout_s, 120, 'the schema’s default wait');
});

test('a picture is held to the step’s standard, in the runtime’s order', () => {
  const q = { min_sharpness: 8, min_brightness: 40, max_brightness: 230, min_dimension: 480 };
  assert.equal(qualityVerdict(q, { width: 1600, height: 1200, sharpness: 846, brightness: 141 }), '');
  assert.equal(qualityVerdict(q, { width: 1600, height: 1200, sharpness: 3.7, brightness: 128 }), 'too_blurry');
  assert.equal(qualityVerdict(q, { width: 1600, height: 1200, sharpness: 50, brightness: 12 }), 'too_dark');
  assert.equal(qualityVerdict(q, { width: 1600, height: 1200, sharpness: 50, brightness: 250 }), 'too_bright');
  assert.equal(qualityVerdict(q, { width: 320, height: 240, sharpness: 50, brightness: 120 }), 'too_small');
  assert.equal(qualityVerdict(null, { sharpness: 0 }), '', 'no standard: anything passes');
});

test('“Only when…” is honoured where the simulation can know, and said unknowable where it can’t', () => {
  const state = { verified: false, tries: 2 };
  assert.equal(conditionHolds(undefined, state), true);
  assert.equal(conditionHolds({ state: 'verified', equals: false }, state), true);
  assert.equal(conditionHolds({ state: 'verified', not_equals: false }, state), false);
  assert.equal(conditionHolds({ all: [{ state: 'tries', gte: 2 }, { not: { state: 'verified', equals: true } }] }, state), true);
  assert.equal(
    conditionHolds(
      {
        any: [
          { result: '$.ok', equals: true },
          { state: 'tries', lte: 1 },
        ],
      },
      state,
    ),
    null,
  );
  assert.equal(conditionHolds({ channel: 'web' }, state, 'web'), true);
  assert.equal(conditionHolds({ schedule: 'office', open: true }, state), null);
});

test('values are compared the way “Compare values” does: names fuzzily, codes by letters and digits, dates as days', () => {
  const state = {
    read_name: 'Jane  Sample',
    typed_name: 'sample, jane',
    read_id: 'S 1234567-D',
    typed_id: 's1234567d',
    read_birth: '05/04/1990',
    typed_birth: '1990-04-05',
    expiry: '2030-04-05',
    today: '2026-11-05',
    empty: '',
  };
  assert.equal(comparePair({ left: 'read_name', right: 'typed_name' }, state).matched, true);
  assert.equal(comparePair({ left: 'read_id', right: 'typed_id', method: 'id' }, state).matched, true);
  assert.equal(comparePair({ left: 'read_birth', right: 'typed_birth', method: 'date' }, state).matched, true, 'dmy by default');
  assert.equal(comparePair({ left: 'read_birth', right: 'typed_birth', method: 'date', date_order: 'mdy' }, state).matched, false);
  assert.equal(comparePair({ left: 'expiry', right: 'today', method: 'date_on_or_after' }, state).matched, true);
  assert.equal(comparePair({ left: 'empty', right: 'typed_name' }, state).matched, false, 'a missing value never matches');
  assert.equal(comparePair({ left: 'empty', right: 'typed_name', optional: true }, state).skipped, true);
  const all = compareValues(
    {
      pairs: [
        { left: 'read_name', right: 'typed_name', label: 'name' },
        { left: 'read_id', right: 'typed_id', method: 'id', label: 'id number' },
        { left: 'read_birth', right: 'typed_birth', method: 'date', date_order: 'mdy', label: 'birth date' },
      ],
    },
    state,
  );
  assert.equal(all.matched, false);
  assert.deepEqual(all.differences, ['birth date']);
  assert.equal(
    compareValues(
      {
        require: 'any',
        pairs: [
          { left: 'read_name', right: 'typed_name' },
          { left: 'empty', right: 'typed_id' },
        ],
      },
      state,
    ).matched,
    true,
  );
  assert.equal(readDate('2026-1-5'), '2026-01-05');
});

test('sharpness and brightness are measured as the runtime does: edge variance and average grey', () => {
  const w = 8;
  const h = 8;
  const flat = new Float32Array(w * h).fill(128);
  assert.deepEqual(measureGrey(flat, w, h), { sharpness: 0, brightness: 128 }, 'a flat picture has no edges');
  const checks = new Float32Array(w * h).map((_, i) => (((i % w) + Math.floor(i / w)) % 2 ? 255 : 0));
  const sharp = measureGrey(checks, w, h);
  assert.ok(sharp.sharpness > 1000, `a fine pattern is very sharp (${sharp.sharpness})`);
  assert.equal(Math.round(sharp.brightness), 128);
});

// ---- the call record: the picture events as lines a person can follow

const call = [
  {
    seq: 1,
    elapsed_s: 42,
    event: 'image',
    step: 'requested',
    request_id: 'r1',
    kind: 'upload',
    into: 'id_photo',
    timeout_s: 180,
    quality: { min_sharpness: 8, min_brightness: 40, max_brightness: 230 },
  },
  {
    seq: 2,
    elapsed_s: 65,
    event: 'image',
    step: 'rejected',
    request_id: 'r1',
    code: 'too_blurry',
    sharpness: 3.7,
    brightness: 128,
    width: 1280,
    height: 960,
    bytes: 428032,
  },
  { seq: 3, elapsed_s: 91, event: 'image', step: 'received', request_id: 'r1', kind: 'upload', sharpness: 846, brightness: 141, width: 1600, height: 1200 },
  { seq: 4, elapsed_s: 91.2, event: 'image', step: 'request_ended', request_id: 'r1', status: 'received' },
  { seq: 5, elapsed_s: 94, event: 'image_analysis', fields: ['full_name', 'id_number', 'birth_date', 'expiry'], read: 4, ok: true, tokens: 1240 },
  {
    seq: 6,
    elapsed_s: 139,
    event: 'compare',
    matched: false,
    score: 0.62,
    pairs: [
      { label: 'name', matched: true },
      { label: 'id number', matched: true },
      { label: 'birth date', matched: false },
    ],
  },
  { seq: 7, elapsed_s: 140, event: 'image', step: 'discarded', images: ['id_photo', 'selfie_card'] },
  { seq: 8, elapsed_s: 141, event: 'image', step: 'ignored', reason: 'not_the_visitor' },
];

test('picture records read as lines, with the numbers an author calibrates the standard with', () => {
  const rows = describeRecords(call);
  assert.deepEqual(
    rows.map((r) => r.text),
    [
      'Photo asked for',
      'Photo turned down: too blurry (sharpness 3.7)',
      'Photo received',
      'Request ended: a picture came in',
      'Photo read: 4 of 4 values',
      'Comparison: name and id number matched, birth date differs',
      'Pictures forgotten: id_photo, selfie_card',
      'A picture was ignored',
    ],
  );
  // the refused photo's sharpness drawn against the 8 its request asked for, its brightness inside the band
  const refused = rows[1];
  assert.equal(refused.tone, 'warn');
  assert.deepEqual(
    refused.meters.map((m) => [m.id, m.value, m.need, m.band]),
    [
      ['sharpness', 3.7, 8, undefined],
      ['brightness', 128, undefined, [40, 230]],
    ],
  );
  assert.equal(rows[2].tone, 'good');
  // a later request with no standard of its own is not measured against an earlier one's
  const later = describeRecords([
    ...call,
    { seq: 20, event: 'image', step: 'requested', request_id: 'r2', kind: 'camera' },
    { seq: 21, event: 'image', step: 'received', request_id: 'r2', kind: 'camera', sharpness: 40, brightness: 100 },
  ]);
  assert.equal(later.at(-1).meters[0].need, undefined);
  assert.match(rows[4].note, /never sent to the studio/, 'what was read is never shown, and the line says so');
  assert.deepEqual(rows[5].pairs, [
    { label: 'name', matched: true },
    { label: 'id number', matched: true },
    { label: 'birth date', matched: false },
  ]);
  // a Pictures filter, with its count
  assert.equal(groupCounts(rows).pictures, 8);
  assert.equal(filterRows(rows, ['pictures']).length, 8);
  // no picture and no value read is anywhere in a row
  assert.ok(rows.every((r) => !JSON.stringify(r.facts).includes('JANE')));
});

// The real server's shape (picture-widget-test, 2026-11-05): a request names its `kind`, a picture that came in or was
// turned down names its `source` and carries no request id, and each forgotten picture is its own record by `id`.
test('real picture records: camera frames read as camera, the picture id shows, each forgotten picture by id', () => {
  const rows = describeRecords([
    { seq: 3, elapsed_s: 0.08, event: 'image', step: 'requested', request_id: 'r_1', kind: 'upload' },
    { seq: 5, elapsed_s: 1.07, event: 'image', step: 'rejected', code: 'too_blurry', source: 'upload', sharpness: 0 },
    { seq: 6, elapsed_s: 1.69, event: 'image', step: 'received', id: 'img_1', source: 'upload', width: 800, height: 504, bytes: 26009, sharpness: 13421.8 },
    { seq: 7, elapsed_s: 1.69, event: 'image', step: 'request_ended', request_id: 'r_1', kind: 'upload', status: 'received' },
    { seq: 9, elapsed_s: 1.7, event: 'image', step: 'requested', request_id: 'r_2', kind: 'camera' },
    {
      seq: 12,
      elapsed_s: 3.8,
      event: 'image',
      step: 'rejected',
      code: 'too_small',
      source: 'camera',
      width: 320,
      height: 180,
      sharpness: 147.1,
      brightness: 89.3,
    },
    { seq: 15, elapsed_s: 9.7, event: 'image', step: 'received', id: 'img_2', source: 'camera', width: 1280, height: 720, sharpness: 81.7, brightness: 90.4 },
    { seq: 18, elapsed_s: 9.73, event: 'image', step: 'discarded', id: 'img_1' },
  ]);
  assert.deepEqual(
    rows.map((r) => r.text),
    [
      'Photo asked for',
      'Photo turned down: too blurry (sharpness 0)',
      'Photo received',
      'Request ended: a picture came in',
      'Camera asked for',
      'Camera picture turned down: too small',
      'Picture taken from the camera',
      'Picture forgotten: img_1',
    ],
  );
  assert.deepEqual(rows[2].facts.at(-1), ['kept as', 'img_1']);
  assert.deepEqual(rows[6].facts.at(-1), ['kept as', 'img_2']);
});

test('a call read as a chat shows a picture asked for, turned down and received where it happened', () => {
  const { items } = chatOf([
    { seq: 0, elapsed_s: 30, event: 'agent_said', text: 'Please upload your ID card.' },
    ...call,
    { seq: 9, elapsed_s: 150, event: 'agent_said', text: 'Thank you.' },
  ]);
  assert.deepEqual(
    items.filter((i) => i.type === 'picture').map((i) => i.text),
    ['Photo asked for', 'Photo turned down: too blurry (sharpness 3.7)', 'Photo received'],
  );
});

// ---- Build: the step sentences, the camera's sharpness, the channel that can take it

test('the picture steps read as sentences, and any step says when it only runs sometimes', () => {
  assert.equal(describeAction({ type: 'request_image', kind: 'camera', into: 'selfie' }), 'Ask for the camera, keep it in selfie');
  assert.equal(describeAction({ type: 'analyze_image', images: ['id_photo'], fields: { full_name: {}, expiry: {} } }), 'Read full_name, expiry from id_photo');
  assert.equal(describeAction({ type: 'compare_values', pairs: [{ left: 'doc_name', right: 'typed_name' }] }), 'Compare doc_name with typed_name');
  assert.equal(describeAction({ type: 'discard_image', images: ['id_photo', 'selfie'] }), 'Forget id_photo and selfie');
  assert.match(describeAction({ type: 'say', text: 'Hi', when: { state: 'verified', equals: true } }), /^Say “Hi”, only when /);
});

test('the camera needs its own sharpness standard: the hint says so beside the number', () => {
  assert.equal(sharpnessAdvice('camera', 8).tone, 'warn', 'an upload’s 8 can never refuse a blurred camera frame (video lifts it to about 10)');
  assert.match(sharpnessAdvice('camera', 8).text, /about 10/);
  assert.equal(sharpnessAdvice('camera', 25).tone, 'ok');
  assert.equal(sharpnessAdvice('upload', 8).tone, 'ok');
  assert.equal(sharpnessAdvice('upload', 3).tone, 'warn');
  // the scale is logarithmic and comes back to round numbers
  [5, 8, 10, 25, 100, 1000].forEach((v) => assert.ok(Math.abs(fromScale(toScale(v)) - v) <= Math.max(0.5, v * 0.02), `${v} survives the slider`));
});

test('a picture step on an agent whose web channels can’t take it says so, and the fix adds the input', () => {
  const config = {
    channels: [
      { id: 'web', type: 'web_chat', modalities: { input: ['text'] } },
      { id: 'phone', type: 'sip_voice' },
    ],
  };
  assert.equal(channelGap(config, 'upload').want, 'image');
  assert.equal(channelGap(config, 'camera').want, 'video');
  const fixed = withInput(config, 'image');
  assert.deepEqual(fixed.channels[0].modalities.input, ['text', 'image']);
  assert.equal(fixed.channels[1], config.channels[1], 'a phone line is left alone: it carries no pictures');
  assert.equal(channelGap(fixed, 'upload'), null);
  assert.equal(channelGap({ channels: [{ id: 'p', type: 'sip_voice' }] }, 'upload').none, true);
  // the server refuses picture input unless the model in play reads pictures (agent config guide 3.9): every one is marked
  const withModels = {
    ...config,
    defaults: { models: { llm: { provider: 'openai', model: 'gpt-4.1-mini' } } },
    agents: {
      entry: 'a',
      items: [
        { id: 'a', tools: [] },
        { id: 'b', tools: [], overrides: { models: { llm: { model: 'gpt-4.1' } } } },
      ],
    },
  };
  const seen = withInput(withModels, 'video');
  assert.equal(seen.defaults.models.llm.vision, true);
  assert.equal(seen.defaults.models.llm.model, 'gpt-4.1-mini', 'the rest of the model is kept');
  assert.equal(seen.agents.items[1].overrides.models.llm.vision, true, 'an agent’s own model too');
  assert.equal(seen.agents.items[0], withModels.agents.items[0], 'an agent without its own model is left alone');
  assert.equal(withModels.defaults.models.llm.vision, undefined, 'the draft given is not changed');
});
