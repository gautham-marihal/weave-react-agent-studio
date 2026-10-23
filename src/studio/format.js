// "agents.items[0].tools[2]" from ["agents", "items", 0, "tools", 2]
export function formatPath(path) {
  if (!Array.isArray(path) || !path.length) return '';
  return path.reduce((out, part) => (typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${part}` : String(part)), '');
}

// Diff paths address items of id-lists as "id=billing"; show them as [billing].
export function formatDiffPath(path) {
  if (!Array.isArray(path) || !path.length) return '(whole config)';
  return path.reduce((out, part) => {
    const text = String(part);
    const item = /^[a-z_]+=(.+)$/.exec(text);
    if (item) return `${out}[${item[1]}]`;
    return typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${text}` : text;
  }, '');
}

// When something happened, the same way on every page: "just now", "5 min ago", "3 hours ago", "4 days ago", then the date ("Oct 22", with the year
// when it is another year's). `days` is how far back it still counts days.
export function formatWhen(iso, { days = 30, nowMs = Date.now() } = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  const then = date.getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((nowMs - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  const hours = Math.round(seconds / 3600);
  if (seconds < 86400) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const ago = Math.round(seconds / 86400);
  if (ago < days) return `${ago} day${ago === 1 ? '' : 's'} ago`;
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);

export const BOT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
// The folders the runtime writes call data to: the API answers 400 for an agent with one of these ids.
export const RESERVED_BOT_IDS = ['transcripts', 'metrics', 'logs', 'sessions', 'tmp'];

// The id a new agent gets from its name when nobody typed one: the name in id form ('agent' when nothing of the name can be used, as with a name in
// another script), made free with -2, -3... when it is taken or reserved. So a person only ever gives a name, and never meets an id problem.
export function freeBotId(name, existing = []) {
  const base = slugify(name) || 'agent';
  const taken = (id) => existing.includes(id) || RESERVED_BOT_IDS.includes(id);
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!taken(id)) return id;
  }
  return base;
}

// What is wrong with an id typed for a new agent ('' when nothing is). `existing` are the ids already taken.
export function botIdProblem(id, existing = []) {
  if (!id) return '';
  if (!BOT_ID_PATTERN.test(id)) return 'Start with a lowercase letter, then use lowercase letters, digits, - or _ (up to 64 characters).';
  if (RESERVED_BOT_IDS.includes(id)) return `“${id}” is reserved: the runtime writes its call data to a folder of that name. Choose another id.`;
  if (existing.includes(id)) return 'An agent with this id already exists.';
  return '';
}

export const prettyJson = (value) => JSON.stringify(value, null, 2);

export function truncate(text, max = 400) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Next semantic version: bump is 'major' | 'minor' | 'patch'.
export function nextVersion(version, bump) {
  const parts = String(version || '0.1.0')
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (bump === 'major') return `${parts[0] + 1}.0.0`;
  if (bump === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
export const isSemver = (value) => SEMVER.test(String(value || ''));

// -1, 0 or 1. Compares numerically, so 1.10.0 is newer than 1.9.0.
export function compareVersions(a, b) {
  const pa = String(a || '0.0.0')
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0);
  const pb = String(b || '0.0.0')
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

const BUMP_HINTS = { patch: 'Fixes and small tweaks', minor: 'New features, nothing breaks', major: 'Changes that break existing behaviour' };

// What the Publish dialog offers. A bump is counted from the latest published version (the server refuses one
// until something has been published). The draft's own number is offered only when it is a different number
// from every bump and is newer than the latest: the server won't publish a number that already exists, so a
// draft that is behind is shown switched off, with the reason. A bump that lands on the draft's number says so
// instead of appearing twice.
export function publishOptions(latestVersion, draftVersion) {
  const draftOk = isSemver(draftVersion);
  if (!latestVersion) {
    return { options: [{ value: 'draft', label: 'Draft version', version: draftVersion, hint: 'The first version of this agent' }], defaultChoice: 'draft' };
  }
  const bumps = ['patch', 'minor', 'major'].map((kind) => ({
    value: kind,
    label: kind[0].toUpperCase() + kind.slice(1),
    version: nextVersion(latestVersion, kind),
    hint: BUMP_HINTS[kind],
  }));
  const draftIsNewer = draftOk && compareVersions(draftVersion, latestVersion) > 0;
  const match = draftOk ? bumps.find((option) => option.version === draftVersion) : null;
  if (match) match.matchesDraft = true;
  const options = [...bumps];
  if (!match) {
    options.unshift({
      value: 'draft',
      label: 'Use the draft’s version',
      version: draftOk ? draftVersion : '—',
      hint: draftIsNewer
        ? 'The number already in the draft'
        : draftOk
          ? `Not newer than ${latestVersion}, so it can’t be published`
          : 'The draft has no valid version number',
      disabled: !draftIsNewer,
    });
  }
  const defaultChoice = match ? match.value : draftIsNewer ? 'draft' : 'patch';
  return { options, defaultChoice };
}

const ENV_RANK = (env) => (/prod/i.test(env) ? 3 : /stag|uat|qa|pre/i.test(env) ? 2 : /dev/i.test(env) ? 1 : 0);

// The one stage an agent is in right now: the furthest environment it is deployed to, else published, else draft.
export function currentStage(bot) {
  const deployed = Object.entries(bot?.deployed || {}).sort((a, b) => ENV_RANK(b[0]) - ENV_RANK(a[0]));
  if (deployed.length) {
    const [env, version] = deployed[0];
    return { kind: 'env', env, version, also: deployed.slice(1).map(([name]) => name) };
  }
  if (bot?.latest_version) return { kind: 'published', version: bot.latest_version };
  return { kind: 'draft' };
}
