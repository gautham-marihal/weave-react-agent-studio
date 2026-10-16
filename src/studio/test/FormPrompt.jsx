import { useId, useState } from 'react';

// A form the agent asked for during a conversation. Whether and when it appears is the agent's decision;
// this only draws it and sends the answers back. The server validates again and may answer with errors.
export default function FormPrompt({ form, onSubmit, onDismiss }) {
  const idBase = useId();
  const [values, setValues] = useState(() => Object.fromEntries(form.fields.map((f) => [f.name, f.type === 'checkbox' ? false : ''])));
  const [local, setLocal] = useState({});

  const set = (name, value) => { setValues((old) => ({ ...old, [name]: value })); setLocal((old) => ({ ...old, [name]: undefined })); };

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
    const out = {};
    form.fields.forEach((field) => {
      const value = values[field.name];
      if (field.type === 'number') out[field.name] = value === '' ? null : Number(value);
      else out[field.name] = value;
    });
    onSubmit(out);
  };

  return (
    <form className="stTForm" onSubmit={submit} noValidate aria-label={form.title}>
      <header>
        <div><strong>{form.title}</strong>{form.description && <p>{form.description}</p>}</div>
        <button type="button" className="stIconBtn" aria-label="Dismiss the form" onClick={onDismiss} disabled={form.busy}>×</button>
      </header>
      {form.fields.map((field) => {
        const id = `${idBase}-${field.name}`;
        const message = local[field.name] || form.errors?.[field.name];
        return (
          <div className="stTField" key={field.name}>
            {field.type === 'checkbox' ? (
              <label className="stTCheck" htmlFor={id}>
                <input id={id} type="checkbox" checked={!!values[field.name]} onChange={(e) => set(field.name, e.target.checked)} disabled={form.busy} />
                <span>{field.label}{field.required && <abbr title="Required"> *</abbr>}</span>
              </label>
            ) : (
              <>
                <label htmlFor={id}>{field.label}{field.required && <abbr title="Required"> *</abbr>}</label>
                {field.type === 'textarea' ? (
                  <textarea id={id} className="stFInput" rows={3} value={values[field.name]} onChange={(e) => set(field.name, e.target.value)} disabled={form.busy} aria-invalid={!!message || undefined} />
                ) : field.type === 'select' ? (
                  <select id={id} className="stFInput" value={values[field.name]} onChange={(e) => set(field.name, e.target.value)} disabled={form.busy} aria-invalid={!!message || undefined}>
                    <option value="">Choose…</option>
                    {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input id={id} className="stFInput" type={field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                    value={values[field.name]} onChange={(e) => set(field.name, e.target.value)} disabled={form.busy} aria-invalid={!!message || undefined} />
                )}
              </>
            )}
            {message && <small className="stFErr">{message}</small>}
          </div>
        );
      })}
      {form.errors?._form && <small className="stFErr">{form.errors._form}</small>}
      <div className="stTFormActions">
        <button type="submit" className="primaryCta compactCta" disabled={form.busy}>{form.busy ? 'Sending…' : form.submitLabel}</button>
      </div>
    </form>
  );
}

function safeTest(pattern, text) {
  try { return new RegExp(pattern).test(text); } catch { return true; }
}
