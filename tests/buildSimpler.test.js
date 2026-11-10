import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../src/studio/form/engine.js';
import {
  addPictureRequest,
  addTargets,
  aiSeesPictures,
  channelPictures,
  forgetting,
  pictureCounts,
  pictureGroups,
  pictureSteps,
  setAllStrictness,
  setChannelInput,
  sharedStrictness,
} from '../src/studio/pictures/mediaModel.js';
import { STRICTNESS, strictnessOf, withStrictness } from '../src/studio/pictures/strictness.js';
import { countSteps, isStepList, stepsWords } from '../src/studio/agent/detailed/describe.js';
import { addressProblem, connectionFrom, connectionState, secretNamesIn, stepProblems } from '../src/studio/agent/detailed/parts/connectionModel.js';

// The simpler Build (2026-11-05): the Images & Videos part's model, the photo strictness presets, the words for a list
// of steps, and the guided Add a connection, each writing the same configuration the server reads.

const schema = JSON.parse(readFileSync(new URL('./fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const engine = createEngine(schema);
const unbound = () => JSON.parse(readFileSync(new URL('../demos/unbound/use-case-1/onboarding.config.json', import.meta.url), 'utf8'));

test('every picture step is found wherever it is, grouped by the list it is in, the form named by its title', () => {
  const c = unbound();
  const hits = pictureSteps(c);
  assert.ok(hits.length > 10);
  assert.ok(
    hits.every((h) => JSON.stringify(h.path.reduce((n, k) => n[k], c)) === JSON.stringify(h.step)),
    'each path points at its step',
  );
  const groups = pictureGroups(c);
  assert.equal(groups[0].name, `Form “${c.forms[0].title}” · when it is sent`);
  assert.deepEqual(pictureCounts(c), { photo: 3, video: 1, read: 4, compare: 6, forget: 3 });
});

test('a channel takes photos or the camera, and turning one on marks the AI as seeing pictures', () => {
  const c = unbound();
  const chat = channelPictures(c).findIndex((x) => x.channel.type === 'web_chat');
  const off = setChannelInput(c, chat, 'video', false);
  assert.equal(channelPictures(off)[chat].camera, false);
  assert.equal(channelPictures(off)[chat].photo, true, 'photos stay');
  const blind = { ...off, defaults: { ...off.defaults, models: { ...off.defaults.models, llm: { ...off.defaults.models.llm, vision: false } } } };
  assert.equal(aiSeesPictures(blind).sees, false);
  const on = setChannelInput(blind, chat, 'video', true);
  assert.equal(channelPictures(on)[chat].camera, true);
  assert.equal(on.defaults.models.llm.vision, true, 'the AI sees pictures again');
  assert.equal(c.channels[chat].modalities.input.includes('video'), true, 'the draft given is not changed');
});

test('the strictness presets: the word a request shows, and one choice setting every request of a kind', () => {
  assert.equal(strictnessOf('upload', { min_sharpness: 8 }), 'standard');
  assert.equal(strictnessOf('camera', { min_sharpness: 25 }), 'standard');
  assert.equal(strictnessOf('upload', { min_sharpness: 9 }), 'custom');
  assert.equal(strictnessOf('upload', undefined), null);
  assert.deepEqual(withStrictness('upload', { max_brightness: 235 }, 'strict'), { max_brightness: 235, ...STRICTNESS.upload.strict });
  const c = unbound();
  assert.equal(sharedStrictness(c, 'upload', strictnessOf), 'standard');
  const strict = setAllStrictness(c, 'upload', 'strict');
  assert.equal(sharedStrictness(strict, 'upload', strictnessOf), 'strict');
  assert.equal(sharedStrictness(strict, 'camera', strictnessOf), 'standard', 'camera requests are left alone');
});

test('privacy: every picture asked for is forgotten by a step', () => {
  const f = forgetting(unbound());
  assert.deepEqual([...f.asked].sort(), ['id_photo', 'video_frame']);
  assert.deepEqual([...f.forgotten].sort(), ['id_photo', 'video_frame']);
});

test('a new photo request goes at the end of a form’s steps with its own remembered value, and the agent stays valid', () => {
  const c = unbound();
  const [target] = addTargets(c);
  const made = addPictureRequest(c, target.path, 'upload');
  const step = made.path.reduce((n, k) => n[k], made.config);
  assert.equal(step.type, 'request_image');
  assert.ok(made.config.state.variables[step.into], 'its value is declared');
  assert.equal(strictnessOf('upload', step.quality), 'standard');
  // the step and its value are what the schema accepts
  assert.ok(engine.fits(schema.$defs.actionRequestImage, step), 'the step fits the schema');
  assert.ok(engine.fits(schema.$defs.stateVariable, made.config.state.variables[step.into]));
});

test('a list of steps is told from a form’s questions, and counted with its pictures named', () => {
  const c = unbound();
  assert.equal(isStepList(c.forms[0].on_submit), true);
  assert.equal(isStepList(c.forms[0].fields), false, 'questions have types too, but not step types');
  const n = countSteps(c.forms[0].on_submit);
  assert.equal(n.top, c.forms[0].on_submit.length);
  assert.ok(n.photo >= 2 && n.video === 1);
  assert.match(stepsWords(c.forms[0].on_submit), /^\d+ steps, with \d+ photo requests, 1 video check/);
});

test('a connection from the guided Add: the saved shape, its checks and its state', () => {
  const answers = {
    type: 'http',
    name: 'crm_service',
    address: 'https://crm.example.com/api',
    signIn: 'bearer',
    token: 'CRM_TOKEN',
    header: 'X-API-Key',
    key: '',
    username: '',
    password: '',
    headers: [{ key: 'X-Tenant', value: 'acme' }],
    timeout: '12',
    provider: '',
    kind: 'sms',
    from: '',
    credentials: [],
    transport: '',
  };
  const item = connectionFrom(answers);
  assert.deepEqual(item, {
    type: 'http',
    base_url: 'https://crm.example.com/api',
    auth: { type: 'bearer', token: { secret: 'CRM_TOKEN' } },
    headers: { 'X-Tenant': 'acme' },
    timeout_s: 12,
  });
  assert.deepEqual(connectionState(item), { tone: 'good', words: 'Ready' });
  // what each step asks before going on
  assert.ok(stepProblems('service', { ...answers, name: 'mx_bridge' }, ['mx_bridge']).name, 'a name already taken');
  assert.ok(stepProblems('service', { ...answers, name: 'Bad Name' }, []).name, 'a name that isn’t an id');
  assert.ok(stepProblems('address', { ...answers, address: 'crm.example' }, []).address);
  assert.ok(stepProblems('signin', { ...answers, token: 'lower' }, []).token);
  assert.deepEqual(stepProblems('signin', answers, []), {});
  assert.equal(addressProblem('https://ok.example'), '');
  assert.deepEqual(connectionState({ type: 'http', base_url: '' }), { tone: 'bad', words: 'Needs an address' });
  assert.deepEqual(connectionState({ type: 'http', base_url: 'http://plain.example' }), { tone: 'warn', words: 'Not secure (http)' });
  // a texts sender with its credentials named as secrets
  const sms = connectionFrom({
    ...answers,
    type: 'notifier',
    provider: 'twilio',
    from: '+6561234567',
    credentials: [{ key: 'auth_token', value: 'TWILIO_TOKEN' }],
  });
  assert.deepEqual(sms, { type: 'notifier', kind: 'sms', provider: 'twilio', from: '+6561234567', auth: { auth_token: { secret: 'TWILIO_TOKEN' } } });
  // the saved connections are ones the schema accepts
  assert.ok(engine.fits(schema.$defs.connection, item), 'the web API fits the schema');
  assert.ok(engine.fits(schema.$defs.connection, sms), 'the texts sender fits the schema');
  assert.ok(engine.fits(schema.$defs.connection, connectionFrom({ ...answers, type: 'mcp', transport: 'sse', signIn: 'none' })), 'an MCP server too');
  const config = { ...unbound(), connections: { ...unbound().connections, crm_service: item, sms_sender: sms } };
  assert.ok(secretNamesIn(config).includes('CRM_TOKEN'));
});

test('the picture library: every sample picture of the scenarios, what it is and where it is used; changes keep the turns right', async () => {
  const { DEMO_SAMPLES } = await import('../src/demo/demoSamples.js');
  const { addPicture, pictureKind, pictureLibrary, removePicture, renamePicture } = await import('../src/studio/pictures/mediaModel.js');
  const config = DEMO_SAMPLES[0].config;
  for (const scenario of config.tests) assert.ok(engine.fits(schema.properties.tests.items, scenario), `scenario ${scenario.id} fits the schema`);
  const lib = pictureLibrary(config);
  assert.equal(lib.length, 8);
  assert.deepEqual([...new Set(lib.map((p) => p.kind))].sort(), ['card', 'text']);
  assert.deepEqual(lib.find((p) => p.name === 'blurry_card').uses, ['sent as a photo at turn 2']);
  assert.equal(pictureKind({ data_url: 'data:image/png;base64,AA==' }), 'photo');
  // renamed: the turns that send it follow
  const renamed = renamePicture(config, 1, 'blurry_card', 'soft_card');
  assert.ok(renamed.tests[1].images.soft_card && !renamed.tests[1].images.blurry_card);
  assert.deepEqual(renamed.tests[1].turns[1], { upload: 'soft_card' });
  assert.ok(engine.fits(schema.properties.tests.items, renamed.tests[1]));
  // added under a free name, and removed again
  const added = addPicture(config, 0, { data_url: 'data:image/png;base64,AA==' }, 'My Card.png');
  assert.equal(added.name, 'my_card_png');
  assert.equal(pictureLibrary(removePicture(added.config, 0, added.name)).length, 8);
  assert.equal(config.tests[1].images.blurry_card.blur, 6, 'the draft given is not changed');
});
