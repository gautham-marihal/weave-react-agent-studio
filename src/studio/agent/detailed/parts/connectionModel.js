// Connections in plain words, without any screen: the kinds and sign-in ways a person chooses between, whether a
// connection is ready, the line that says what it is, and the guided Add's answers turned into the saved config
// ({ type: 'http', base_url, auth, headers, timeout_s } | { type: 'mcp', url, transport, auth } |
// { type: 'notifier', kind, provider, from, auth }). Pure: no React, no DOM.

import { ID_PATTERN } from '../../../form/references.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const CONNECTION_KINDS = [
  {
    value: 'http',
    label: 'Web API',
    icon: 'globe',
    blurb: 'A web service its tools call, for example to look up an account or save an application.',
  },
  {
    value: 'mcp',
    label: 'MCP server',
    icon: 'webhook',
    blurb: 'A server that offers ready-made tools to the agent over the Model Context Protocol.',
  },
  {
    value: 'notifier',
    label: 'SMS or email sender',
    icon: 'mail',
    blurb: 'A service that sends texts or emails for the agent, such as Twilio, SendGrid or Microsoft 365.',
  },
];
export const kindOf = (value) => CONNECTION_KINDS.find((k) => k.value === value) || CONNECTION_KINDS[0];

// the ways a Web API or MCP server can be signed in to (the schema's `auth`), in words
export const SIGN_IN = [
  { value: 'none', label: 'No sign-in', blurb: 'The service is open to the agent as it is.' },
  { value: 'bearer', label: 'A token', blurb: 'Sent as “Authorization: Bearer …”, the most common way.' },
  { value: 'api_key', label: 'A key in a header', blurb: 'A key sent in a header the service names, such as X-API-Key.' },
  { value: 'basic', label: 'A username and password', blurb: 'Sent the classic way (basic sign-in).' },
];
export const NOTIFIER_SERVICES = ['twilio', 'sendgrid', 'microsoft_graph'];

const addressKey = (type) => (type === 'mcp' ? 'url' : type === 'http' ? 'base_url' : null);
export const SECRET = /^[A-Z][A-Z0-9_]*$/;
const secretName = (ref) => (isObj(ref) && typeof ref.secret === 'string' ? ref.secret : '');
// typed words as a secret's name: capitals, digits and _ (what the server's vault accepts)
export const asSecret = (text) => text.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

// "weave-mock-api.vercel.app" from an address, or the address itself when it isn't one
function hostOf(address) {
  try {
    return new URL(address).host || address;
  } catch {
    return address;
  }
}

// What is wrong with an address, in words ('' when it is a web address)
export function addressProblem(address) {
  if (!address || !String(address).trim()) return 'Add the address of the service.';
  let url;
  try {
    url = new URL(address);
  } catch {
    return 'This isn’t a web address. It starts with https://, like https://api.example.com.';
  }
  if (!/^https?:$/.test(url.protocol)) return 'The address starts with https:// (or http://).';
  return '';
}

// The secret names a sign-in uses, and the ones missing or wrongly written
function signInSecrets(auth) {
  if (!isObj(auth)) return [];
  if (auth.type === 'bearer') return [['token', secretName(auth.token)]];
  if (auth.type === 'api_key') return [['key', secretName(auth.key)]];
  if (auth.type === 'basic')
    return [
      ['username', secretName(auth.username)],
      ['password', secretName(auth.password)],
    ];
  if (!auth.type) return Object.entries(auth).map(([name, ref]) => [name, secretName(ref)]);
  return [];
}

// Whether a connection is ready to use, with the first thing to fix: { tone: 'good' | 'warn' | 'bad', words }
export function connectionState(item) {
  if (!isObj(item)) return { tone: 'bad', words: 'Not set up' };
  const key = addressKey(item.type);
  if (key) {
    const problem = addressProblem(item[key]);
    if (problem) return { tone: 'bad', words: item[key] ? 'Address not valid' : 'Needs an address' };
  } else if (item.type === 'notifier' && !String(item.provider || '').trim()) return { tone: 'bad', words: 'Needs a service' };
  if (signInSecrets(item.auth).some(([, name]) => !SECRET.test(name))) return { tone: 'bad', words: 'Sign-in incomplete' };
  if (key && /^http:/i.test(item[key] || '')) return { tone: 'warn', words: 'Not secure (http)' };
  return { tone: 'good', words: 'Ready' };
}

