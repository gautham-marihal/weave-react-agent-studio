import React, { useEffect, useState } from 'react';
import { toast } from '../../ui/Toast';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Toggle } from '../../ui/Toggle';
import { api } from '../../../api/client';
import type { NumberCheck, NumberSettings } from '../../../api/types';
import type { EnvironmentName } from '../../../types/studio';
import { envLabel } from '../../../utils/agentStatus';
import { cn, inputClass } from '../../../utils/styles';

interface AddNumberDialogProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  environments: string[];
  initialEnv?: string;
  onAdded: () => void;
}

/** "Add a number" for one agent: the number people dial, and the environment whose version answers it. The server sets
 *  up the phone line and its routing. */
export function AddNumberDialog({ open, onClose, agentId, agentName, environments, initialEnv, onAdded }: AddNumberDialogProps) {
  const [settings, setSettings] = useState<NumberSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [env, setEnv] = useState('');
  const [record, setRecord] = useState(true);
  const [check, setCheck] = useState<NumberCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNumber('');
    setCheck(null);
    setSaveError(null);
    setEnv(initialEnv ?? environments[0] ?? '');
    const controller = new AbortController();
    api
      .numberSettings({ signal: controller.signal })
      .then((s) => {
        setSettings(s);
        setRecord(s.defaults?.record_audio ?? true);
        setSettingsError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setSettingsError(err instanceof Error ? err.message : 'The phone settings could not be read.');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Ask the server whether the number is valid and free, shortly after typing stops.
  useEffect(() => {
    const value = number.trim();
    setCheck(null);
    if (!value) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setChecking(true);
      api
        .checkNumber(value, { signal: controller.signal })
        .then(setCheck)
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [number]);

  const free = check?.status === 'free';
  const ready = !!settings?.livekit_configured;
  const choices = settings?.environments?.length ? settings.environments : environments;

  const save = async () => {
    if (!free || !env || !ready) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.createNumber(agentId, { number: number.trim(), environment: env, record_audio: record });
      toast.success(`${number.trim()} now reaches ${agentName}`, { description: `${envLabel(env as EnvironmentName)} answers it.` });
      onAdded();
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'The server did not add the number.');
    } finally {
      setSaving(false);
    }
  };

  const checkLine = !number.trim() ? null : checking || !check ? 'Checking…' : check.status === 'free' ? 'Free to use.' : check.status === 'invalid' ? check.reason ?? 'Not a valid number.' : check.status === 'taken_external' ? `Already used outside Studio${check.owner?.trunk ? ` (line ${check.owner.trunk})` : ''}.` : `Already in use${check.owner?.bot ? ` by ${check.owner.bot}` : ''}.`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a number"
      description={`The number people dial to reach ${agentName}. The phone line and its routing are set up for you.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!free || !env || !ready || saving}>{saving ? 'Adding…' : 'Add number'}</Button>
        </>
      }>
      <div className="space-y-4">
        {settingsError && <p role="alert" className="text-[13px] text-danger">The phone settings could not be read ({settingsError}), so a number can’t be added now.</p>}
        {settings && !settings.livekit_configured && <p role="alert" className="text-[13px] text-warning">The server says the phone system is not set up, so numbers can be seen but not added from here.</p>}
        <label className="block">
          <span className="block text-xs font-medium text-ink-soft">Number</span>
          <input
            type="tel"
            inputMode="tel"
            className={cn(inputClass, 'mt-1 font-mono')}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            aria-describedby="release-number-check"
            title={settings ? `Must match ${settings.number_pattern}` : undefined} />
          {checkLine && <span id="release-number-check" aria-live="polite" className={cn('mt-1 block text-xs', free ? 'text-success' : checking || !check ? 'text-muted' : 'text-warning')}>{checkLine}</span>}
          {check?.warnings.map((w) => <span key={w} className="mt-1 block text-xs text-warning">{w}</span>)}
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink-soft">Environment that answers it</span>
          <select className={cn(inputClass, 'mt-1')} value={env} onChange={(e) => setEnv(e.target.value)}>
            {choices.map((e) => <option key={e} value={e}>{envLabel(e as EnvironmentName)}</option>)}
          </select>
          <span className="mt-1 block text-xs text-muted">Calls to it get the version deployed there.</span>
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink">Record the audio of calls to this number</span>
          <Toggle checked={record} onChange={setRecord} label="Record the audio of calls to this number" />
        </div>
        {saveError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">Not added: {saveError}</p>}
      </div>
    </Dialog>);
}
