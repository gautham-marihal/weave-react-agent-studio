import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECENT_KEPT, WORKSPACE_PAGES, paletteGroups, rememberPick, searchKey, type PaletteInput, type PaletteItem } from './paletteSearch';
import { buildSettingsIndex, searchSettings } from './schemaForm/settingsSearch';
import { isMacPlatform, shortcutLabel } from '../utils/keys';

// Ported from Weave React's search.component and workspaceRoutes tests: what the search lists, grouped and best first,
// with the recent picks, an agent's own pages, tasks and settings, numbers and calls.
const schema = JSON.parse(readFileSync(new URL('../test/fixtures/agent-config.schema.json', import.meta.url), 'utf8'));
const index = buildSettingsIndex(schema);

const actions: PaletteItem[] = [
  { kind: 'action', id: 'create', title: 'Create an agent', description: 'Start from a starter, or a blank agent', words: 'new add make', action: 'create' },
  { kind: 'action', id: 'help', title: 'Help & shortcuts', description: 'Keyboard shortcuts', words: 'help keyboard keys', action: 'help' },
];
const base: PaletteInput = {
  query: '',
  actions,
  agents: [
    { id: 'acme-support', name: 'Acme Support', latest: '1.0.0' },
    { id: 'billing-bot', name: 'Billing Bot', latest: null },
  ],
  openAgentId: null,
  numbers: [{ number: '+14155550100', bot: 'acme-support', environment: 'production' }],
  calls: [{ id: 'call-1', agentId: 'billing-bot', channel: 'Phone', when: '2 hours ago', duration: '3m' }],
  settings: [],
  recent: [],
};
const run = (over: Partial<PaletteInput>) => paletteGroups({ ...base, ...over });
const titles = (groups: ReturnType<typeof paletteGroups>) => groups.map((g) => `${g.group}: ${g.items.map((i) => i.title).join(', ')}`);

