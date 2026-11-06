import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetState } from '../mock-api/src/app.mjs';

// Tetherfi Unbound, use case 1: the stand-ins around the two bots (mock-api/src/unbound.mjs). The onboarding bot asks
// for offers, saves the application, runs the stand-in face check and hands the customer to MX; the human agent's
// desktop completes the hand-over; the case-desk bot reads the hand-back and opens a TQD case, which "e-mails" the customer.

const call = async (method, path, body = {}, query = {}) => handle({ method, path, body, query, headers: {} });

test('use case 1, end to end through the stand-ins: offers → application → face check → MX → human → hand-back → TQD case and e-mail', async () => {
  resetState();
  const offers = (await call('GET', '/unbound/offers', {}, { amount: '500,000,000', currency: 'sgd' })).body;
  assert.equal(offers.amount, 'SGD 500,000,000');
  assert.deepEqual(
    offers.offers.map((o) => o.id),
    ['private_wealth', 'inheritance_holding', 'deposit_ladder'],
  );
  assert.equal((await call('GET', '/unbound/offers', {}, { amount: '200000' })).body.offers.length, 1, 'a smaller amount gets only what it qualifies for');
  assert.match(offers.requirements, /grant of probate/, 'a deposit this size needs proof of where the money comes from');
  assert.equal((await call('GET', '/unbound/offers', {}, { amount: '200000' })).body.requirements, undefined);

  assert.equal((await call('POST', '/unbound/applications', { first_name: 'Tan' })).status, 400);
  const app = (
    await call('POST', '/unbound/applications', {
      first_name: 'Tan',
      last_name: 'Wei Ming',
      date_of_birth: '14/03/1985',
      email: 'weiming.tan@example.com',
      mobile: '+6591234567',
      id_number: 'S8512345D',
      amount: '500000000',
      currency: 'SGD',
      source_of_funds: 'Inheritance',
      pep: 'No',
    })
  ).body;
  assert.match(app.application_id, /^APP-/);
  assert.equal(app.risk, 'enhanced_due_diligence', 'SGD 500 million needs enhanced due diligence');
  assert.equal(app.proof_needed, 'the grant of probate or letters of administration');
  const small = (
    await call('POST', '/unbound/applications', {
      first_name: 'A',
      last_name: 'B',
      date_of_birth: '01/01/1990',
      email: 'a@example.com',
      mobile: '+6590000000',
      id_number: 'X1',
      amount: '20000',
      pep: 'No',
    })
  ).body;
  assert.equal(small.risk, 'standard');
  assert.equal(
    (
      await call('POST', '/unbound/applications', {
        first_name: 'A',
        last_name: 'B',
        date_of_birth: '01/01/1990',
        email: 'a@example.com',
        mobile: '+6590000000',
        id_number: 'X1',
        amount: '20000',
        pep: 'Yes',
      })
    ).body.risk,
    'enhanced_due_diligence',
    'a politically exposed person always does',
  );
  // a verified customer: the AI opens the account itself once a plan is chosen and the application signed
  assert.equal((await call('POST', '/unbound/accounts', { application_id: app.application_id, plan_name: 'Gold' })).status, 400, 'an unknown plan');
  assert.equal(
    (await call('POST', '/unbound/accounts', { application_id: app.application_id, plan_name: 'Private Wealth Account' })).status,
    400,
    'not signed',
  );
  const opened = (await call('POST', '/unbound/accounts', { application_id: app.application_id, plan_name: 'Private Wealth Account', signed: 'true' })).body;
  assert.equal(opened.relationship_manager, 'Daniel Lim');
  assert.equal(opened.proof_needed, 'the grant of probate or letters of administration', 'the due diligence carries over from the application');
  assert.match(opened.account_last4, /^\d{4}$/);
  assert.match((await call('POST', '/unbound/callbacks', { mobile: '+65 9123 4567' })).body.reference, /^CB-/);
  assert.equal((await call('POST', '/unbound/callbacks', { mobile: 'none' })).status, 400);

  const face = (await call('POST', '/unbound/verify/face', { application_id: app.application_id })).body;
  assert.equal(face.face_match, 'passed');
  assert.equal(face.deepfake, 'not_detected');
  assert.equal(face.provider, 'stand-in');
  assert.equal((await call('POST', '/unbound/verify/face', { simulate: 'deepfake' })).body.deepfake, 'detected');
  const tagged = (
    await call('POST', '/unbound/applications', {
      first_name: 'A',
      last_name: 'B',
      date_of_birth: '01/01/1990',
      email: 'a+deepfake@example.com',
      mobile: '+6590000000',
      id_number: 'X1',
    })
  ).body;
  assert.equal(
    (await call('POST', '/unbound/verify/face', { application_id: tagged.application_id })).body.deepfake,
    'detected',
    'a demo asks for a failure through the e-mail',
  );
  assert.equal(
    (await call('POST', '/unbound/verify/face', { application_id: 'APP-UNKNOWN', email: 'b+nomatch@example.com' })).body.face_match,
    'failed',
    'the e-mail sent with the request is enough',
  );

  const ho = (
    await call('POST', '/mx/handovers', {
      application_id: app.application_id,
      reason: 'name_mismatch',
      differences: 'first name, last name',
      customer: { first_name: 'Tan', last_name: 'Wei Ming', email: 'weiming.tan@example.com', mobile: '+6591234567' },
    })
  ).body;
  assert.equal(ho.status, 'queued');
  assert.deepEqual((await call('GET', `/mx/handovers/${ho.handover_id}`)).body.differences, ['first name', 'last name']);
  assert.equal(
    (await call('GET', '/mx/handovers', {}, { status: 'queued' })).body.handovers[0].handover_id,
    ho.handover_id,
    'the agent desktop sees it in the queue',
  );

  // before any human finishes, the hand-back says it is the demo default
  assert.equal((await call('GET', '/mx/handbacks/latest')).body.source, 'demo_default');
  assert.equal((await call('POST', `/mx/handovers/${ho.handover_id}/complete`, { plan_id: 'private_wealth' })).status, 400, 'not signed yet');
  assert.equal((await call('POST', `/mx/handovers/${ho.handover_id}/complete`, { plan_id: 'gold', signed: true })).status, 400, 'an unknown plan');
  const done = (
    await call('POST', `/mx/handovers/${ho.handover_id}/complete`, {
      plan_id: 'private_wealth',
      signed: true,
      first_name: 'Wei Ming',
      last_name: 'Tan',
    })
  ).body;
  assert.equal(done.status, 'returned_to_ai');

  const back = (await call('GET', '/mx/handbacks/latest')).body;
  assert.equal(back.source, 'mx');
  assert.equal(back.customer_name, 'Wei Ming Tan', 'the names as the human agent corrected them');
  assert.equal(back.first_name, 'Wei Ming');
  assert.equal(back.plan_name, 'Private Wealth Account');
  assert.equal(back.relationship_manager, 'Daniel Lim');
  assert.equal(back.risk, 'enhanced_due_diligence', 'the risk travels from the application to the hand-back');
  assert.equal(back.proof_needed, 'the grant of probate or letters of administration');

  assert.equal((await call('POST', '/tqd/cases', { email: 'nope' })).status, 400);
  assert.equal(
    (await call('POST', '/tqd/cases', { email: 'a@example.com' })).body.email_subject,
    'Welcome to Unbound Bank: your new account is open',
    'no plan named',
  );
  const tqd = (
    await call('POST', '/tqd/cases', {
      handover_id: back.handover_id,
      customer_name: back.customer_name,
      email: back.email,
      account_number: back.account_number,
      plan_name: back.plan_name,
      relationship_manager: back.relationship_manager,
      proof_needed: back.proof_needed,
    })
  ).body;
  assert.match(tqd.case_id, /^TQD-/);
  const mail = (await call('GET', '/tqd/outbox')).body.emails[0];
  assert.equal(mail.to, 'weiming.tan@example.com');
  assert.match(mail.body, new RegExp(tqd.case_id));
  assert.match(mail.body, /ending \d{4}\./);
  assert.match(mail.body, /Daniel Lim, your relationship manager, will call you within one working day/);
  assert.match(mail.body, /2\. Before the deposit is credited, please have the grant of probate/);
  assert.ok(!JSON.stringify((await call('GET', `/mx/handovers/${ho.handover_id}`)).body).includes('S8512345D'), 'the id number is never kept whole');
});
