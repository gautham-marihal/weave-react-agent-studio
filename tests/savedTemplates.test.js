import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEMPLATES,
  applyTemplate,
  deleteTemplate,
  loadTemplates,
  parseTemplateFile,
  saveTemplate,
  templateFileName,
  templateToFile,
  toTemplateConfig,
} from '../src/studio/savedTemplates.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/minimalConfig.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
};
const acme = () => ({
  ...applyStarter(minimalConfig('acme-support', 'Acme Support'), 'support'),
  meta: {
    id: 'acme-support',
    name: 'Acme Support',
    version: '0.4.2',
    status: 'published',
    created_at: 'x',
    updated_at: 'y',
    tags: ['care'],
    owner: 'team-a',
    description: 'Care',
  },
});

test('a template keeps everything that makes an agent what it is and nothing that makes it THIS agent', () => {
  const config = acme();
  const t = toTemplateConfig(config);
  assert.deepEqual(Object.keys(t.meta).sort(), ['description', 'owner', 'tags'], 'id, name, version, status and the server’s dates are left out');
  assert.deepEqual(t.channels, config.channels);
  assert.deepEqual(t.agents, config.agents);
  assert.deepEqual(t.tools, config.tools);
  assert.equal(config.meta.id, 'acme-support', 'the original is not changed');
});

test('templates are saved newest first with unique ids, listed, and removed', () => {
  const store = memory();
  assert.deepEqual(loadTemplates(store), []);
  const one = saveTemplate({ name: 'Clinic front desk', description: 'For clinics', config: acme(), sourceName: 'Acme Support' }, store);
  assert.equal(one.saved, true);
  assert.equal(one.template.id, 'clinic-front-desk');
  const two = saveTemplate({ name: 'Clinic front desk', config: acme() }, store);
  assert.equal(two.template.id, 'clinic-front-desk-2', 'the same name does not overwrite');
  assert.deepEqual(
    loadTemplates(store).map((t) => t.id),
    ['clinic-front-desk-2', 'clinic-front-desk'],
    'newest first',
  );
  assert.equal(loadTemplates(store)[1].description, 'For clinics');
  assert.deepEqual(
    deleteTemplate('clinic-front-desk-2', store).map((t) => t.id),
    ['clinic-front-desk'],
  );
  assert.equal(loadTemplates(store).length, 1);
  for (let i = 0; i < MAX_TEMPLATES + 5; i += 1) saveTemplate({ name: `t${i}`, config: acme() }, store);
  assert.equal(loadTemplates(store).length, MAX_TEMPLATES, 'a few dozen at most');
  assert.equal(
    saveTemplate(
      { name: 'x', config: acme() },
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('full');
        },
      },
    ).saved,
    false,
    'a full or disabled storage is reported, not hidden',
  );
  assert.deepEqual(
    loadTemplates({
      getItem: () => {
        throw new Error('no storage');
      },
    }),
    [],
  );
  assert.deepEqual(loadTemplates({ getItem: () => '{"not":"a list"}' }), []);
  assert.deepEqual(loadTemplates({ getItem: () => 'not json' }), []);
});

test('a new agent from a template has the new agent’s own id, name and version, and the template’s contents', () => {
  const store = memory();
  const { template } = saveTemplate({ name: 'Care', config: acme(), sourceName: 'Acme Support' }, store);
  const fresh = minimalConfig('beta-care', 'Beta Care'); // what the server hands back when the agent is created
  const made = applyTemplate(fresh, template);
  assert.deepEqual([made.meta.id, made.meta.name, made.meta.version, made.meta.status], ['beta-care', 'Beta Care', '0.1.0', 'draft']);
  assert.deepEqual(made.meta.tags, ['care'], 'tags and owner come with the template');
  assert.equal(made.meta.owner, 'team-a');
  assert.deepEqual(made.tools, acme().tools);
  assert.deepEqual(made.agents, acme().agents);
  assert.equal(made.persona.name, 'Beta Care', 'the template’s own agent name does not leak into the new agent');
  assert.equal(template.config.meta.id, undefined, 'the template is not changed by using it');
  const custom = applyTemplate(fresh, { ...template, config: { ...template.config, persona: { name: 'Sam' } }, sourceName: 'Acme Support' });
  assert.equal(custom.persona.name, 'Sam', 'a persona name that is its own is kept');
});

test('a template is shared as a file, and a shared file (or a plain exported configuration) can be imported', () => {
  const { template } = saveTemplate({ name: 'Care desk', description: 'Front desk', config: acme(), sourceName: 'Acme Support' }, memory());
  assert.equal(templateFileName(template), 'care-desk.template.json');
  const text = templateToFile(template);
  assert.ok(text.endsWith('\n'));
  assert.equal(JSON.parse(text).format, 'weave-agent-template');
  const back = parseTemplateFile(text);
  assert.equal(back.template.name, 'Care desk');
  assert.equal(back.template.description, 'Front desk');
  assert.deepEqual(back.template.config, template.config);
  // an exported agent configuration works too
  const bare = parseTemplateFile(JSON.stringify(acme()), 'acme-support.json');
  assert.equal(bare.template.name, 'Acme Support');
  assert.equal(bare.template.config.meta.id, undefined, 'its id and version are dropped');
  assert.equal(parseTemplateFile(JSON.stringify({ agents: { items: [] } }), 'My bot.json').template.name, 'My bot');
  // what is refused, and why
  assert.match(parseTemplateFile('not json').error, /isn’t valid JSON/);
  assert.match(parseTemplateFile('[1,2]').error, /one JSON object/);
  assert.match(parseTemplateFile('{"format":"weave-agent-template","config":5}').error, /no configuration/);
  assert.match(parseTemplateFile('{"hello":"world"}').error, /doesn’t look like an agent configuration/);
});
