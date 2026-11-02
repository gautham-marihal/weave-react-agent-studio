import React, { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { addTransfer, connectionsOf, isObj, list, problemsUnder, removeTransfer, setTransfer, targetKind, targetWords, transfersOf, usedBy, type Json } from '../../../../../models/toolsExtras';
import { Segmented } from '../../../../ui/Segmented';
import { Toggle } from '../../../../ui/Toggle';
import { Button } from '../../../../ui/Button';
import { ActionsSummary, EmptyNote, IdField, ItemCard, Labeled, NumberInput, PairsEditor, SecretInput, Select, TextInput, type ExtraEditorProps } from './shared';

const DEFAULT_URI = 'sip:{{target}}@{{pbx.host}};transport={{pbx.transport}}';

/** Phone transfers (telephony.transfers): where a call can be passed to a person, and what happens around it. */
export function TransfersEditor({ config, disabled, errors, apply, remove, onOpenJson }: ExtraEditorProps) {
  const transfers = transfersOf(config);
  const [open, setOpen] = useState<number | null>(transfers.length === 1 ? 0 : null);
  const set = (i: number, changes: Json) => apply(setTransfer(config, i, changes));
  const schedules = Object.keys(isObj(config.schedules) ? config.schedules : {});
  const http = connectionsOf(config).filter(([, c]) => c.type === 'http').map(([id]) => id);

  return (
    <div className="space-y-3">
      {transfers.length === 0 && <EmptyNote>No transfers yet. A transfer is where a call can be passed to a person, by phone number or through your own system.</EmptyNote>}
      <ul className="space-y-2">
        {transfers.map((t, i) => {
          const id = String(t.id ?? '');
          const kind = targetKind(t.target);
          const isHttp = t.method === 'http_request';
          const request = (isObj(t.request) ? t.request : {}) as Json;
          const closedSay = list<Json>(t.closed);
          const simpleClosed = closedSay.length === 0 || (closedSay.length === 1 && closedSay[0]?.type === 'say' && typeof closedSay[0]?.text === 'string');
          const where = isHttp ? 'Through a connection' : targetWords(t.target) || 'No number yet: callers are offered a callback';
          return (
            <ItemCard
              key={`${id}-${i}`}
              title={<code className="font-mono text-[13px]">{id || `transfer ${i + 1}`}</code>}
              summary={where}
              problems={problemsUnder(errors, 'telephony', i)}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              onDelete={() => remove(`Transfer “${id}” deleted.`, removeTransfer(config, i))}
              deleteLabel={`Delete the transfer ${id}`}
              disabled={disabled}>
              <IdField id={id} taken={transfers.map((x) => String(x.id ?? ''))} users={usedBy(config, 'telephony', id)} disabled={disabled} onRename={(v) => set(i, { id: v })} />
              <Labeled label="What it is for">
                <TextInput value={String(t.description ?? '')} onChange={(v) => set(i, { description: v })} disabled={disabled} placeholder="The billing team’s queue." />
              </Labeled>
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink-soft">How the call is passed on</p>
                <Segmented
                  size="sm"
                  label="How the call is passed on"
                  value={isHttp ? 'http_request' : 'sip_refer'}
                  options={[
                    { value: 'sip_refer', label: 'To a phone number' },
                    { value: 'http_request', label: 'Through your own system' },
                  ]}
                  onChange={(v) => !disabled && set(i, { method: v })}
                />
              </div>

              {!isHttp && (
                <>
                  <div>
                    <p className="mb-1.5 text-[13px] font-medium text-ink-soft">Where it goes</p>
                    <Segmented
                      size="sm"
                      label="Where it goes"
                      value={kind}
                      options={[
                        { value: 'number', label: 'A number' },
                        { value: 'secret', label: 'A number kept as a secret' },
                        ...(kind === 'lookup' ? [{ value: 'lookup', label: 'Chosen during the call' }] : []),
                      ]}
                      onChange={(v) => !disabled && v !== kind && set(i, { target: v === 'secret' ? { secret: '' } : '' })}
                    />
                  </div>
                  {kind === 'number' && (
                    <Labeled label="Phone number or SIP address" help="Left empty, callers hear the fallback line and are offered a callback.">
                      <TextInput value={typeof t.target === 'string' ? t.target : ''} onChange={(v) => set(i, { target: v })} disabled={disabled} placeholder="+44 20 7946 0000" mono label="Phone number or SIP address" />
                    </Labeled>
                  )}
                  {kind === 'secret' && <SecretInput label="Secret with the number" value={t.target} onChange={(ref) => set(i, { target: ref })} disabled={disabled} />}
                  {kind === 'lookup' && (
                    <p className="rounded-lg bg-subtle px-4 py-3 text-[13px] text-ink-soft">
                      The number is chosen from what it remembers as “{String((t.target as Json).lookup && ((t.target as Json).lookup as Json).state)}”.{' '}
                      <button type="button" onClick={onOpenJson} className="font-medium text-accent hover:underline">Change the choices in the JSON view</button>
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-medium text-ink-soft">Play a ringing tone while it connects</p>
                    </div>
                    <Toggle checked={t.play_dialtone === true} onChange={(v) => set(i, { play_dialtone: v || undefined })} label="Play a ringing tone while it connects" disabled={disabled} />
                  </div>
                  <Labeled label="How a number becomes a SIP address" help={`Left empty: ${DEFAULT_URI}. An address that starts with sip: or tel: is used as it is.`}>
                    <TextInput value={String(t.uri_template ?? '')} onChange={(v) => set(i, { uri_template: v })} disabled={disabled} placeholder={DEFAULT_URI} mono />
                  </Labeled>
                  <PairsEditor label="SIP headers sent with it" value={t.headers} onChange={(v) => set(i, { headers: v })} disabled={disabled} keyPlaceholder="X-Reason" valuePlaceholder="{{args.reason}}" />
                </>
              )}

              {isHttp && (
                <div className="grid gap-3 sm:grid-cols-[1fr_120px_1fr]">
                  <Labeled label="Connection" error={http.length ? undefined : 'Add a web service under Connections first.'}>
                    <Select
                      label="Connection"
                      value={String(request.connection ?? '')}
                      disabled={disabled}
                      options={[{ value: '', label: 'Choose…' }, ...http.map((c) => ({ value: c, label: c }))]}
                      onChange={(v) => set(i, { request: { ...request, connection: v } })}
                    />
                  </Labeled>
                  <Labeled label="Method">
                    <Select label="Method" value={String(request.method ?? 'POST')} disabled={disabled} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))} onChange={(v) => set(i, { request: { ...request, method: v } })} />
                  </Labeled>
                  <Labeled label="Path">
                    <TextInput value={String(request.path ?? '')} onChange={(v) => set(i, { request: { ...request, path: v } })} disabled={disabled} placeholder="/queues/{{target}}" mono label="Path" />
                  </Labeled>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Only during these hours" help={schedules.length ? 'Outside them it does what is said when closed.' : 'Add business hours on the Channels page to use them here.'}>
                  <Select
                    label="Only during these hours"
                    value={String(t.schedule ?? '')}
                    disabled={disabled || (!schedules.length && !t.schedule)}
                    options={[{ value: '', label: 'Any time' }, ...[...schedules, ...(t.schedule && !schedules.includes(String(t.schedule)) ? [String(t.schedule)] : [])].map((s) => ({ value: s, label: s }))]}
                    onChange={(v) => set(i, { schedule: v })}
                  />
                </Labeled>
                <Labeled label="Wait before transferring (seconds)" help="After what runs first, so it lands before the transfer.">
                  <NumberInput value={t.delay_s} onChange={(v) => set(i, { delay_s: v })} disabled={disabled} min={0} step={0.5} label="Wait before transferring" />
                </Labeled>
              </div>
              {simpleClosed ? (
                <Labeled label="What it says when closed" help="Said instead of transferring outside the hours. Left empty: nothing.">
                  <TextInput
                    value={closedSay.length ? String(closedSay[0].text) : ''}
                    onChange={(v) => set(i, { closed: v ? [{ type: 'say', text: v }] : undefined })}
                    disabled={disabled}
                    placeholder="We’re closed right now. Please call back between 9 and 5."
                    label="What it says when closed"
                  />
                </Labeled>
              ) : (
                <ActionsSummary label="When closed" actions={t.closed} config={config} onOpenJson={onOpenJson} />
              )}
              <ActionsSummary label="First" actions={t.before} config={config} onOpenJson={onOpenJson} />
              <ActionsSummary label="When it works" actions={t.on_success} config={config} onOpenJson={onOpenJson} />
              <ActionsSummary label="When it fails" actions={t.on_failure} config={config} onOpenJson={onOpenJson} />
            </ItemCard>
          );
        })}
      </ul>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          const made = addTransfer(config);
          apply(made.config);
          setOpen(made.index);
        }}>
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        Add a transfer
      </Button>
    </div>
  );
}
