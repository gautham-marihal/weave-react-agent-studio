// Sandbox: test phone numbers (Weave React's TelephonyNumbersPage and PhoneNumberDialog), then the numbers set up for
// an agent through the API, which Sandbox answers with its imitation (Library › Phone numbers draws them).

import React, { useState } from 'react';
import { HashIcon, PlusIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/Toast';
import { NumbersPanel } from '../../components/library/NumbersPanel';
import type { TelephonySection } from '../../models/telephony';
import { formatShortDate } from '../../utils/format';
import { cn } from '../../utils/styles';
import { Callout, FormField, SandboxNote, SectionHeader, TelephonyTable } from './parts';
import { fieldClass } from './styles';
import { areaCodeError, COUNTRIES, countryName, generateTestNumber, makeId, releaseNumber, ruleForNumber, SANDBOX_COPY, type TelAgent, type TelephonyData, type TestNumber } from './model';
import { updateTelephony } from './store';

export function NumbersSection({ data, agents, onSection }: { data: TelephonyData; agents: TelAgent[]; onSection: (s: TelephonySection) => void }) {
  const [adding, setAdding] = useState(false);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name;
  const rows = data.numbers.map((n) => {
    const rule = ruleForNumber(data, n.id);
    const agent = rule ? nameOf(rule.agentId) : '';
    return {
      id: n.id,
      name: n.number,
      cells: [n.number, n.label || '—', countryName(n.country), rule ? `${rule.name}${agent ? ` (${agent})` : ''}` : 'Not routed', formatShortDate(n.createdAt)],
    };
  });
  const release = (id: string) => {
    const number = data.numbers.find((n) => n.id === id);
    updateTelephony((d) => releaseNumber(d, id, new Date()));
    toast.success(`Test number ${number?.number ?? ''} released`, { description: 'Any rule that used it is now unassigned.' });
  };
  return (
    <div className="space-y-5">
      <SectionHeader title="Test phone numbers" text="Numbers your dispatch rules route and your simulated calls dial. Give your agents a number people could call.">
        <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
          <PlusIcon className="h-4 w-4" aria-hidden />
          Get a number
        </Button>
      </SectionHeader>
      <SandboxNote>{SANDBOX_COPY.numbers}</SandboxNote>
      {data.numbers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center">
          <HashIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">No test numbers yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">Get a number to start simulating inbound calls. You can add more later.</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAdding(true)}>
            Get a test number
          </Button>
        </div>
      ) : (
        <>
          {data.rules.length === 0 && (
            <Callout action={{ label: 'Create dispatch rule', onClick: () => onSection('dispatch') }}>
              These numbers aren’t routed to an agent yet. Add a dispatch rule so calls reach one of your agents.
            </Callout>
          )}
          <TelephonyTable
            title="Test numbers"
            columns={['Number', 'Label', 'Country', 'Dispatch rule', 'Added']}
            rows={rows}
            monoFirst
            itemLabel="test number"
            deleteLabel="Release"
            deleteWords={(id) => `${data.numbers.find((n) => n.id === id)?.number ?? 'It'} is removed from this browser, and any rule that used it becomes unassigned. This can’t be undone.`}
            onDelete={release}
            empty={{ icon: HashIcon, title: 'No test numbers yet' }}
          />
        </>
      )}

      <section className="space-y-1 border-t border-line pt-6" aria-labelledby="sandbox-api-numbers">
        <h2 id="sandbox-api-numbers" className="text-lg font-semibold text-ink">
          Numbers set up for an agent
        </h2>
        <p className="max-w-2xl text-[13px] text-muted">
          The phone numbers part of the Agent Builder API, as Library › Phone numbers shows it. In Sandbox it is answered by an imitation kept in this browser, so
          setting one up connects nothing.
        </p>
        <NumbersPanel />
      </section>

      {adding && (
        <NumberDialog
          existing={data.numbers.map((n) => n.number)}
          onClose={() => setAdding(false)}
          onCreate={(number) => {
            updateTelephony((d) => ({ ...d, numbers: [...d.numbers, number] }));
            toast.success(`Test number ${number.number} added`, { description: number.label ? `Labelled “${number.label}”.` : 'Add a dispatch rule to route its calls.' });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function NumberDialog({ existing, onClose, onCreate }: { existing: string[]; onClose: () => void; onCreate: (n: TestNumber) => void }) {
  const [code, setCode] = useState('US');
  const [area, setArea] = useState('');
  const [label, setLabel] = useState('');
  const [sent, setSent] = useState(false);
  const country = COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
  const areaError = areaCodeError(country, area);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    if (areaError) return;
    const now = new Date();
    onCreate({ id: makeId('PN', Math.random, now.getTime()), number: generateTestNumber(country, area, existing), country: country.code, label: label.trim(), createdAt: now.toISOString() });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Get a test number"
      description="Pick a country and, if you like, an area code."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="sandbox-number-form">
            Get number
          </Button>
        </>
      }
    >
      <form id="sandbox-number-form" noValidate onSubmit={submit} className="space-y-4">
        <SandboxNote title="Sandbox">{SANDBOX_COPY.dialog}</SandboxNote>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Country">
            <select
              className={fieldClass()}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setArea('');
              }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.dial})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Area code (optional)" error={sent && areaError} hint={country.example ? `e.g. ${country.example}` : 'Not used for this country'}>
            <input
              inputMode="numeric"
              className={cn(fieldClass(sent && areaError))}
              value={area}
              onChange={(e) => setArea(e.target.value.trim())}
              placeholder={country.example || '—'}
              disabled={!country.example}
              maxLength={4}
            />
          </FormField>
        </div>
        <FormField label="Label (optional)" hint="Helps your team recognise what the number is for.">
          <input className={fieldClass()} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Support hotline" maxLength={40} />
        </FormField>
        <p className="text-[13px] text-muted">A test number is taken from a range reserved for fictional use. It is kept in this browser and can’t receive real calls.</p>
      </form>
    </Dialog>
  );
}
