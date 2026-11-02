import React, { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import {
  addDelivery,
  addNotification,
  list,
  notificationsOf,
  notifiersOf,
  problemsUnder,
  recipientsFrom,
  recipientsText,
  removeDelivery,
  removeNotification,
  setDelivery,
  setNotification,
  templateHints,
  usedBy,
  type Json,
} from '../../../../../models/toolsExtras';
import { Segmented } from '../../../../ui/Segmented';
import { Button } from '../../../../ui/Button';
import { cn, inputClass } from '../../../../../utils/styles';
import { ActionsSummary, EmptyNote, IdField, ItemCard, Labeled, Select, TextInput, type ExtraEditorProps } from './shared';

/** The messages it sends (notifications[]): texts and emails, each sent through a sender under Connections. */
export function NotificationsEditor({ config, disabled, errors, apply, remove, onOpenJson }: ExtraEditorProps) {
  const all = notificationsOf(config);
  const senders = notifiersOf(config);
  const [open, setOpen] = useState<number | null>(all.length === 1 ? 0 : null);
  const hints = templateHints(config);

  return (
    <div className="space-y-3">
      {all.length === 0 && <EmptyNote>No messages yet. Texts and emails it can send during or after a call, such as a confirmation to the caller or a note to your team.</EmptyNote>}
      {senders.length === 0 && <p className="text-[13px] text-warning">A message is sent through a text or email sender. Add one under Connections first.</p>}
      <ul className="space-y-2">
        {all.map((n, i) => {
          const id = String(n.id ?? '');
          const deliver = list<Json>(n.deliver);
          return (
            <ItemCard
              key={`${id}-${i}`}
              title={<code className="font-mono text-[13px]">{id || `message ${i + 1}`}</code>}
              summary={String(n.description ?? '') || deliver.map((d) => `By ${String(d.via || 'a sender not chosen yet')}`).join(', then ')}
              problems={problemsUnder(errors, 'notifications', i)}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              onDelete={() => remove(`Message “${id}” deleted.`, removeNotification(config, i))}
              deleteLabel={`Delete the message ${id}`}
              disabled={disabled}>
              <IdField id={id} taken={all.map((x) => String(x.id ?? ''))} users={usedBy(config, 'notifications', id)} disabled={disabled} onRename={(v) => apply(setNotification(config, i, { id: v }))} />
              <Labeled label="What it is for">
                <TextInput value={String(n.description ?? '')} onChange={(v) => apply(setNotification(config, i, { description: v }))} disabled={disabled} placeholder="Confirm a new ticket to the caller." />
              </Labeled>
              {deliver.length > 1 && (
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-ink-soft">Ways of sending it</p>
                  <Segmented
                    size="sm"
                    label="Ways of sending it"
                    value={n.strategy === 'all' ? 'all' : 'first_success'}
                    options={[
                      { value: 'first_success', label: 'The first that works' },
                      { value: 'all', label: 'All of them' },
                    ]}
                    onChange={(v) => !disabled && apply(setNotification(config, i, { strategy: v === 'all' ? 'all' : undefined }))}
                  />
                </div>
              )}
              <ol className="space-y-3">
                {deliver.map((d, k) => {
                  const sender = senders.find((s) => s.id === d.via);
                  const to = recipientsText(d.to);
                  return (
                    <li key={k} className="space-y-3 rounded-md border border-line px-3 py-3">
                      <div className="flex items-end gap-2">
                        <Labeled label={deliver.length > 1 ? `${k + 1}. Sent by` : 'Sent by'} className="flex-1">
                          <Select
                            label="Sent by"
                            value={String(d.via ?? '')}
                            disabled={disabled}
                            options={[{ value: '', label: 'Choose a sender…' }, ...senders.map((s) => ({ value: s.id, label: `${s.id} (${s.kind === 'email' ? 'email' : 'text'}${s.provider ? `, ${s.provider}` : ''})` })), ...(d.via && !sender ? [{ value: String(d.via), label: `${String(d.via)} (not a sender)` }] : [])]}
                            onChange={(v) => apply(setDelivery(config, i, k, { via: v }))}
                          />
                        </Labeled>
                        {deliver.length > 1 && (
                          <Button size="sm" variant="ghost" aria-label={`Remove way ${k + 1}`} disabled={disabled} onClick={() => apply(removeDelivery(config, i, k))}>
                            <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                      </div>
                      {to === null ? (
                        <p className="text-[13px] text-ink-soft">
                          Who it goes to is chosen from what it remembers.{' '}
                          <button type="button" onClick={onOpenJson} className="font-medium text-accent hover:underline">Change it in the JSON view</button>
                        </p>
                      ) : (
                        <Labeled label="To" help="Numbers or addresses, separated by commas. {{state.caller_phone}} is the caller’s number.">
                          <RecipientsInput value={to} onChange={(v) => apply(setDelivery(config, i, k, { to: recipientsFrom(v) }))} disabled={disabled} placeholder={sender?.kind === 'email' ? 'team@example.com' : '{{state.caller_phone}}'} />
                        </Labeled>
                      )}
                      {sender?.kind === 'email' && (
                        <Labeled label="Subject">
                          <TextInput value={String(d.subject ?? '')} onChange={(v) => apply(setDelivery(config, i, k, { subject: v }))} disabled={disabled} placeholder="Callback request" label="Subject" />
                        </Labeled>
                      )}
                      <Labeled label="Text" help={`It can use what it remembers, for example ${hints.slice(0, 3).join(', ')}.`}>
                        <TextInput value={String(d.body ?? '')} onChange={(v) => apply(setDelivery(config, i, k, { body: v }))} disabled={disabled} multiline placeholder="Your ticket {{with.ticket_id}} has been created." label="Text" />
                      </Labeled>
                    </li>
                  );
                })}
              </ol>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => apply(addDelivery(config, i))}>
                <PlusIcon className="h-3.5 w-3.5" aria-hidden />
                Add another way of sending it
              </Button>
              <ActionsSummary label="If it can’t be sent" actions={n.on_failure} config={config} onOpenJson={onOpenJson} />
            </ItemCard>
          );
        })}
      </ul>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          const made = addNotification(config);
          apply(made.config);
          setOpen(made.index);
        }}>
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        Add a message
      </Button>
    </div>
  );
}

/** Who a message goes to, typed as text: kept as typed while the list it stands for is the same. */
function RecipientsInput({ value, onChange, disabled, placeholder }: { value: string; onChange: (v: string) => void; disabled: boolean; placeholder: string }) {
  const [typed, setTyped] = useState(value);
  const shown = recipientsFrom(typed).join(', ') === recipientsFrom(value).join(', ') ? typed : value;
  return (
    <input
      className={cn(inputClass, 'font-mono text-[13px]')}
      value={shown}
      disabled={disabled}
      placeholder={placeholder}
      aria-label="To"
      spellCheck={false}
      onChange={(e) => {
        setTyped(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}
