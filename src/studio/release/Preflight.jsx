import React from 'react';
import { splitUnsupported } from '../preflight.ts';
import { Notice } from '../ui.jsx';
import { normalizePreflightKnowledge } from './checklist.js';

// What a deploy answers besides the deployment (`preflight`): the secrets the version needs and which of them the
// server could not find, the parts the runtime can't run yet, and knowledge problems. Shown on the Deploy page; the
// secrets part also where a version is put live in one click (the publish panel, the guided setup).

// Parts of the agent the runtime can't run yet. A security item (a protection declared but not enforced) comes first,
// in red: the agent looks protected and isn't.
export function UnsupportedNotices({ items }) {
  const { security, advice } = splitUnsupported(items);
  if (!security.length && !advice.length) return null;
  return (
    <>
      {security.length > 0 && (
        <Notice kind="error" title={`${security.length} protection${security.length === 1 ? ' is' : 's are'} declared but not enforced`}>
          The agent looks protected and is not: the runtime doesn’t enforce {security.length === 1 ? 'this' : 'these'} yet.
          <ul className="stPlain">
            {security.map((item, index) => (
              <li key={index}>
                <strong>{item.feature}</strong> <code>{item.where}</code>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {advice.length > 0 && (
        <Notice kind="warn" title={`${advice.length} feature${advice.length === 1 ? '' : 's'} not available in the runtime yet`}>
          <ul className="stPlain">
            {advice.map((item, index) => (
              <li key={index}>
                {item.feature} <code>{item.where}</code>
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
}

const names = (value) => (Array.isArray(value) ? value.filter((name) => typeof name === 'string' && name) : []);

// The secrets of a deploy's preflight: the missing ones as a warning, else the ones it uses, all found. Names only.
// missingOnly: only the warning (where the secrets a version uses are already listed).
export function DeploySecrets({ preflight, missingOnly = false }) {
  const missing = names(preflight?.secrets_missing);
  const required = names(preflight?.secrets_required);
  if (missing.length)
    return (
      <Notice kind="warn" title={`${missing.length} secret${missing.length === 1 ? '' : 's'} not found on the server`}>
        The agent may fail when it needs them. Names only; they can’t be set from here yet.
        <div className="stChips">
          {missing.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </div>
      </Notice>
    );
  if (!required.length || missingOnly) return null;
  return (
    <p className="stMuted">
      Uses {required.length} secret{required.length === 1 ? '' : 's'}, all found on the server:{' '}
      {required.map((name, index) => (
        <React.Fragment key={name}>
          {index > 0 && ', '}
          <code>{name}</code>
        </React.Fragment>
      ))}
      .
    </p>
  );
}

// The knowledge problems of a deploy's preflight (`preflight.knowledge`, FRONTEND_GUIDE 10.2): every base the version
// uses that has no index, a file missing or changed. Shown next to the secrets wherever a version is put live.
export function DeployKnowledge({ preflight }) {
  const knowledge = normalizePreflightKnowledge(preflight?.knowledge);
  if (!knowledge.length) return null;
  return (
    <Notice kind="warn" title={`${knowledge.length} knowledge problem${knowledge.length === 1 ? '' : 's'} in this version`}>
      Callers asking about these get no answer from the knowledge base, or an out-of-date one.
      <ul className="stPlain">
        {knowledge.map((p, i) => (
          <li key={i}>
            {p.base && <strong>{p.base}: </strong>}
            {p.problem}
            {p.fix ? ` ${p.fix}` : ''}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

export default function Preflight({ preflight }) {
  if (!preflight) return null;
  const unsupported = preflight.unsupported || [];
  const knowledge = normalizePreflightKnowledge(preflight.knowledge);
  const secrets = names(preflight.secrets_missing).length + names(preflight.secrets_required).length;
  if (!secrets && !unsupported.length && !knowledge.length) return null;
  return (
    <div className="stPreflight">
      <DeploySecrets preflight={preflight} />
      <DeployKnowledge preflight={preflight} />
      <UnsupportedNotices items={unsupported} />
    </div>
  );
}
