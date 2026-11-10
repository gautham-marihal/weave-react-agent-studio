// Where the mock keeps what calls create (applications, hand-overs, cases, e-mails, new bank customers, balances that
// moved…): with BLOB_READ_WRITE_TOKEN set (on Vercel: the private Blob store weave-mock-unbound), in that store, so every
// copy of the function sees the same records; without it (this machine, the unit tests), in memory.
// One store for the Unbound routes (unbound.mjs) and the OCBC banking routes (ocbc.mjs): put / get / newest, by kind.

const memoryStore = () => {
  const kinds = new Map();
  const of = (kind) => kinds.get(kind) || kinds.set(kind, new Map()).get(kind);
  return {
    put: async (kind, id, value) => void of(kind).set(id, structuredClone(value)),
    get: async (kind, id) => (of(kind).has(id) ? structuredClone(of(kind).get(id)) : null),
    newest: async (kind, limit) =>
      [...of(kind).values()]
        .reverse()
        .slice(0, limit)
        .map((v) => structuredClone(v)),
    clear: () => kinds.clear(),
  };
};
const blobStore = () => {
  let lib;
  const blob = async () => (lib ??= await import('@vercel/blob'));
  const path = (kind, id) => `unbound/${kind}/${id}.json`;
  const read = async (pathname) => {
    const { get } = await blob();
    const found = await get(pathname, { access: 'private', useCache: false }).catch((err) => (err?.name === 'BlobNotFoundError' ? null : Promise.reject(err)));
    return found?.stream ? JSON.parse(await new Response(found.stream).text()) : null;
  };
  return {
    put: async (kind, id, value) => {
      const { put } = await blob();
      await put(path(kind, id), JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    },
    get: async (kind, id) => read(path(kind, id)),
    newest: async (kind, limit) => {
      const { list } = await blob();
      const { blobs } = await list({ prefix: `unbound/${kind}/`, limit: 1000 });
      const recent = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(0, limit);
      return (await Promise.all(recent.map((b) => read(b.pathname)))).filter(Boolean);
    },
    clear: () => {},
  };
};

export const store = process.env.BLOB_READ_WRITE_TOKEN ? blobStore() : memoryStore();
// a name that sorts by time, for the kinds read newest first
export const timeKey = (iso, id) => `${iso.replace(/\D/g, '')}-${id}`;
