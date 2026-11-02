// Sandbox: SIP trunks (Weave React's TelephonyTrunksPage and SipTrunkDialog). A trunk here is a row in this browser.

import React, { useState } from 'react';
import { CableIcon, PhoneIncomingIcon, PhoneOutgoingIcon, PlusIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Segmented } from '../../components/ui/Segmented';
import { toast } from '../../components/ui/Toast';
import { formatShortDate } from '../../utils/format';
import { FormField, SandboxNote, SectionHeader, Stat, StatGrid, TelephonyTable } from './parts';
import { fieldClass } from './styles';
import { deleteTrunk, hasErrors, SANDBOX_COPY, trunkErrors, trunkFromForm, type SipTrunk, type TelephonyData, type TrunkDirection, type TrunkForm } from './model';
import { updateTelephony } from './store';

export function TrunksSection({ data }: { data: TelephonyData }) {
  const [dialog, setDialog] = useState<TrunkDirection | null>(null);
  const inbound = data.trunks.filter((t) => t.direction === 'inbound');
  const outbound = data.trunks.filter((t) => t.direction === 'outbound');
  const remove = (id: string) => {
    const trunk = data.trunks.find((t) => t.id === id);
    updateTelephony((d) => deleteTrunk(d, id, new Date()));
    toast.success(`SIP trunk “${trunk?.name ?? id}” deleted`, { description: 'Any rule that used it is now unassigned.' });
  };
  const words = (id: string) => `“${data.trunks.find((t) => t.id === id)?.name ?? id}” is removed from this browser, and any rule that used it becomes unassigned. This can’t be undone.`;
  return (
    <div className="space-y-5">
      <SectionHeader title="SIP trunks" text="The SIP connections that would carry calls into and out of Weave.">
        <Button variant="primary" size="sm" onClick={() => setDialog('inbound')}>
          <PlusIcon className="h-4 w-4" aria-hidden />
          Create SIP trunk
        </Button>
      </SectionHeader>
      <SandboxNote>{SANDBOX_COPY.trunks}</SandboxNote>
      <StatGrid>
        <Stat label="Inbound trunks" value={String(inbound.length)} note={inbound.length ? 'Would bring calls into Weave' : 'No inbound trunks'} />
        <Stat label="Outbound trunks" value={String(outbound.length)} note={outbound.length ? 'Would place calls through your carrier' : 'No outbound trunks'} />
        <Stat label="SIP URI" value="Not connected" note="Sandbox creates no SIP endpoint" />
      </StatGrid>
      <h3 className="flex items-center gap-2 pt-1 text-sm font-semibold text-ink">
        <PhoneIncomingIcon className="h-4 w-4 text-muted" aria-hidden /> Inbound
      </h3>
      <TelephonyTable
        title="Inbound trunks"
        columns={['Trunk id', 'Trunk name', 'Numbers', 'Created']}
        rows={inbound.map((t) => ({ id: t.id, name: t.name, cells: [t.id, t.name, t.numbers.join(', ') || 'Any number', formatShortDate(t.createdAt)] }))}
        monoFirst
        itemLabel="trunk"
        deleteWords={words}
        onDelete={remove}
        empty={{ icon: CableIcon, title: 'No inbound trunks', text: 'Inbound trunks bring calls from your carrier into Weave.', action: { label: 'Create inbound trunk', onClick: () => setDialog('inbound') } }}
      />
      <h3 className="flex items-center gap-2 pt-1 text-sm font-semibold text-ink">
        <PhoneOutgoingIcon className="h-4 w-4 text-muted" aria-hidden /> Outbound
      </h3>
      <TelephonyTable
        title="Outbound trunks"
        columns={['Trunk id', 'Trunk name', 'Numbers', 'SIP address', 'Created']}
        rows={outbound.map((t) => ({ id: t.id, name: t.name, cells: [t.id, t.name, t.numbers.join(', ') || '—', t.address || '—', formatShortDate(t.createdAt)] }))}
        monoFirst
        itemLabel="trunk"
        deleteWords={words}
        onDelete={remove}
        empty={{ icon: CableIcon, title: 'No outbound trunks', text: 'Outbound trunks let agents place calls through your carrier.', action: { label: 'Create outbound trunk', onClick: () => setDialog('outbound') } }}
      />
      {dialog && (
        <TrunkDialog
          data={data}
          initialDirection={dialog}
          onClose={() => setDialog(null)}
          onCreate={(trunk) => {
            updateTelephony((d) => ({ ...d, trunks: [...d.trunks, trunk] }));
            toast.success(`${trunk.direction === 'outbound' ? 'Outbound' : 'Inbound'} SIP trunk “${trunk.name}” created`, {
              description: trunk.numbers.length ? `Carries ${trunk.numbers.length} number${trunk.numbers.length === 1 ? '' : 's'}.` : 'Accepts calls to any number.',
            });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function TrunkDialog({ data, initialDirection, onClose, onCreate }: { data: TelephonyData; initialDirection: TrunkDirection; onClose: () => void; onCreate: (t: SipTrunk) => void }) {
  const [form, setForm] = useState<TrunkForm>({ direction: initialDirection, name: '', numbers: '', address: '', username: '' });
  const [sent, setSent] = useState(false);
  const errors = trunkErrors(form, data);
  const set = (patch: Partial<TrunkForm>) => setForm((old) => ({ ...old, ...patch }));
  const out = form.direction === 'outbound';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    if (!hasErrors(errors)) onCreate(trunkFromForm(form, new Date()));
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create a SIP trunk"
      description="Connect your carrier so calls could flow into or out of Weave."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="sandbox-trunk-form">
            Create trunk
          </Button>
        </>
      }
    >
      <form id="sandbox-trunk-form" noValidate onSubmit={submit} className="space-y-4">
        <SandboxNote title="Sandbox">{SANDBOX_COPY.dialog}</SandboxNote>
        <div>
          <Segmented
            label="Direction"
            value={form.direction}
            onChange={(direction) => set({ direction })}
            options={[
              { value: 'inbound', label: 'Inbound' },
              { value: 'outbound', label: 'Outbound' },
            ]}
          />
          <p className="mt-1.5 text-[13px] text-muted">{out ? 'Place calls through your carrier.' : 'Receive calls from your carrier.'}</p>
        </div>
        <FormField label="Trunk name" error={sent && errors.name}>
          <input autoFocus className={fieldClass(sent && errors.name)} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Carrier production" maxLength={60} />
        </FormField>
        <FormField
          label={out ? 'Numbers to call from' : 'Numbers (optional)'}
          error={sent && errors.numbers}
          hint={out ? 'Separate numbers with commas.' : 'Leave empty to accept calls to any number on this trunk.'}
        >
          <input className={fieldClass(sent && errors.numbers)} value={form.numbers} onChange={(e) => set({ numbers: e.target.value })} placeholder="+1 415 555 0100, +1 415 555 0101" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={out ? 'Carrier SIP address' : 'Carrier SIP address (optional)'} error={sent && errors.address}>
            <input className={fieldClass(sent && errors.address)} value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="sip.carrier.com" />
          </FormField>
          <FormField label="Auth username (optional)">
            <input className={fieldClass()} value={form.username} onChange={(e) => set({ username: e.target.value })} placeholder="e.g. weave-trunk" autoComplete="off" />
          </FormField>
        </div>
      </form>
    </Dialog>
  );
}
