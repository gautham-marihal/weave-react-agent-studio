import { describe, expect, it } from 'vitest';
import type { AgentConfig } from '../types/studio';
import {
  actionWords,
  addConnection,
  addDelivery,
  addField,
  addForm,
  addNotification,
  addTransfer,
  authFor,
  extraInWords,
  headersFrom,
  idProblem,
  moveField,
  notifiersOf,
  problemsUnder,
  recipientsFrom,
  recipientsText,
  removeConnection,
  removeDelivery,
  removeField,
  removeForm,
  removeTransfer,
  secretNameProblem,
  setConnection,
  setDelivery,
  setField,
  setTransfer,
  targetKind,
  transfersInWords,
  usedBy,
} from './toolsExtras';

const base = (): AgentConfig => ({
  telephony: { transfers: [{ id: 'human_support', method: 'sip_refer', target: '' }] },
  connections: {
    billing_api: { type: 'http', base_url: 'https://api.acme.example', auth: { type: 'bearer', token: { secret: 'BILLING_API_TOKEN' } } },
    sms: { type: 'notifier', kind: 'sms', provider: 'twilio' },
  },
  tools: [
    { id: 'escalate', type: 'builtin', builtin: 'transfer_or_callback', params: { transfer: 'human_support' } },
    { id: 'get_bill', type: 'http', connection: 'billing_api' },
    { id: 'verify', type: 'task', task: 'verify_customer' },
  ],
  notifications: [{ id: 'ticket_sms', deliver: [{ via: 'sms', to: '{{state.caller_phone}}', body: 'Ticket made.' }] }],
  tasks: [{ id: 'verify_customer', kind: 'verification', steps: [{ id: 'a', ask: 'Ask.' }] }],
});

describe('the extras in words', () => {
  it('says where transfers go, or that a number is still missing', () => {
    expect(transfersInWords(base())).toBe('1 transfer with no number yet: callers are offered a callback');
    const set = setTransfer(base(), 0, { target: '+441234567890' });
    expect(transfersInWords(set)).toBe('Passes calls to +441234567890');
    const lookup = setTransfer(base(), 0, { target: { lookup: { state: 'intent', map: {} } } });
    expect(transfersInWords(lookup)).toBe('Passes calls to a number chosen during the call');
    expect(transfersInWords({})).toMatch(/^None yet/);
  });

  it('names connections by host, forms by title, and counts messages and tasks', () => {
    expect(extraInWords(base(), 'connections')).toBe('2 connections: api.acme.example, Sms');
    expect(extraInWords({ forms: [{ id: 'callback', title: 'Request a callback' }] }, 'forms')).toBe('1 form: Request a callback');
    expect(extraInWords(base(), 'notifications')).toBe('1 message it can text or email');
    expect(extraInWords(base(), 'tasks')).toBe('1 task: Verify customer');
    expect(extraInWords({}, 'forms')).toMatch(/^None yet/);
  });

  it('counts the server’s problems under each kind and item', () => {
    const errors = [{ path: ['telephony', 'transfers', 0, 'target'] }, { path: ['forms', 1, 'fields'] }, { path: null }, { path: ['tools', 0] }];
    expect(problemsUnder(errors, 'telephony')).toBe(1);
    expect(problemsUnder(errors, 'telephony', 0)).toBe(1);
    expect(problemsUnder(errors, 'forms', 0)).toBe(0);
    expect(problemsUnder(errors, 'forms', 1)).toBe(1);
    expect(problemsUnder(undefined, 'tasks')).toBe(0);
  });

  it('finds what uses each item', () => {
    expect(usedBy(base(), 'telephony', 'human_support')).toEqual(['the tool “escalate”']);
    expect(usedBy(base(), 'connections', 'billing_api')).toEqual(['the tool “get_bill”']);
    expect(usedBy(base(), 'connections', 'sms')).toEqual(['the message “ticket_sms”']);
    expect(usedBy(base(), 'tasks', 'verify_customer')).toEqual(['the tool “verify”']);
    expect(usedBy(base(), 'forms', 'nothing')).toEqual([]);
    expect(usedBy(null, 'forms', 'x')).toEqual([]);
  });

  it('says actions in a few words', () => {
    expect(actionWords({ type: 'say', text: { message: 'outside_hours' } })).toBe('Says the fixed line “outside_hours”');
    expect(actionWords({ type: 'http', connection: 'billing_api', method: 'POST', path: '/calls' }, base())).toBe('Calls POST /calls on api.acme.example');
    expect(actionWords(null)).toBe('Does something');
  });
});

