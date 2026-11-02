import React, { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { FIELD_NAME, FIELD_TYPES, addField, addForm, formsOf, list, moveField, problemsUnder, removeField, removeForm, setField, setForm, usedBy, type Json } from '../../../../../models/toolsExtras';
import { Button } from '../../../../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../../../../utils/styles';
import { ActionsSummary, EmptyNote, IdField, ItemCard, Labeled, ListInput, MoveButtons, Select, TextInput, type ExtraEditorProps } from './shared';

/** Forms (forms[]): details collected on screen, field by field, in order. */
export function FormsEditor({ config, disabled, errors, apply, remove, onOpenJson }: ExtraEditorProps) {
  const forms = formsOf(config);
  const [open, setOpen] = useState<number | null>(forms.length === 1 ? 0 : null);
  const set = (i: number, changes: Json) => apply(setForm(config, i, changes));

  return (
    <div className="space-y-3">
      {forms.length === 0 && <EmptyNote>No forms yet. A form collects details such as a name and number on screen, in a chat or on the website. On a phone call it does what you say instead.</EmptyNote>}
      <ul className="space-y-2">
        {forms.map((f, i) => {
          const id = String(f.id ?? '');
          const fields = list<Json>(f.fields);
          return (
            <ItemCard
              key={`${id}-${i}`}
              title={String(f.title || id || `Form ${i + 1}`)}
              summary={`${fields.length} ${fields.length === 1 ? 'field' : 'fields'}: ${fields.map((x) => String(x?.label ?? x?.name ?? '')).filter(Boolean).join(', ')}`}
              problems={problemsUnder(errors, 'forms', i)}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              onDelete={() => remove(`Form “${String(f.title || id)}” deleted.`, removeForm(config, i))}
              deleteLabel={`Delete the form ${id}`}
              disabled={disabled}>
              <IdField id={id} taken={forms.map((x) => String(x.id ?? ''))} users={usedBy(config, 'forms', id)} disabled={disabled} onRename={(v) => set(i, { id: v })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Title">
                  <TextInput value={String(f.title ?? '')} onChange={(v) => apply(setForm(config, i, { title: v }))} disabled={disabled} placeholder="Request a callback" label="Form title" />
                </Labeled>
                <Labeled label="Button">
                  <TextInput value={String(f.submit_label ?? '')} onChange={(v) => set(i, { submit_label: v })} disabled={disabled} placeholder="Send" label="Button" />
                </Labeled>
              </div>
              <Labeled label="Text above the fields">
                <TextInput value={String(f.description ?? '')} onChange={(v) => set(i, { description: v })} disabled={disabled} placeholder="Leave your details and we’ll call you back." />
              </Labeled>
              <fieldset>
                <legend className="text-[13px] font-medium text-ink-soft">Fields, in order</legend>
                <ol className="mt-1.5 space-y-2">
                  {fields.map((field, n) => {
                    const name = String(field.name ?? '');
                    const nameBad = !FIELD_NAME.test(name);
                    return (
                      <li key={n} className="rounded-md border border-line px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-5 text-xs text-muted">{n + 1}.</span>
                          <input className={cn(inputClass, 'min-w-[160px] flex-1')} value={String(field.label ?? '')} placeholder="Your name" aria-label={`Field ${n + 1} label`} disabled={disabled} onChange={(e) => apply(setField(config, i, n, { label: e.target.value }))} />
                          <input
                            className={cn(inputClass, 'w-36 font-mono text-[13px]', nameBad && inputErrorClass)}
                            value={name}
                            placeholder="name"
                            title="Its name in what is sent, as {{form.name}}: lowercase letters, digits and _."
                            aria-label={`Field ${n + 1} name`}
                            aria-invalid={nameBad || undefined}
                            disabled={disabled}
                            onChange={(e) => apply(setField(config, i, n, { name: e.target.value }))}
                          />
                          <Select label={`Field ${n + 1} kind`} className="w-40" value={String(field.type ?? 'text')} disabled={disabled} options={FIELD_TYPES.map((t) => ({ value: t.type, label: t.label }))} onChange={(v) => apply(setField(config, i, n, { type: v }))} />
                          <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                            <input type="checkbox" checked={field.required === true} disabled={disabled} onChange={(e) => apply(setField(config, i, n, { required: e.target.checked }))} />
                            Required
                          </label>
                          <MoveButtons index={n} count={fields.length} onMove={(to) => apply(moveField(config, i, n, to))} disabled={disabled} what={`field ${field.label || name}`} />
                          <Button size="sm" variant="ghost" aria-label={`Remove the field ${field.label || name}`} disabled={disabled || fields.length < 2} title={fields.length < 2 ? 'A form needs one field at least.' : undefined} onClick={() => apply(removeField(config, i, n))}>
                            <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </div>
                        {nameBad && <p className="mt-1 text-xs text-danger">The name uses lowercase letters, digits and _, starting with a letter.</p>}
                        {field.type === 'select' && (
                          <label className="mt-2 block">
                            <span className="mb-1 block text-xs text-muted">Choices, separated by commas</span>
                            <ListInput value={list<string>(field.options)} disabled={disabled} label={`Field ${n + 1} choices`} onChange={(v) => apply(setField(config, i, n, { options: v }))} />
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <Button size="sm" variant="ghost" className="mt-1" disabled={disabled} onClick={() => apply(addField(config, i))}>
                  <PlusIcon className="h-3.5 w-3.5" aria-hidden />
                  Add a field
                </Button>
              </fieldset>
              <ActionsSummary label="When it is sent" actions={f.on_submit} config={config} onOpenJson={onOpenJson} empty="Nothing more happens: the answers are in {{form.name}} and the agent carries on." />
              <ActionsSummary label="When the channel can’t show a form (a phone call)" actions={f.otherwise} config={config} onOpenJson={onOpenJson} />
            </ItemCard>
          );
        })}
      </ul>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          const made = addForm(config);
          apply(made.config);
          setOpen(made.index);
        }}>
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        Add a form
      </Button>
    </div>
  );
}