// The line under a connection's name: its kind, where it points, how long it waits, how it signs in
export function metaOf(item) {
  const kind = kindOf(item?.type);
  const parts = [kind.label];
  const key = addressKey(item?.type);
  if (key && item[key]) parts.push(hostOf(item[key]));
  if (item?.type === 'notifier') {
    if (item.kind) parts.push(item.kind === 'sms' ? 'texts' : 'emails');
    if (item.provider) parts.push(`through ${item.provider}`);
  }
  if (item?.type === 'http' && typeof item.timeout_s === 'number') parts.push(`waits up to ${item.timeout_s} s`);
  const auth = isObj(item?.auth) ? item.auth : null;
  const way = auth?.type ? SIGN_IN.find((s) => s.value === auth.type) : null;
  if (way && way.value !== 'none') parts.push(`signs in with ${way.label.replace(/^A /, 'a ')}`);
  else if (auth && !auth.type && Object.keys(auth).length) parts.push('signs in with its credentials');
  return parts.join(' · ');
}

// Every secret name the draft already uses, to offer while typing one
export function secretNamesIn(config) {
  const names = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (isObj(node)) {
      if (typeof node.secret === 'string' && Object.keys(node).length === 1 && SECRET.test(node.secret)) names.add(node.secret);
      else Object.values(node).forEach(visit);
    }
  };
  visit(config);
  return [...names].sort();
}

export const pairsToMap = (rows, wrap = (v) => v) => {
  const out = {};
  rows.forEach((r) => {
    if (r.key.trim() && String(r.value).trim()) out[r.key.trim()] = wrap(r.value);
  });
  return Object.keys(out).length ? out : undefined;
};

// The connection the answers make, exactly as it is saved
export function connectionFrom(a) {
  if (a.type === 'notifier')
    return {
      type: 'notifier',
      ...(a.kind ? { kind: a.kind } : {}),
      provider: a.provider.trim(),
      ...(a.from.trim() ? { from: a.from.trim() } : {}),
      ...(pairsToMap(a.credentials, (v) => ({ secret: v })) ? { auth: pairsToMap(a.credentials, (v) => ({ secret: v })) } : {}),
    };
  const auth =
    a.signIn === 'bearer'
      ? { type: 'bearer', token: { secret: a.token } }
      : a.signIn === 'api_key'
        ? { type: 'api_key', header: a.header.trim(), key: { secret: a.key } }
        : a.signIn === 'basic'
          ? { type: 'basic', username: { secret: a.username }, password: { secret: a.password } }
          : null;
  if (a.type === 'mcp') return { type: 'mcp', url: a.address.trim(), ...(a.transport ? { transport: a.transport } : {}), ...(auth ? { auth } : {}) };
  const timeout = Number(a.timeout);
  return {
    type: 'http',
    base_url: a.address.trim(),
    ...(auth ? { auth } : {}),
    ...(pairsToMap(a.headers) ? { headers: pairsToMap(a.headers) } : {}),
    ...(a.timeout !== '' && timeout > 0 ? { timeout_s: timeout } : {}),
  };
}

// What is wrong on a step, by field ({} when it can go on)
export function stepProblems(step, a, taken) {
  const out = {};
  if (step === 'service') {
    if (!a.name) out.name = 'Give it a name.';
    else if (!new RegExp(ID_PATTERN).test(a.name)) out.name = 'Use lowercase letters, digits, _ or -, starting with a letter.';
    else if (taken.includes(a.name)) out.name = 'Another connection already has this name.';
    if (a.type === 'notifier' && !a.provider.trim()) out.provider = 'Say which service sends the messages.';
  }
  if (step === 'address' && a.type !== 'notifier') {
    const problem = addressProblem(a.address);
    if (problem) out.address = problem;
  }
  if (step === 'signin' && a.type !== 'notifier') {
    const need = { bearer: ['token'], api_key: ['header', 'key'], basic: ['username', 'password'] }[a.signIn] || [];
    need.forEach((field) => {
      if (field === 'header') {
        if (!a.header.trim()) out.header = 'Name the header the key goes in, such as X-API-Key.';
      } else if (!SECRET.test(a[field])) out[field] = 'Name the secret: capitals, digits and _, starting with a letter.';
    });
  }
  if (step === 'signin' && a.type === 'notifier') {
    a.credentials.forEach((r, i) => {
      if ((r.key.trim() || r.value) && (!r.key.trim() || !SECRET.test(r.value))) out[`cred${i}`] = 'Each credential needs a name and a secret’s name.';
    });
  }
  return out;
}
