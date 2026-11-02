import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AGENT_SEARCH,
  BUILD_SECTIONS,
  PANEL_PATHS,
  SECTION_KEYS,
  agentSearchHref,
  capSameLabel,
  locate,
  problemsBySection,
  readDeepLink,
  searchAgent,
  searchTarget,
  sectionOfPath,
  settingHref,
  settingWhere,
  targetPath,
} from './agentPages';
import { buildSettingsIndex, searchSettings } from './schemaForm/settingsSearch';
import type { RawSchema } from './schemaForm/engine';

// Ported from Weave React's agentPages, settingsSearch ("agent pages") and match tests, for Studio's stages and Build
// sections: where a place in the config is edited, and the links that open it.
const schema = JSON.parse(readFileSync(new URL('../test/fixtures/agent-config.schema.json', import.meta.url), 'utf8')) as RawSchema;
const index = buildSettingsIndex(schema);
const entry = (trail: string) => index.find((e) => e.trail.join('.') === trail);

describe('pages and addresses', () => {
  it('a target makes an address, with the Build view and the field to open', () => {
    expect(targetPath('acme', { stage: 'build', section: 'tools' })).toBe('/agents/acme/build/tools');
    expect(targetPath('acme', { stage: 'build', section: 'agent', focus: 'voice' })).toBe('/agents/acme/build/agent?focus=voice');
    expect(targetPath('acme', { stage: 'build', view: 'all' })).toBe('/agents/acme/build?view=all');
    expect(targetPath('a b', { stage: 'test' })).toBe('/agents/a%20b/test');
  });

  it('every top-level section of the configuration is edited in some Build section, once', () => {
    const covered = Object.values(SECTION_KEYS).flat();
    expect(new Set(covered).size).toBe(covered.length);
    const props = Object.keys(schema.properties ?? {}).filter((k) => !['$schema', 'schema_version', 'tests'].includes(k));
    expect(props.filter((k) => !covered.includes(k))).toEqual([]);
    covered.forEach((k) => expect(k in (schema.properties ?? {})).toBe(true));
  });

  it('a problem is counted on the section that edits its place; tests and whole-config problems on none', () => {
    expect(sectionOfPath(['telephony', 'transfers', 0])).toBe('channels');
    expect(sectionOfPath(['wrapups', 0])).toBe('aftercall');
    expect(sectionOfPath(['schedules', 'open'])).toBe('channels');
    expect(sectionOfPath(['mystery'])).toBe('agent');
    expect(sectionOfPath(null)).toBe(null);
    expect(problemsBySection([{ path: ['tools', 0] }, { path: ['tests', 0] }, { path: null }, { path: ['tools', 1] }])).toEqual({ tools: 2 });
  });
});

describe('locate: where a place in the config is edited', () => {
  it('opens the page and the panel that hold it', () => {
    expect(locate(['persona', 'disclosures', 'recording_notice'])).toEqual({ stage: 'build', section: 'aftercall', focus: 'notice' });
    expect(locate(['persona', 'tone'])).toEqual({ stage: 'build', section: 'agent', panel: 'behaviour' });
    expect(locate(['persona', 'company'])).toEqual({ stage: 'build', section: 'agent', panel: 'persona' });
    expect(locate(['defaults', 'models', 'tts', 'voice_id'])).toEqual({ stage: 'build', section: 'agent', panel: 'voice' });
    expect(locate(['defaults', 'models', 'llm', 'model'])).toEqual({ stage: 'build', section: 'agent', panel: 'models' });
    expect(locate(['defaults', 'models', 'llm', 'temperature'])).toEqual({ stage: 'build', section: 'agent' });
    expect(locate(['defaults', 'language', 'primary'])).toEqual({ stage: 'build', section: 'agent', panel: 'language' });
    expect(locate(['channels', 1, 'greeting', 'say'])).toEqual({ stage: 'build', section: 'channels', focus: 'greeting' });
    expect(locate(['tools', 3, 'timeout_s'])).toEqual({ stage: 'build', section: 'tools' });
    expect(locate(['guardrails', 'limits'])).toEqual({ stage: 'build', section: 'guardrails' });
    expect(locate(['tests', 0])).toEqual({ stage: 'test', focus: 'scenarios' });
    expect(locate([])).toEqual({ stage: 'build', section: 'agent' });
  });

  it('nothing in the settings index is placed on a page the agent does not have', () => {
    const sections = BUILD_SECTIONS.map((s) => s.id);
    const lost = index.filter((e) => {
      const t = searchTarget(e);
      return t.stage === 'build' ? !(t.view || (t.section && sections.includes(t.section))) : t.stage !== 'test';
    });
    expect(lost.map((e) => e.trail.join('.'))).toEqual([]);
  });
});

