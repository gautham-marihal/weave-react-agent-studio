import React, { useState } from 'react';
import { CircleCheckIcon } from 'lucide-react';
import type { FormRequest } from '../../../types/testConsole';
import { Button } from '../../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../../utils/styles';

interface ChatFormProps {
  form: FormRequest;
  accepted: boolean;
  onSubmit: (values: Record<string, string>) => Record<string, string>;
}

export function ChatForm({ form, accepted, onSubmit }: ChatFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (accepted) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink-soft">
        <CircleCheckIcon className="h-4 w-4 text-success" aria-hidden />
        {form.title} — sent
      </div>);

  }

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors(onSubmit(values));
  };

  return (
    <form onSubmit={handle} noValidate className="mt-2 w-full max-w-sm space-y-3 rounded-lg border border-line bg-surface p-4" aria-label={form.title}>
      <p className="text-sm font-semibold text-ink">{form.title}</p>
      {form.fields.map((f) => {
        const id = `${form.request_id}-${f.name}`;
        const err = errors[f.name];
        return (
          <div key={f.name}>
            <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">
              {f.label}
              {f.required && <span className="text-danger"> *</span>}
            </label>
            {f.type === 'select' ?
            <select id={id} className={cn(inputClass, 'mt-1', err && inputErrorClass)} value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                <option value="">Choose…</option>
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select> :

            <input
              id={id}
              type={f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : 'text'}
              className={cn(inputClass, 'mt-1', err && inputErrorClass)}
              value={values[f.name] ?? ''}
              aria-invalid={!!err}
              aria-describedby={err ? `${id}-err` : undefined}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />

            }
            {err && <p id={`${id}-err`} className="mt-1 text-xs text-danger">{err}</p>}
          </div>);

      })}
      <Button type="submit" variant="primary" size="sm" className="w-full">Send details</Button>
    </form>);

}