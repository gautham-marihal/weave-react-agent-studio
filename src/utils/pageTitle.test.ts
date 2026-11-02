import { describe, expect, it } from 'vitest';
import { agentPageLabel, pageTitle, readableSegment } from './pageTitle';

const agents = [
  { id: 'acme-support', name: 'Acme Support' },
  { id: 'billing', name: 'Billing' },
];

describe('the browser tab title', () => {
  it('names the page, then the agent, then the studio, so tabs can be told apart', () => {
    expect(pageTitle({ pathname: '/agents/acme-support/build/tools', agents })).toBe('Tools · Acme Support · Weave Studio');
    expect(pageTitle({ pathname: '/agents/acme-support/build/aftercall', agents })).toBe('After the call · Acme Support · Weave Studio');
    expect(pageTitle({ pathname: '/agents/acme-support', agents })).toBe('Overview · Acme Support · Weave Studio');
    expect(pageTitle({ pathname: '/agents/billing/release', agents })).toBe('Release · Billing · Weave Studio');
    expect(pageTitle({ pathname: '/agents/billing/setup/purpose', agents })).toBe('Setup · Billing · Weave Studio');
  });

  it('says an agent is not found only once the list is known', () => {
    expect(pageTitle({ pathname: '/agents/nobody/build', agents })).toBe('Agent not found · Weave Studio');
    expect(pageTitle({ pathname: '/agents/nobody/build', agents: null })).toBe('Build · nobody · Weave Studio');
  });

  it('uses the route’s own title, and a readable name for a page that has none', () => {
    expect(pageTitle({ pathname: '/', routeTitle: 'Home', agents })).toBe('Home · Weave Studio');
    expect(pageTitle({ pathname: '/', agents })).toBe('Home · Weave Studio');
    expect(pageTitle({ pathname: '/nowhere', routeTitle: 'Page not found', agents })).toBe('Page not found · Weave Studio');
    expect(pageTitle({ pathname: '/calls', routeTitle: 'Calls', agents })).toBe('Calls · Weave Studio');
    expect(pageTitle({ pathname: '/speed-and-cost', agents })).toBe('Speed and cost · Weave Studio');
  });

  it('reads the parts of an address', () => {
    expect(agentPageLabel('')).toBe('Overview');
    expect(agentPageLabel('build')).toBe('Build');
    expect(agentPageLabel('build/nope')).toBe('Build');
    expect(agentPageLabel('whatever')).toBe('Overview');
    expect(readableSegment('call_detail')).toBe('Call detail');
    expect(readableSegment('%E2%9C%93')).toBe('✓');
  });
});
