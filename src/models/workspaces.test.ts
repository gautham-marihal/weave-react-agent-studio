import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agentsInWorkspace, countByWorkspace, ownerOfIn, parseWorkspaces, renamedWorkspace, withoutWorkspace, workspaceNameProblem, type Workspace } from './workspaces';

const ws = (id: string, name = id): Workspace => ({ id, name, createdAt: '' });

describe('workspaces, pure (ownership ported from Weave React starters)', () => {
  it('agent ownership: assigned, else the first workspace; a deleted workspace falls back', () => {
    const spaces = [ws('a'), ws('b')];
    expect(ownerOfIn({}, spaces, 'x')).toBe('a');
    expect(ownerOfIn({ x: 'b' }, spaces, 'x')).toBe('b');
    expect(ownerOfIn({ x: 'gone' }, spaces, 'x')).toBe('a');
    expect(ownerOfIn({ x: 'b' }, [], 'x')).toBeNull();
  });

  it('each workspace lists its own agents, and the counts add up', () => {
    const spaces = [ws('a'), ws('b')];
    const agents = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
    const owners = { two: 'b', three: 'gone' };
    expect(agentsInWorkspace(agents, owners, spaces, 'a').map((x) => x.id)).toEqual(['one', 'three']);
    expect(agentsInWorkspace(agents, owners, spaces, 'b').map((x) => x.id)).toEqual(['two']);
    expect(agentsInWorkspace(agents, owners, [], null)).toHaveLength(3);
    expect(countByWorkspace(agents, owners, spaces)).toEqual({ a: 2, b: 1 });
  });

  it('names: needed, short enough, and not the same as another workspace (ignoring case)', () => {
    const spaces = [ws('a', 'Support'), ws('b', 'Sales')];
    expect(workspaceNameProblem(' ', spaces)).toMatch(/Give the workspace a name/);
    expect(workspaceNameProblem('x'.repeat(61), spaces)).toMatch(/60 characters/);
    expect(workspaceNameProblem('support', spaces)).toMatch(/already a workspace/);
    expect(workspaceNameProblem('Support', spaces, 'a')).toBe('');
    expect(renamedWorkspace(spaces, 'b', ' Growth ')[1].name).toBe('Growth');
  });

  it('deleting a workspace moves its agents to the first one left; the last one can’t be deleted', () => {
    const spaces = [ws('a'), ws('b'), ws('c')];
    const result = withoutWorkspace(spaces, { one: 'a', two: 'b', three: 'c' }, 'a');
    expect(result?.spaces.map((s) => s.id)).toEqual(['b', 'c']);
    expect(result?.movedTo.id).toBe('b');
    expect(result?.owners).toEqual({ one: 'b', two: 'b', three: 'c' });
    expect(withoutWorkspace([ws('a')], {}, 'a')).toBeNull();
    expect(withoutWorkspace(spaces, {}, 'nope')).toBeNull();
  });

  it('what is read from storage is checked: junk and repeats are dropped', () => {
    expect(parseWorkspaces([{ id: 'a', name: ' A ' }, { id: 'a', name: 'again' }, { id: '', name: 'x' }, { id: 'b' }, 7, null])).toEqual([{ id: 'a', name: 'A', createdAt: '' }]);
    expect(parseWorkspaces('nope')).toEqual([]);
  });
});

describe('workspaces, kept in this browser', () => {
  const data = new Map<string, string>();
  beforeAll(() => vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }));
  afterAll(() => vi.unstubAllGlobals());

  it('the first workspace is made when there is none; create opens the new one; an agent can be moved; delete moves it back', async () => {
    const m = await import('./workspaces');
    const [first] = m.ensureWorkspaces();
    expect(first.name).toBe('My workspace');
    expect(m.currentWorkspaceId()).toBe(first.id);
    const sales = m.createWorkspace('Sales');
    expect(m.currentWorkspaceId()).toBe(sales.id);
    expect(() => m.createWorkspace('sales')).toThrow(/already a workspace/);
    m.assignAgent('acme', sales.id);
    expect(m.ownerOf('acme')).toBe(sales.id);
    expect(JSON.parse(data.get('weave_agent_workspaces') ?? '{}')).toEqual({ acme: sales.id });
    m.renameWorkspace(sales.id, 'Growth');
    expect(m.workspacesStore.get().find((s) => s.id === sales.id)?.name).toBe('Growth');
    expect(m.deleteWorkspace(sales.id)?.id).toBe(first.id);
    expect(m.ownerOf('acme')).toBe(first.id);
    expect(m.currentWorkspaceId()).toBe(first.id);
    expect(m.deleteWorkspace(first.id)).toBeNull();
  });
});