describe('the search', () => {
  it('lists the pages, actions and agents in groups while nothing is typed; numbers and calls wait for a word', () => {
    const groups = run({});
    expect(groups.map((g) => g.group)).toEqual(['Navigate', 'Actions', 'Agents']);
    expect(groups[0].items[0].title).toBe('Home');
    // signs alone are not a search
    expect(run({ query: '+' }).map((g) => g.group)).toEqual(['Navigate', 'Actions', 'Agents']);
  });

  it('finds results however they are typed, the closest first', () => {
    expect(titles(run({ query: 'knowlege' }))[0]).toBe('Navigate: Knowledge');
    expect(run({ query: 'calsl' }).find((g) => g.group === 'Navigate')?.items[0].title).toBe('Calls');
    expect(run({ query: 'zzqx' })).toEqual([]);
    expect(run({ query: 'acme' }).find((g) => g.group === 'Agents')?.items.map((i) => i.title)).toEqual(['Acme Support']);
  });

  it('offers each agent’s Publish, Test, Deploy and Calls by its name, and finds numbers and calls', () => {
    const acme = run({ query: 'publish acme' }).find((g) => g.group === 'Actions on an agent');
    expect(acme?.items[0]).toMatchObject({ title: 'Publish a version', href: '/agents/acme-support/release?publish=1' });
    expect(run({ query: 'deploy billing' }).find((g) => g.group === 'Actions on an agent')?.items[0].href).toBe('/agents/billing-bot/release?focus=deploy');
    expect(run({ query: 'test billing' }).find((g) => g.group === 'Actions on an agent')?.items[0].href).toBe('/agents/billing-bot/test');
    expect(run({ query: 'calls billing' }).find((g) => g.group === 'Actions on an agent')?.items[0].href).toBe('/calls?agent=billing-bot');
    expect(run({ query: '4155550100' }).find((g) => g.group === 'Phone numbers')?.items[0]).toMatchObject({ title: '+14155550100', description: 'Phone number for Acme Support in production' });
    expect(run({ query: 'billing call' }).find((g) => g.group === 'Calls')?.items[0].href).toBe('/calls/call-1?agent=billing-bot');
  });

  it('on an agent, its own pages come first, with its settings found from the schema', () => {
    const open = { openAgentId: 'acme-support', openConfig: { agents: { items: [{ id: 'a' }] } } };
    const idle = run(open);
    expect(idle[0].group).toBe('This agent');
    expect(idle[0].items.map((i) => i.title)).toContain('Channels');
    const settings = searchSettings(index, 'silent', 24);
    const typed = run({ ...open, query: 'silent', settings });
    const found = typed.find((g) => g.group === 'Settings of this agent');
    expect(found?.items.length).toBeGreaterThan(0);
    expect(found?.items.every((i) => i.href?.startsWith('/agents/acme-support/build'))).toBe(true);
    const voice = run({ ...open, query: 'voice', settings: searchSettings(index, 'voice', 24) }).find((g) => g.group === 'Settings of this agent');
    expect(voice?.items.some((i) => i.href === '/agents/acme-support/build/agent?setting=defaults.models.tts.voice_id' && i.description === 'Agent › Voice')).toBe(true);
    // the open agent's own tasks are not offered again under "Actions on an agent"
    expect(run({ ...open, query: 'publish acme' }).find((g) => g.group === 'Actions on an agent')?.items.some((i) => i.id.startsWith('acme-support:'))).toBeFalsy();
    expect(run({ ...open, query: 'problems' })[0].items[0]).toMatchObject({ title: 'Problems the server found', href: '/agents/acme-support/build/agent?show=problems' });
  });

  it('keeps the 8 most recent picks, newest first, and shows the ones still there while nothing is typed', () => {
    let recent: string[] = [];
    ['home', 'calls', 'agents', 'live', 'knowledge', 'library', 'telephony', 'analytics', 'settings', 'calls'].forEach((id) => {
      recent = rememberPick(recent, searchKey({ kind: 'page', id }));
    });
    expect(recent.length).toBe(RECENT_KEPT);
    expect(recent[0]).toBe('page:calls');
    expect(recent).not.toContain('page:home');
    const groups = run({ recent: ['agent:acme-support', 'agent:gone', 'page:calls'] });
    expect(groups[0]).toMatchObject({ group: 'Recent' });
    expect(groups[0].items.map((i) => i.title)).toEqual(['Acme Support', 'Calls']);
    expect(run({ query: 'calls', recent: ['page:calls'] }).some((g) => g.group === 'Recent')).toBe(false);
  });

  it('finds Telephony, and in Sandbox its test numbers and dispatch rules, each opening its part (Weave React’s search)', () => {
    expect(run({ query: 'dispatch' }).find((g) => g.group === 'Navigate')?.items[0].title).toBe('Telephony');
    expect(run({ query: 'support line' }).some((g) => g.group === 'Telephony')).toBe(false); // none in Live
    const telephony = [
      { id: 'PN1', section: 'numbers' as const, title: '+1 415 555 0142', description: 'Sandbox test number, Support line', words: '14155550142 phone number' },
      { id: 'SDR1', section: 'dispatch' as const, title: 'Main support line', description: 'Sandbox dispatch rule to Acme Support', words: 'dispatch rule' },
    ];
    const rule = run({ query: 'main support', telephony }).find((g) => g.group === 'Telephony')?.items[0];
    expect(rule).toMatchObject({ kind: 'telephony', title: 'Main support line', href: '/telephony/dispatch' });
    expect(run({ query: '0142', telephony }).find((g) => g.group === 'Telephony')?.items[0].href).toBe('/telephony/numbers');
    expect(run({ query: '', telephony }).some((g) => g.group === 'Telephony')).toBe(false);
  });

  it('every workspace page has an address the app has', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    WORKSPACE_PAGES.forEach((p) => {
      const route = (p.href ?? '').replace(/^\//, '');
      expect(route === '' || app.includes(`path: '${route}'`), p.id).toBe(true);
    });
  });

  it('shortcut labels follow the keyboard: ⌘ on a Mac, Ctrl elsewhere', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('iPhone')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(shortcutLabel('k', true)).toBe('⌘ K');
    expect(shortcutLabel('k', false)).toBe('Ctrl K');
  });
});
