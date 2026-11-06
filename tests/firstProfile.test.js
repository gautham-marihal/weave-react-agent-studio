import test from 'node:test';
import assert from 'node:assert/strict';
import { firstProfile } from '../src/pages/firstProfile.js';

// Signing in goes straight to the workspace: the first time, the name and the workspace come from the email.
test('the first-time details come from the email: the name from before the @, the workspace from the company domain', () => {
  assert.deepEqual(firstProfile('demo_weave@tetherfi.com'), { fullName: 'Demo Weave', workspaceName: 'Tetherfi', email: 'demo_weave@tetherfi.com' });
  assert.deepEqual(firstProfile(' alex.morgan@mail.acme.co.uk '), { fullName: 'Alex Morgan', workspaceName: 'Acme', email: 'alex.morgan@mail.acme.co.uk' });
  assert.equal(firstProfile('e2e@example.com').fullName, 'E2e');
  assert.equal(firstProfile('1234@x').fullName, 'Workspace user', 'no letters: a plain name');
  assert.equal(firstProfile('a@').workspaceName, 'My workspace', 'no domain: a plain workspace name');
});