describe('transfers', () => {
  it('adds one with a free id and an empty number, switches method keeping what applies, and removes it', () => {
    const { config, index } = addTransfer(base());
    expect(index).toBe(1);
    expect(config.telephony?.transfers[1]).toEqual({ id: 'transfer', method: 'sip_refer', target: '' });
    const http = setTransfer(config, 1, { method: 'http_request' });
    expect(http.telephony?.transfers[1]).toEqual({ id: 'transfer', method: 'http_request', request: { connection: '', method: 'POST', path: '/' } });
    const back = setTransfer(http, 1, { method: 'sip_refer' });
    expect(back.telephony?.transfers[1]).toEqual({ id: 'transfer', method: 'sip_refer', target: '' });
    expect(removeTransfer(removeTransfer(config, 1), 0).telephony).toBeUndefined();
    expect(addTransfer({}).config.telephony?.transfers[0].id).toBe('human_support');
  });
  it('tells the kinds of target apart', () => {
    expect(targetKind('+44')).toBe('number');
    expect(targetKind({ secret: 'X' })).toBe('secret');
    expect(targetKind({ lookup: { state: 's', map: {} } })).toBe('lookup');
  });
});

describe('connections', () => {
  it('adds each type with what the schema needs, edits and removes', () => {
    const { config, id } = addConnection(base(), 'http');
    expect(id).toBe('web_service');
    expect(config.connections?.web_service).toEqual({ type: 'http', base_url: '' });
    const set = setConnection(config, id, { base_url: 'https://x.example', timeout_s: 5 });
    expect(set.connections?.web_service).toEqual({ type: 'http', base_url: 'https://x.example', timeout_s: 5 });
    expect(setConnection(set, id, { timeout_s: undefined, base_url: '' }).connections?.web_service).toEqual({ type: 'http', base_url: '' });
    expect(addConnection({}, 'notifier').config.connections?.sender).toEqual({ type: 'notifier', kind: 'sms', provider: '' });
    expect(removeConnection(removeConnection(base(), 'sms'), 'billing_api').connections).toBeUndefined();
  });

  it('signs in with secret names only', () => {
    expect(authFor('none', undefined)).toBeUndefined();
    expect(authFor('bearer', { type: 'basic' })).toEqual({ type: 'bearer', token: { secret: '' } });
    expect(authFor('api_key', { type: 'bearer', key: { secret: 'K' } })).toEqual({ type: 'api_key', key: { secret: 'K' }, header: 'X-Api-Key' });
    expect(secretNameProblem('BILLING_TOKEN')).toBe('');
    expect(secretNameProblem('')).toBe('');
    expect(secretNameProblem('sk-live-123')).toMatch(/never its value/);
    expect(headersFrom([['X-A', '1'], ['', 'dropped']])).toEqual({ 'X-A': '1' });
    expect(headersFrom([])).toBeUndefined();
  });

  it('checks ids', () => {
    expect(idProblem('ok_id', [])).toBe('');
    expect(idProblem('Bad', [])).toMatch(/lowercase/);
    expect(idProblem('sms', ['sms'])).toMatch(/already used/);
    expect(idProblem('', [])).toMatch(/needs an id/);
  });
});

describe('forms', () => {
  it('adds a form with a field, edits, moves and removes fields; the last field stays', () => {
    let { config } = addForm({});
    expect(config.forms?.[0]).toMatchObject({ id: 'contact_details', title: 'Your details', fields: [{ name: 'name', type: 'text', required: true }] });
    config = addField(config, 0);
    expect(config.forms?.[0].fields[1]).toEqual({ name: 'field', label: 'New field', type: 'text' });
    config = setField(config, 0, 1, { type: 'select' });
    expect(config.forms?.[0].fields[1].options).toEqual(['Yes', 'No']);
    config = setField(config, 0, 1, { type: 'email', required: false });
    expect(config.forms?.[0].fields[1]).toEqual({ name: 'field', label: 'New field', type: 'email' });
    config = moveField(config, 0, 1, 0);
    expect(config.forms?.[0].fields.map((f: { name: string }) => f.name)).toEqual(['field', 'name']);
    config = removeField(removeField(config, 0, 0), 0, 0);
    expect(config.forms?.[0].fields).toHaveLength(1);
    expect(removeForm(config, 0).forms).toBeUndefined();
  });
});

describe('messages it sends', () => {
  it('adds a message sent by the first sender, edits who it goes to, and keeps one way of sending', () => {
    expect(notifiersOf(base())).toEqual([{ id: 'sms', kind: 'sms', provider: 'twilio' }]);
    const made = addNotification(base());
    const index = made.index;
    let config = made.config;
    expect(config.notifications?.[index]).toEqual({ id: 'message', deliver: [{ via: 'sms', to: ['{{state.caller_phone}}'], body: '' }] });
    config = setDelivery(config, index, 0, { to: recipientsFrom('a@x.example, b@x.example'), body: 'Hello' });
    expect(recipientsText(config.notifications?.[index].deliver[0].to)).toBe('a@x.example, b@x.example');
    config = addDelivery(config, index);
    expect(config.notifications?.[index].deliver).toHaveLength(2);
    config = removeDelivery(removeDelivery(config, index, 1), index, 0);
    expect(config.notifications?.[index].deliver).toHaveLength(1);
    expect(recipientsText({ lookup: {} })).toBeNull();
    expect(recipientsFrom(' ')).toEqual(['']);
  });
});
