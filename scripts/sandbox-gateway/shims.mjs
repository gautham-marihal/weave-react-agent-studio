// Browser stand-ins for the few Node pieces the banking gateway uses, so its own code (state machine, tools, server
// routes, mock bank) can run inside Studio in Sandbox. Used only by scripts/build-sandbox-gateway.mjs; never by the
// gateway service itself. Kept small and synchronous, as the Node originals are.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---- base64url --------------------------------------------------------------------------------------------------

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// ---- Buffer (only what the gateway uses: from, concat, length, toString) -------------------------------------------

export class Buffer extends Uint8Array {
  static from(input, encoding) {
    if (typeof input === 'string') {
      const bytes = encoding === 'base64url' || encoding === 'base64' ? fromBase64Url(input) : encoder.encode(input);
      return Buffer.wrap(bytes);
    }
    return Buffer.wrap(new Uint8Array(input));
  }
  static wrap(bytes) {
    const out = new Buffer(bytes.length);
    out.set(bytes);
    return out;
  }
  static concat(list) {
    const total = list.reduce((n, b) => n + b.length, 0);
    const out = new Buffer(total);
    let at = 0;
    for (const b of list) {
      out.set(b, at);
      at += b.length;
    }
    return out;
  }
  toString(encoding) {
    if (encoding === 'base64url') return toBase64Url(this);
    if (encoding === 'base64') return toBase64(this);
    if (encoding === 'hex') return toHex(this);
    return decoder.decode(this);
  }
}

// ---- SHA-256 and HMAC (synchronous, as node:crypto's are) ----------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Bytes(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((v, i) => outView.setUint32(i * 4, v));
  return out;
}

function hmacSha256(key, message) {
  let k = typeof key === 'string' ? encoder.encode(key) : key;
  if (k.length > 64) k = sha256Bytes(k);
  const block = new Uint8Array(64);
  block.set(k);
  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  const msg = typeof message === 'string' ? encoder.encode(message) : message;
  const innerHash = sha256Bytes(concatBytes(inner, msg));
  return sha256Bytes(concatBytes(outer, innerHash));
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function digestAs(bytes, encoding) {
  return encoding ? Buffer.wrap(bytes).toString(encoding) : Buffer.wrap(bytes);
}

// ---- node:crypto ---------------------------------------------------------------------------------------------------

export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error(`Only sha256 in the browser gateway, not ${algorithm}`);
  let text = '';
  return {
    update(part) {
      text += part;
      return this;
    },
    digest: (encoding) => digestAs(sha256Bytes(text), encoding),
  };
}

export function createHmac(algorithm, key) {
  if (algorithm !== 'sha256') throw new Error(`Only sha256 in the browser gateway, not ${algorithm}`);
  let text = '';
  return {
    update(part) {
      text += part;
      return this;
    },
    digest: (encoding) => digestAs(hmacSha256(key, text), encoding),
  };
}

export function randomBytes(n) {
  const out = new Buffer(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export const randomUUID = () => globalThis.crypto.randomUUID();

export function randomInt(min, max) {
  const span = max - min;
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return min + (buf[0] % span);
}

/** The mock bank stores PINs hashed; in the browser a salted SHA-256 stands in for scrypt (same inputs, same check). */
export const scryptSync = (value, salt, length) => Buffer.wrap(sha256Bytes(`${salt}:${value}`).slice(0, length));

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---- timers: Node's have unref(); the gateway calls it so its sweeper never keeps a process alive ------------------

export function setInterval(fn, ms) {
  const id = globalThis.setInterval(fn, ms);
  return { id, unref() {}, ref() {}, [Symbol.toPrimitive]: () => id };
}
export function clearInterval(handle) {
  globalThis.clearInterval(typeof handle === 'object' && handle ? handle.id : handle);
}
