// A connection from the Integrations page, the same way for every integration: its address and the headers sent with
// every call. A header can be secret: its value is then the name of a secret kept on the Agent Builder server (never
// the key itself), and an agent's connection carries it as its sign-in (auth api_key), which takes one header; the
// others go in as they are. Pure: no React, no storage.

// a header's name as HTTP allows it (RFC 9110 token); a secret's name as the server keeps it
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
// set by the connection itself, never by hand
const RESERVED = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);
// connections saved before headers: the REST API (id 'crm', its first name) kept one header's value in `second`, under
// this name, and sent this value when none was written
const FIRST_HEADER = { name: 'Region', value: 'DB2' };

const text = (value) => String(value ?? '').trim();

/**
 * A saved connection as { url, headers: [{ name, value, secret }] }. Older ones kept the address in `first`; the REST
 * API (id 'crm') kept its one header in `second`. The others' `second` (a key) never left this browser, so it is not
 * made into a header.
 */
export function connectionParts(saved, id) {
  const url = text(saved?.url ?? saved?.first);
  if (Array.isArray(saved?.headers)) {
    const headers = saved.headers.map((h) => ({ name: text(h?.name), value: text(h?.value), secret: !!h?.secret })).filter((h) => h.name);
    return { url, headers };
  }
  const headers = saved && id === 'crm' ? [{ name: FIRST_HEADER.name, value: text(saved.second) || FIRST_HEADER.value, secret: false }] : [];
  return { url, headers };
}

/** Whether an agent can call it: only a web address can be. */
export const isWebAddress = (url) => /^https?:\/\//i.test(text(url));

/**
 * What is wrong with the header rows as typed, by row index ({ [index]: words }); a row left empty is ignored.
 * Names must be header names, each once, with a value; at most one row is secret, and its value is a secret's name.
 */
export function headerProblems(rows) {
  const problems = {};
  const seen = new Map();
  let secrets = 0;
  (rows || []).forEach((row, index) => {
    const name = text(row?.name);
    const value = text(row?.value);
    if (!name && !value) return;
    const lower = name.toLowerCase();
    if (!name) problems[index] = 'Give this header a name.';
    else if (!TOKEN.test(name)) problems[index] = 'A header name has no spaces, and only letters, digits and - _ . ! # $ % & * + ^ ` | ~';
    else if (RESERVED.has(lower)) problems[index] = `${name} is set by the connection itself.`;
    else if (seen.has(lower)) problems[index] = `${name} is already sent above.`;
    else if (!value) problems[index] = row?.secret ? 'Give the name of the secret.' : 'Give this header a value.';
    else if (row?.secret && !SECRET_NAME.test(value)) problems[index] = 'A secret’s name: letters, digits and _ . - with no spaces, e.g. ORDERS_API_TOKEN.';
    if (name) seen.set(lower, index);
    if (row?.secret) {
      secrets += 1;
      if (secrets > 1) problems[index] = 'One header can be secret: an agent’s connection signs in with one.';
    }
  });
  return problems;
}

/** The rows worth saving: empty ones dropped, words trimmed. */
export const cleanHeaders = (rows) =>
  (rows || []).map((row) => ({ name: text(row?.name), value: text(row?.value), secret: !!row?.secret })).filter((row) => row.name || row.value);

/** The plain (not secret) headers as { name: value }: what can be sent from here, as it is. */
export const plainHeaders = (parts) => Object.fromEntries(parts.headers.filter((h) => !h.secret).map((h) => [h.name, h.value]));

/** The connection as an agent's configuration has it: its address, its plain headers, and the secret one as its sign-in. */
export function agentConnection(parts) {
  const plain = plainHeaders(parts);
  const secret = parts.headers.find((h) => h.secret);
  return {
    type: 'http',
    base_url: parts.url,
    ...(Object.keys(plain).length ? { headers: plain } : {}),
    ...(secret ? { auth: { type: 'api_key', header: secret.name, key: { secret: secret.value } } } : {}),
    timeout_s: 10,
  };
}
