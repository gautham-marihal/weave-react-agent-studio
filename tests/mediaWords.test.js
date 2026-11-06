import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { journeyOf, mediaIn, notRunOf, stepsIn, summaryLine, wayWords, waysIn } from '../src/studio/agent/detailed/mediaWorkspace/mediaWords.js';
import { RECIPES, addRecipe, addSecondReading, forgetKept, markSeeing } from '../src/studio/agent/detailed/mediaWorkspace/pictureRecipes.js';

// Build › Images & Videos in plain words (mediaWords.js) and its ready sets of steps (pictureRecipes.js), for any agent:
// which ways in take pictures, every picture step with what it plainly lacks, one picture's journey, and the starting
// points, the second reading and the one-click fixes.

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const withForm = () => ({ ...agent(), forms: [{ id: 'check', title: 'Check a card', fields: [], on_submit: [] }] });
const idCheck = () => {
  const config = withForm();
  config.channels = (config.channels || []).map((c) =>
    c.type === 'web_chat' ? { ...c, modalities: { ...c.modalities, input: ['text', 'image', 'video'] } } : c,
  );
  config.defaults.models.llm = { ...config.defaults.models.llm, vision: true };
  config.state = { variables: { id_photo: { type: 'string' }, cam: { type: 'string' }, name: { type: 'string' }, cam_name: { type: 'string' } } };
  config.forms[0].on_submit = [
    { type: 'request_image', kind: 'upload', into: 'id_photo', prompt: 'The front of your card', quality: { min_sharpness: 8, min_dimension: 400 } },
    {
      type: 'analyze_image',
      images: ['id_photo'],
      instructions: 'Read it.',
      fields: { name: { type: 'string' } },
      required: ['name'],
      model: { provider: 'openai', model: 'gpt-4.1' },
    },
    { type: 'request_image', kind: 'camera', into: 'cam', quality: { min_sharpness: 25, min_brightness: 40, min_dimension: 400 } },
    {
      type: 'analyze_image',
      images: ['cam'],
      instructions: 'Read it.',
      fields: { name: { type: 'string' } },
      into: { name: 'cam_name' },
      model: { provider: 'openai', model: 'gpt-4.1' },
    },
    { type: 'compare_values', pairs: [{ left: 'name', right: 'cam_name', label: 'name' }] },
    { type: 'discard_image', images: ['id_photo', 'cam'] },
  ];
  return config;
};

test('ways in: only the website takes pictures, said with the usual size and kinds', () => {
  const ways = waysIn(idCheck());
  const web = ways.find((w) => w.type === 'web_chat');
  assert.deepEqual([web.photo, web.camera, web.onReceive], [true, true, 'attach']);
  assert.deepEqual(wayWords(web), { main: 'Photos and the camera', more: 'answers once the next message comes · up to 8 MB · JPEG, PNG or WEBP' });
  assert.deepEqual(wayWords({ web: false }), { main: 'Voice only', more: 'a phone call carries no pictures' });
});

test('every picture step in words, and what one plainly lacks', () => {
  const steps = stepsIn(idCheck());
  assert.deepEqual(
    steps.map((s) => [s.list, s.name, s.words, s.gap]),
    [
      ['requests', 'Ask for a photo', 'Upload', ''],
      ['reads', 'Read a picture', '1 detail', ''],
      ['requests', 'Ask for the camera', 'Camera', ''],
      ['reads', 'Read a picture', '1 detail', ''],
      ['compares', 'Compare in code', '1 pair, it must match', ''],
      ['forgets', 'Forget pictures', 'id_photo and cam', ''],
    ],
  );
  const broken = idCheck();
  broken.forms[0].on_submit[2].quality.min_sharpness = 8;
  broken.forms[0].on_submit[3].images = ['nobody'];
  broken.channels = broken.channels.map((c) => (c.type === 'web_chat' ? { ...c, modalities: { ...c.modalities, input: ['text', 'image'] } } : c));
  const gaps = stepsIn(broken).map((s) => s.gap);
  assert.match(gaps[2], /No way in takes the camera/);
  assert.match(gaps[3], /Reads nobody, which no step asks for/);
});

