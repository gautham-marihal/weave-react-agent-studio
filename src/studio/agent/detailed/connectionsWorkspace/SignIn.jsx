import React from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { Input } from '../../../../ui/Input.tsx';
import { FormRow } from '../Detailed.jsx';
import { SECRET, SIGN_IN, asSecret } from '../parts/connectionModel.js';

// How a system signs in (a connection's `auth`), as the guided Add asks it: no sign-in, a token, a key in a header, or
// a username and password. Only a secret's NAME is saved; the value stays on the server. A texts-or-emails service keeps
// its credentials as named secrets of its own (the schema's map), so it gets the plain form. Writes the same shapes as
// connectionFrom (connectionModel.js).

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const secretOf = (ref) => (isObj(ref) && typeof ref.secret === 'string' ? ref.secret : '');

// the name a new secret starts with: the connection's own name in capitals ("CUSTOMER_RECORDS_TOKEN")
const suggested = (key, what) => asSecret(`${key}_${what}`);

function SecretName({ id, label, value, onChange }) {
  const bad = value && !SECRET.test(value);
  return (
    <label className="cxSecret" htmlFor={id}>
      <span>{label}</span>
      <span className="cxSecretBox">
        <Icon name="key" size={14} />
        <Input id={id} mono spellCheck={false} value={value} placeholder="SECRET_NAME" onChange={(event) => onChange(asSecret(event.target.value))} />
      </span>
      {bad && <small className="stFieldError">Capitals, digits and _, starting with a capital.</small>}
    </label>
  );
}

export default function SignIn({ ctx, id, value, onChange, entry }) {
  const conn = isObj(entry?.item) ? entry.item : {};
  if (conn.type === 'notifier') return <FormRow row={{ label: 'Sign-in', path: [...entry.base, 'auth'] }} id={id} value={value} ctx={ctx} />;
  const auth = isObj(value) ? value : null;
  const now = auth?.type || 'none';
  const key = entry?.key || 'service';
  const choose = (type) => {
    if (type === now) return;
    if (type === 'none') onChange(undefined);
    else if (type === 'bearer') onChange({ type, token: { secret: suggested(key, 'token') } });
    else if (type === 'api_key') onChange({ type, header: 'X-API-Key', key: { secret: suggested(key, 'key') } });
    else onChange({ type, username: { secret: suggested(key, 'user') }, password: { secret: suggested(key, 'password') } });
  };
  const put = (field, name) => onChange({ ...auth, [field]: { secret: name } });
  return (
    <div className="cxSignIn" id={id}>
      <div className="cvPills" role="group" aria-label="How it signs in">
        {SIGN_IN.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={now === s.value}
            className={now === s.value ? 'on' : ''}
            title={s.blurb}
            onClick={() => choose(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {now === 'bearer' && <SecretName id={`${id}-token`} label="The token’s secret" value={secretOf(auth.token)} onChange={(n) => put('token', n)} />}
      {now === 'api_key' && (
        <>
          <label className="cxSecret" htmlFor={`${id}-header`}>
            <span>The header it goes in</span>
            <Input
              id={`${id}-header`}
              value={auth.header || ''}
              placeholder="X-API-Key"
              onChange={(event) => onChange({ ...auth, header: event.target.value })}
            />
          </label>
          <SecretName id={`${id}-key`} label="The key’s secret" value={secretOf(auth.key)} onChange={(n) => put('key', n)} />
        </>
      )}
      {now === 'basic' && (
        <>
          <SecretName id={`${id}-user`} label="The username’s secret" value={secretOf(auth.username)} onChange={(n) => put('username', n)} />
          <SecretName id={`${id}-pass`} label="The password’s secret" value={secretOf(auth.password)} onChange={(n) => put('password', n)} />
        </>
      )}
      <p className="cxNote">
        <Icon name="lock" size={14} />
        {now === 'none'
          ? 'It reaches the system as it is, with nothing to prove who it is.'
          : 'Only the secret’s name is saved here. Its value stays on the server: whoever runs your server sets it under that name.'}
      </p>
    </div>
  );
}
