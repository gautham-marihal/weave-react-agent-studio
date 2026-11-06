import React, { useId, useMemo, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { Input } from '../../../../ui/Input.tsx';
import { Modal } from '../../../ui.jsx';
import { describeUsage, findUsage } from '../../../form/references.js';
import {
  CONNECTION_KINDS,
  NOTIFIER_SERVICES,
  SIGN_IN,
  asSecret,
  connectionFrom,
  connectionState,
  kindOf,
  metaOf,
  secretNamesIn,
  stepProblems,
} from './connectionModel.js';
import { setPath } from '../schemaFacts.js';

export { CONNECTION_KINDS, SIGN_IN, addressProblem, connectionFrom, connectionState, secretNamesIn, stepProblems } from './connectionModel.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Connections, made plain: every connection in one list (what it is, where it points, how it signs in, who uses it and
// whether it is ready), and a guided way to add one (what, which service, address, sign-in, review). Everything is the
// same config as before: { type: 'http', base_url, auth, headers, timeout_s } | { type: 'mcp', url, transport, auth } |
// { type: 'notifier', kind, provider, from, auth }; the chosen connection's own settings stay editable under the list.

// ---- the list ---------------------------------------------------------------------------------------------------

// What a connection is, for its row in the list (Detailed.jsx ItemRows): its kind, where it points, who uses it, and
// whether it is ready
export function describeConnection(entry, ctx) {
  const usedBy = ctx.engine ? describeUsage(ctx.config, findUsage(ctx.engine, ctx.config, 'connections', entry.key)) : [];
  return {
    icon: kindOf(entry.item?.type).icon,
    meta: metaOf(entry.item),
    detail: usedBy.length ? `Used by ${usedBy.join(', ')}` : 'Not used by any tool yet',
    state: connectionState(entry.item),
  };
}

// ---- adding one, step by step ----------------------------------------------------------------------------------

const STEPS = [
  { id: 'what', label: 'What' },
  { id: 'service', label: 'Service' },
  { id: 'address', label: 'Address' },
  { id: 'signin', label: 'Sign-in' },
  { id: 'review', label: 'Review' },
];

// The button that opens the guided Add, and the dialog itself
export function AddConnection({ ctx, label = 'Add a connection' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="small" className="dtAddBtn" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />
        {label}
      </Button>
      {open && <AddConnectionDialog ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

// a field with its label, a line of help, and what is wrong with it (once the person has tried to go on)
function Field({ id, label, help, error, children }) {
  return (
    <div className={`cnField ${error ? 'bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {help && (
        <small id={`${id}-help`} className="cnHelp">
          {help}
        </small>
      )}
      {children}
      {error && (
        <small className="stFieldError" id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

// a secret's name, typed as the vault spells it, with the names already in the draft offered
function SecretField({ id, label, help, value, onChange, names, error }) {
  const listId = useId();
  return (
    <Field id={id} label={label} help={help} error={error}>
      <div className="stFSecret">
        <Icon name="key" size={15} className="stFSecretIcon" />
        <Input
          id={id}
          mono
          spellCheck={false}
          list={listId}
          value={value}
          placeholder="SECRET_NAME"
          aria-describedby={`${id}-help`}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(asSecret(event.target.value))}
        />
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
    </Field>
  );
}

// name → value pairs (headers, a notifier's credentials), each its own row with a remove button
function Pairs({ id, rows, onChange, keyLabel, valueLabel, addLabel, secret = false, names = [] }) {
  const listId = useId();
  const change = (i, patch) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="cnPairs" id={id}>
      {rows.map((row, i) => (
        <div className="cnPair" key={i}>
          <Input aria-label={`${keyLabel} ${i + 1}`} value={row.key} placeholder={keyLabel} onChange={(event) => change(i, { key: event.target.value })} />
          <Input
            aria-label={`${valueLabel} ${i + 1}`}
            mono={secret}
            list={secret ? listId : undefined}
            value={row.value}
            placeholder={secret ? 'SECRET_NAME' : valueLabel}
            onChange={(event) => change(i, { value: secret ? asSecret(event.target.value) : event.target.value })}
          />
          <Button
            type="button"
            variant="quiet"
            size="small"
            aria-label={`Remove ${row.key || `row ${i + 1}`}`}
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
          >
            <Icon name="close" size={14} />
          </Button>
        </div>
      ))}
      {secret && (
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
      <Button type="button" variant="quiet" size="small" onClick={() => onChange([...rows, { key: '', value: '' }])}>
        <Icon name="plus" size={14} />
        {addLabel}
      </Button>
    </div>
  );
}

const FRESH = {
  type: '',
  name: '',
  provider: '',
  kind: 'sms',
  from: '',
  address: '',
  transport: '',
  signIn: 'none',
  token: '',
  header: 'X-API-Key',
  key: '',
  username: '',
  password: '',
  credentials: [],
  headers: [],
  timeout: '',
};

function AddConnectionDialog({ ctx, onClose }) {
  const [answers, setAnswers] = useState(FRESH);
  const [step, setStep] = useState(0);
  // problems show once the person tries to go on from a step
  const [tried, setTried] = useState(false);
  const taken = useMemo(() => Object.keys(isObj(ctx.config?.connections) ? ctx.config.connections : {}), [ctx.config]);
  const names = useMemo(() => secretNamesIn(ctx.config), [ctx.config]);
  const set = (patch) => setAnswers((old) => ({ ...old, ...patch }));
  const here = STEPS[step].id;
  const problems = here === 'what' ? (answers.type ? {} : { type: 'Choose what you are connecting.' }) : stepProblems(here, answers, taken);
  const shown = tried ? problems : {};
  const kind = kindOf(answers.type);
  const next = () => {
    if (Object.keys(problems).length) {
      setTried(true);
      return;
    }
    setTried(false);
    setStep(step + 1);
  };
  const save = () => {
    const item = connectionFrom(answers);
    ctx.set(setPath(ctx.config, ['connections', answers.name], item));
    ctx.choose('connections', answers.name);
    onClose();
  };
  const made = answers.type ? connectionFrom({ ...answers, name: answers.name || 'new' }) : null;
  const review = made ? connectionState(made) : null;

  const footer = (
    <>
      {step > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setTried(false);
            setStep(step - 1);
          }}
        >
          Back
        </Button>
      )}
      <span className="cnFootSpace" />
      <Button type="button" variant="quiet" onClick={onClose}>
        Cancel
      </Button>
      {here === 'review' ? (
        <Button type="button" variant="primary" onClick={save} disabled={review?.tone === 'bad'}>
          Save the connection
        </Button>
      ) : (
        <Button type="button" variant="primary" onClick={next}>
          Next
        </Button>
      )}
    </>
  );

  return (
    <Modal title="Add a connection" subtitle="Connect a system its tools should reach. You can change everything later." onClose={onClose} footer={footer} wide>
      <ol className="cnSteps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : i === step ? 'on' : ''}>
            <span className="cnStepNum" aria-hidden="true">
              {i < step ? <Icon name="check" size={12} /> : i + 1}
            </span>
            {s.id === 'address' && answers.type === 'notifier' ? 'Sender' : s.label}
          </li>
        ))}
      </ol>

      {here === 'what' && (
        <fieldset className="cnStep">
          <legend>What do you want to connect?</legend>
          <div className="cnKinds" role="radiogroup" aria-label="What do you want to connect?">
            {CONNECTION_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={answers.type === k.value}
                className={answers.type === k.value ? 'on' : ''}
                onClick={() => set({ type: k.value })}
              >
                <span className="cnIcon" aria-hidden="true">
                  <Icon name={k.icon} size={18} />
                </span>
                <strong>{k.label}</strong>
                <span>{k.blurb}</span>
              </button>
            ))}
          </div>
          {shown.type && (
            <small className="stFieldError" role="alert">
              {shown.type}
            </small>
          )}
        </fieldset>
      )}

      {here === 'service' && (
        <fieldset className="cnStep">
          <legend>
            {answers.type === 'notifier' ? 'Which service sends the messages?' : `Which ${kind.label === 'Web API' ? 'service' : 'server'} is it?`}
          </legend>
          <Field
            id="cn-name"
            label="Name"
            help="A short name its tools use to point at it, such as onboarding_service. Lowercase letters, digits, _ or -."
            error={shown.name}
          >
            <Input
              id="cn-name"
              mono
              value={answers.name}
              placeholder={answers.type === 'notifier' ? 'sms_sender' : answers.type === 'mcp' ? 'crm_tools' : 'onboarding_service'}
              aria-invalid={shown.name ? true : undefined}
              onChange={(event) => set({ name: event.target.value.toLowerCase().replace(/\s+/g, '_') })}
            />
          </Field>
          {answers.type === 'notifier' && (
            <>
              <div className="cnField">
                <span className="cnLabel" id="cn-sends">
                  It sends
                </span>
                <div className="dtPills" role="radiogroup" aria-labelledby="cn-sends">
                  {[
                    ['sms', 'Texts (SMS)'],
                    ['email', 'Emails'],
                  ].map(([value, words]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={answers.kind === value}
                      className={answers.kind === value ? 'on' : ''}
                      onClick={() => set({ kind: value })}
                    >
                      {words}
                    </button>
                  ))}
                </div>
              </div>
              <ServiceField value={answers.provider} onChange={(provider) => set({ provider })} error={shown.provider} />
            </>
          )}
        </fieldset>
      )}

      {here === 'address' && answers.type !== 'notifier' && (
        <fieldset className="cnStep">
          <legend>Where is it?</legend>
          <Field
            id="cn-address"
            label="Address"
            help={
              answers.type === 'mcp'
                ? 'The address of the MCP server, as its makers give it.'
                : 'The start of every address its tools call. A tool adds its own path, such as /accounts, to it.'
            }
            error={shown.address}
          >
            <Input
              id="cn-address"
              mono
              value={answers.address}
              placeholder={answers.type === 'mcp' ? 'https://mcp.example.com/mcp' : 'https://api.example.com'}
              aria-invalid={shown.address ? true : undefined}
              onChange={(event) => set({ address: event.target.value.trim() })}
            />
          </Field>
          {answers.type === 'mcp' && (
            <div className="cnField">
              <span className="cnLabel" id="cn-transport">
                How it connects
              </span>
              <small className="cnHelp">Leave it as it is unless the server’s makers say otherwise.</small>
              <div className="dtPills" role="radiogroup" aria-labelledby="cn-transport">
                {[
                  ['', 'The server’s default'],
                  ['streamable_http', 'Streamable HTTP'],
                  ['sse', 'Server-sent events (older servers)'],
                ].map(([value, words]) => (
                  <button
                    key={value || 'default'}
                    type="button"
                    role="radio"
                    aria-checked={answers.transport === value}
                    className={answers.transport === value ? 'on' : ''}
                    onClick={() => set({ transport: value })}
                  >
                    {words}
                  </button>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      )}

      {here === 'address' && answers.type === 'notifier' && (
        <fieldset className="cnStep">
          <legend>Who are the messages from?</legend>
          <Field
            id="cn-from"
            label={answers.kind === 'email' ? 'Sends from (address or mailbox)' : 'Sends from (number)'}
            help="What people see as the sender. Optional: the service’s own default is used when it is empty."
          >
            <Input
              id="cn-from"
              value={answers.from}
              placeholder={answers.kind === 'email' ? 'noreply@example.com' : '+6561234567'}
              onChange={(event) => set({ from: event.target.value })}
            />
          </Field>
        </fieldset>
      )}

      {here === 'signin' && answers.type !== 'notifier' && (
        <fieldset className="cnStep">
          <legend>How does it sign in?</legend>
          <p className="cnNote">
            <Icon name="lock" size={14} /> Keys are never saved in the agent. They are kept on the server as secrets; here you only name the secret.
          </p>
          <div className="cnSignIn" role="radiogroup" aria-label="How does it sign in?">
            {SIGN_IN.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={answers.signIn === s.value}
                className={answers.signIn === s.value ? 'on' : ''}
                onClick={() => set({ signIn: s.value })}
              >
                <strong>{s.label}</strong>
                <span>{s.blurb}</span>
              </button>
            ))}
          </div>
          {answers.signIn === 'bearer' && (
            <SecretField
              id="cn-token"
              label="The token’s secret"
              help="The name the token is kept under on the server, such as ONBOARDING_TOKEN."
              value={answers.token}
              onChange={(token) => set({ token })}
              names={names}
              error={shown.token}
            />
          )}
          {answers.signIn === 'api_key' && (
            <>
              <Field id="cn-header" label="Header" help="The header the service reads the key from." error={shown.header}>
                <Input id="cn-header" mono value={answers.header} onChange={(event) => set({ header: event.target.value })} />
              </Field>
              <SecretField
                id="cn-key"
                label="The key’s secret"
                help="The name the key is kept under on the server."
                value={answers.key}
                onChange={(key) => set({ key })}
                names={names}
                error={shown.key}
              />
            </>
          )}
          {answers.signIn === 'basic' && (
            <>
              <SecretField
                id="cn-user"
                label="The username’s secret"
                value={answers.username}
                onChange={(username) => set({ username })}
                names={names}
                error={shown.username}
              />
              <SecretField
                id="cn-pass"
                label="The password’s secret"
                value={answers.password}
                onChange={(password) => set({ password })}
                names={names}
                error={shown.password}
              />
            </>
          )}
        </fieldset>
      )}

      {here === 'signin' && answers.type === 'notifier' && (
        <fieldset className="cnStep">
          <legend>What does the service need to sign in?</legend>
          <p className="cnNote">
            <Icon name="lock" size={14} /> Each credential is kept on the server as a secret; here you only name it. For Twilio, for example: account_sid and
            auth_token.
          </p>
          <Pairs
            id="cn-creds"
            rows={answers.credentials}
            onChange={(credentials) => set({ credentials })}
            keyLabel="Credential"
            valueLabel="Secret"
            addLabel="Add a credential"
            secret
            names={names}
          />
          {Object.entries(shown)
            .filter(([k]) => k.startsWith('cred'))
            .slice(0, 1)
            .map(([k, words]) => (
              <small key={k} className="stFieldError" role="alert">
                {words}
              </small>
            ))}
        </fieldset>
      )}

      {here === 'review' && made && (
        <div className="cnStep">
          <h3 className="cnReviewTitle">Check it before saving</h3>
          <dl className="cnReview">
            <dt>What</dt>
            <dd>{kind.label}</dd>
            <dt>Name</dt>
            <dd className="mono">{answers.name}</dd>
            {answers.type === 'notifier' ? (
              <>
                <dt>Sends</dt>
                <dd>
                  {answers.kind === 'email' ? 'Emails' : 'Texts'} through {answers.provider}
                  {answers.from ? `, from ${answers.from}` : ''}
                </dd>
                <dt>Sign-in</dt>
                <dd>
                  {answers.credentials.filter((r) => r.key).length
                    ? answers.credentials
                        .filter((r) => r.key)
                        .map((r) => `${r.key} (secret ${r.value})`)
                        .join(', ')
                    : 'None'}
                </dd>
              </>
            ) : (
              <>
                <dt>Address</dt>
                <dd className="mono">{answers.address}</dd>
                <dt>Sign-in</dt>
                <dd>
                  {SIGN_IN.find((s) => s.value === answers.signIn)?.label}
                  {answers.signIn === 'bearer' && `, secret ${answers.token}`}
                  {answers.signIn === 'api_key' && `, in ${answers.header}, secret ${answers.key}`}
                  {answers.signIn === 'basic' && `, secrets ${answers.username} and ${answers.password}`}
                </dd>
              </>
            )}
          </dl>
          <ul className="cnChecks" aria-label="Checks">
            <li className={review.tone}>
              <Icon name={review.tone === 'good' ? 'check' : 'alert'} size={14} />
              {review.tone === 'good' ? 'The settings are complete and the address is a web address.' : review.words}
            </li>
            <li className="info">
              <Icon name="info" size={14} />
              These checks read the settings; they don’t call the service. To try it for real, give it to a tool and use Try it on Tools.
            </li>
          </ul>
          {answers.type === 'http' && (
            <details className="cnAdvanced">
              <summary>Advanced settings (optional)</summary>
              <Field
                id="cn-timeout"
                label="Give up after (seconds)"
                help="How long to wait for this service to answer before the request stops. Empty: the server’s default."
              >
                <Input
                  id="cn-timeout"
                  type="number"
                  min="1"
                  value={answers.timeout}
                  placeholder="Default"
                  onChange={(event) => set({ timeout: event.target.value })}
                />
              </Field>
              <div className="cnField">
                <span className="cnLabel">Headers</span>
                <small className="cnHelp">Extra information sent with every request to this service, such as an account number it expects.</small>
                <Pairs
                  id="cn-headers"
                  rows={answers.headers}
                  onChange={(headers) => set({ headers })}
                  keyLabel="Header"
                  valueLabel="Value"
                  addLabel="Add a header"
                />
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

// a notifier's service: typed, with the usual ones offered
function ServiceField({ value, onChange, error }) {
  const listId = useId();
  return (
    <Field id="cn-provider" label="Service" help="The company that sends them, for example twilio, sendgrid or microsoft_graph." error={error}>
      <Input
        id="cn-provider"
        mono
        list={listId}
        value={value}
        placeholder="twilio"
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value.trim())}
      />
      <datalist id={listId}>
        {NOTIFIER_SERVICES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </Field>
  );
}
