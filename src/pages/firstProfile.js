// The details a person gets the first time they sign in on this browser, made from the email they signed in with, so
// signing in goes straight to the workspace (no "set up your workspace" step). Both can be changed later in the
// account dialog. Pure: no React, no storage.
//   demo_weave@tetherfi.com → { fullName: 'Demo Weave', workspaceName: 'Tetherfi', email }

const words = (text) =>
  String(text || '')
    .split(/[._\-+\s]+/)
    .filter((part) => /[a-z]/i.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());

// the company part of a domain: the label before the last one (tetherfi.com → tetherfi, mail.acme.co.uk → acme)
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
function companyOf(domain) {
  const labels = String(domain || '')
    .toLowerCase()
    .split('.')
    .filter(Boolean);
  if (labels.length < 2) return labels[0] || '';
  let at = labels.length - 2;
  if (at > 0 && SECOND_LEVEL.has(labels[at]) && labels[labels.length - 1].length === 2) at -= 1;
  return labels[at];
}

export function firstProfile(email) {
  const clean = String(email || '').trim();
  const [local = '', domain = ''] = clean.split('@');
  const fullName = words(local).join(' ') || 'Workspace user';
  const workspaceName = words(companyOf(domain)).join(' ') || 'My workspace';
  return { fullName, workspaceName, email: clean };
}