test('the journey: a lane per picture, a request asked again joins its lane', () => {
  const config = idCheck();
  config.forms[0].on_submit.splice(1, 0, { type: 'request_image', kind: 'upload', into: 'id_photo' });
  const j = journeyOf(config);
  assert.deepEqual(
    j.lanes.map((l) => [l.v, l.again.length, l.read?.name || null]),
    [
      ['id_photo', 1, 'Read a picture'],
      ['cam', 0, 'Read a picture'],
    ],
  );
  const m = mediaIn(config);
  assert.equal(summaryLine(m), '1 way in takes pictures · 3 requests · 2 readings · 1 comparison · all forgotten');
});

test('a picture never forgotten, or an AI that can’t read pictures, needs a look, and each has its fix', () => {
  const config = idCheck();
  config.forms[0].on_submit.pop();
  let m = mediaIn(config);
  assert.deepEqual(m.kept, ['id_photo', 'cam']);
  const fixed = forgetKept(
    config,
    m.kept,
    m.lanes.map((l) => l.req),
  );
  assert.deepEqual(fixed.config.forms[0].on_submit.at(-1), { type: 'discard_image', images: ['id_photo', 'cam'] });
  config.defaults.models.llm.vision = false;
  m = mediaIn(config);
  assert.equal(m.problems, 2);
  assert.equal(markSeeing(config).defaults.models.llm.vision, true);
});

test('seeing during the conversation: the server’s report when it has answered, else the guide', () => {
  const config = { agents: { items: [{ id: 'a', vision: { mode: 'turn_attach' } }, { id: 'b' }] } };
  assert.deepEqual(notRunOf(config, undefined), { vision: [0] });
  assert.deepEqual(notRunOf(config, []), { vision: [] });
  assert.deepEqual(notRunOf(config, [{ where: 'agents.items[1].vision' }]), { vision: [1] });
});

test('a starting point adds ask, read and forget, with the values each keeps', () => {
  for (const r of RECIPES) {
    const made = addRecipe(withForm(), ['forms', 0, 'on_submit'], r.id);
    const steps = made.config.forms[0].on_submit;
    assert.deepEqual(
      steps.map((s) => s.type),
      ['request_image', 'analyze_image', 'discard_image'],
      r.id,
    );
    assert.deepEqual(made.path, ['forms', 0, 'on_submit', 0]);
    const vars = Object.keys(made.config.state.variables);
    assert.ok(vars.includes(steps[0].into) && vars.includes(steps[1].ok_into), `${r.id}: its values are declared`);
    assert.deepEqual(
      stepsIn(made.config).filter((s) => s.gap),
      [],
      `${r.id}: nothing needs a look`,
    );
  }
});

test('a second reading reads the same picture into values of its own, then compares the two readings', () => {
  const made = addRecipe(withForm(), ['forms', 0, 'on_submit'], 'document');
  const twice = addSecondReading(made.config, ['forms', 0, 'on_submit', 1]);
  const steps = twice.config.forms[0].on_submit;
  assert.deepEqual(
    steps.map((s) => s.type),
    ['request_image', 'analyze_image', 'analyze_image', 'compare_values', 'discard_image'],
  );
  assert.deepEqual(steps[2].images, steps[1].images);
  assert.equal(steps[2].ok_into, undefined);
  assert.deepEqual(
    steps[3].pairs.map((p) => [p.left, p.right, p.method]),
    [
      ['full_name', 'full_name_check', 'text'],
      ['document_number', 'document_number_check', 'id'],
      ['expiry_date', 'expiry_date_check', 'date'],
    ],
  );
  assert.deepEqual(twice.path, ['forms', 0, 'on_submit', 2]);
});
