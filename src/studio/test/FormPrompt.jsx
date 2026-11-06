import React, { useEffect, useId, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import Select from '../../ui/Select.tsx';
import Button from '../../ui/Button.tsx';
import { Input, TextArea } from '../../ui/Input.tsx';
import './formPrompt.css';
import { formValues, otherErrors } from './formQueue.js';

// A form the agent asked for during a conversation. Whether and when it appears is the agent's decision;
// this only draws it and sends the answers back. The server validates again and may answer with errors.
//   limitS: how long the person has before the agent ends the conversation for silence (formTimeLimit), or null
export default function FormPrompt({ form, onSubmit, onDismiss, limitS = null }) {
  const idBase = useId();
  const [values, setValues] = useState(() => Object.fromEntries(form.fields.map((f) => [f.name, f.type === 'checkbox' ? false : ''])));
  const [local, setLocal] = useState({});

  const set = (name, value) => {
    setValues((old) => ({ ...old, [name]: value }));
    setLocal((old) => ({ ...old, [name]: undefined }));
  };

  const submit = (event) => {
    event.preventDefault();
    const problems = {};
    form.fields.forEach((field) => {
      const value = values[field.name];
      if (field.required && (value === '' || value === false || value === undefined)) problems[field.name] = 'This is required.';
      else if (field.pattern && value && !safeTest(field.pattern, String(value))) problems[field.name] = 'This doesn’t look right.';
      else if (field.type === 'email' && value && !/^\S+@\S+\.\S+$/.test(String(value))) problems[field.name] = 'Enter an email address.';
    });
    setLocal(problems);
    if (Object.values(problems).some(Boolean)) return;
    onSubmit(formValues(form.fields, values));
  };

  return (
    <form className="stTForm" onSubmit={submit} noValidate aria-label={form.title}>
      <header>
        <div>
          <strong>{form.title}</strong>
          {form.description && <p>{form.description}</p>}
          {limitS > 0 && <TimeToFinish limitS={limitS} />}
        </div>
        <button
          type="button"
          className="stIconBtn"
          aria-label="Cancel the form"
          title="Cancel the form: the agent is told"
          onClick={onDismiss}
          disabled={form.busy}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      {form.fields.map((field) => {
        const id = `${idBase}-${field.name}`;
        const message = local[field.name] || form.errors?.[field.name];
        return (
          <div className="stTField" key={field.name}>
            {field.type === 'checkbox' ? (
              <label className="stTCheck" htmlFor={id}>
                <input id={id} type="checkbox" checked={!!values[field.name]} onChange={(e) => set(field.name, e.target.checked)} disabled={form.busy} />
                <span>
                  {field.label}
                  {field.required && <abbr title="Required"> *</abbr>}
                </span>
              </label>
            ) : (
              <>
                <label htmlFor={id}>
                  {field.label}
                  {field.required && <abbr title="Required"> *</abbr>}
                </label>
                {field.type === 'textarea' ? (
                  <TextArea
                    id={id}
                    rows={3}
                    value={values[field.name]}
                    onChange={(e) => set(field.name, e.target.value)}
                    disabled={form.busy}
                    aria-invalid={!!message || undefined}
                  />
                ) : field.type === 'select' ? (
                  <Select
                    id={id}
                    className="stFInput"
                    value={values[field.name]}
                    onChange={(e) => set(field.name, e.target.value)}
                    disabled={form.busy}
                    aria-invalid={!!message || undefined}
                  >
                    <option value="">Choose…</option>
                    {(field.options || []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={id}
                    type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                    value={values[field.name]}
                    onChange={(e) => set(field.name, e.target.value)}
                    disabled={form.busy}
                    aria-invalid={!!message || undefined}
                  />
                )}
              </>
            )}
            {message && <small className="stFErr">{message}</small>}
          </div>
        );
      })}
      {otherErrors(form).map((message) => (
        <small key={message} className="stFErr" role="alert">
          {message}
        </small>
      ))}
      <div className="stTFormActions">
        <Button type="submit" variant="primary" size="compact" disabled={form.busy}>
          {form.busy ? 'Sending…' : form.submitLabel}
        </Button>
      </div>
    </form>
  );
}

function safeTest(pattern, text) {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return true;
  }
}

// the time left to fill the form, from when it appeared: the agent ends a silent conversation after limitS seconds
function TimeToFinish({ limitS }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, limitS - Math.floor((now - start) / 1000));
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <p className={`stTFormTime ${left <= 60 ? 'low' : ''}`} title="After this, the agent may end the conversation for silence">
      <Icon name="clock" size={13} />
      {left > 0 ? (
        <span>
          Time to finish: <b>{clock}</b>
        </span>
      ) : (
        <span>Time is up: the agent may end the conversation. Send it as soon as you can.</span>
      )}
    </p>
  );
}