describe('deep links: ?setting=, ?tool=, ?open=, ?show=', () => {
  const config = { tools: [{ id: 'end_call' }, { id: 'lookup_order' }] };
  const read = (q: string) => readDeepLink(new URLSearchParams(q), config);

  it('?setting= opens the exact field, written with dots or brackets', () => {
    expect(read('setting=defaults.conversation.inactivity.timeout_s')).toMatchObject({
      path: ['defaults', 'conversation', 'inactivity', 'timeout_s'],
      target: { stage: 'build', section: 'agent' },
      consumed: ['setting'],
    });
    expect(read('setting=channels[0].greeting.say')?.path).toEqual(['channels', 0, 'greeting', 'say']);
    expect(read('setting=channels.0.greeting')?.target).toEqual({ stage: 'build', section: 'channels', focus: 'greeting' });
  });

  it('?tool= opens that tool by its id, or the tools when there is no such tool', () => {
    expect(read('tool=lookup_order')).toMatchObject({ path: ['tools', 1], target: { stage: 'build', section: 'tools' } });
    expect(read('tool=nope')?.path).toEqual(['tools']);
  });

  it('?open= opens a panel of the Agent section, also by the names old links used', () => {
    expect(read('open=voice')).toMatchObject({ path: PANEL_PATHS.voice, target: { section: 'agent', panel: 'voice' } });
    expect(read('open=model')?.target?.panel).toBe('models');
    expect(read('open=nothing')).toMatchObject({ path: null, target: null });
  });

  it('?show=problems and ?show=json', () => {
    expect(read('show=problems')).toMatchObject({ problems: true, path: null, consumed: ['show'] });
    expect(read('show=json')?.target).toMatchObject({ stage: 'build', view: 'json' });
    expect(read('setting=tools&show=json')?.target).toMatchObject({ section: 'tools', view: 'json' });
    expect(read('view=all')).toBe(null);
  });

  it('a setting has one address, on the section that edits it', () => {
    expect(settingHref('acme', ['defaults', 'models', 'tts', 'voice_id'])).toBe('/agents/acme/build/agent?setting=defaults.models.tts.voice_id');
    expect(settingHref('acme', ['tools', 2, 'timeout_s'])).toBe('/agents/acme/build/tools?setting=tools.2.timeout_s');
    expect(read(settingHref('acme', ['tools', 2]).split('?')[1])?.path).toEqual(['tools', 2]);
  });
});

describe('search on an agent', () => {
  it('a setting opens on the section and panel that hold it, and says so in the pages’ words', () => {
    const hours = entry('schedules');
    expect(searchTarget(hours)).toEqual({ stage: 'build', section: 'channels', path: ['schedules'] });
    expect(settingWhere(hours)).toMatch(/^Channels/);
    const greeting = index.find((e) => e.trail[0] === 'channels' && e.trail.includes('greeting'));
    expect(searchTarget(greeting)).toEqual({ stage: 'build', section: 'channels', focus: 'greeting', path: ['channels'] });
    expect(settingWhere(greeting)).toBe('Channels › What it says first');
    const voice = entry('defaults.models.tts.voice_id');
    expect(searchTarget(voice).panel).toBe('voice');
    expect(settingWhere(voice)).toBe('Agent › Voice');
    expect(settingWhere(entry('post_call.recording'))).toMatch(/^After the call › /);
    expect(index.every((e) => !/How it behaves|Where it is available|Quality and records/.test(settingWhere(e)))).toBe(true);
  });

  it('an agent’s instructions open on the Agent section only when there is one agent to have them', () => {
    const role = index.find((e) => e.trail[0] === 'agents' && e.trail[e.trail.length - 1] === 'role');
    expect(role).toBeTruthy();
    expect(searchTarget(role, { agents: { items: [{ id: 'a' }] } }).focus).toBe('instructions');
    expect(searchTarget(role).focus).toBe('instructions');
    const several = searchTarget(role, { agents: { items: [{ id: 'a' }, { id: 'b' }] } });
    expect(several.focus).toBeUndefined();
    expect(several.view).toBe('canvas');
  });

  it('a setting found under one name in many places is listed twice at most', () => {
    const found = searchSettings(index, 'hours', 24);
    const count = (list: { label: string }[]) => list.filter((e) => e.label === 'Business hours').length;
    expect(count(found)).toBeGreaterThan(2);
    const capped = capSameLabel(found, 2);
    expect(count(capped)).toBe(2);
    expect(capped[0]).toBe(found[0]);
    expect(capped.some((e) => e.label !== 'Business hours')).toBe(true);
  });

  it('pages and things to do are found however they are typed, a title match first', () => {
    const ids = (q: string) => searchAgent(q).map((i) => i.id);
    expect(searchAgent('').every((i) => i.id.startsWith('page-'))).toBe(true);
    expect(searchAgent('').length).toBe(AGENT_SEARCH.filter((i) => i.id.startsWith('page-')).length);
    expect(ids('deploy')[0]).toBe('deploy');
    expect(ids('roll back')[0]).toBe('rollback');
    expect(ids('roll bak')[0]).toBe('rollback');
    expect(ids('publsh')[0]).toBe('publish');
    expect(ids('documents')).toContain('page-knowledge');
    expect(ids('knowlege')).toContain('page-knowledge');
    expect(ids('wizard')).toContain('setup');
    expect(ids('voice')).toContain('page-agent');
    expect(ids('problems')[0]).toBe('problems');
    expect(ids('zzz')).toEqual([]);
  });

  it('each thing to do has a real address', () => {
    const href = (id: string) => agentSearchHref('acme', AGENT_SEARCH.find((i) => i.id === id) as (typeof AGENT_SEARCH)[number]);
    expect(href('publish')).toBe('/agents/acme/release?publish=1');
    expect(href('deploy')).toBe('/agents/acme/release?focus=deploy');
    expect(href('problems')).toBe('/agents/acme/build/agent?show=problems');
    expect(href('page-all')).toBe('/agents/acme/build?view=all');
    expect(href('setup')).toBe('/agents/acme/setup');
  });
});
