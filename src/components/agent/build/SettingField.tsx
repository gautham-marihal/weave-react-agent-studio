import React from 'react';
import type { AgentConfig, Issue, Path } from '../../../types/studio';
import type { SettingDef } from '../../../data/settingsCatalog';
import { Field } from '../../ui/Field';
import { Toggle } from '../../ui/Toggle';
import { fieldId, getAt, parsePath } from '../../../utils/path';
import { issuesAt } from '../../../utils/validate';
import { missingProviderKey, providerFollowUps, resolveOptions } from '../../../utils/settingOptions';
import { useProviders } from '../../../hooks/useProviders';
import { cn, inputClass, inputErrorClass } from '../../../utils/styles';

interface SettingFieldProps {
  def: SettingDef;
  config: AgentConfig;
  errors: Issue[];
  warnings: Issue[];
  technical: boolean;
  disabled: boolean;
  update: (path: Path, value: unknown) => void;
}

const PROVIDER_SOURCES = ['llm_providers', 'stt_providers', 'tts_providers'];

/** What a setting that is not in the config shows: the server decides its value. */
export const SERVER_DEFAULT = 'Server’s default';

/**
 * One setting, read from and written to its real config path (def.path) and nothing else. A setting that is not set
 * shows "Server's default"; clearing it removes the key, so the server's default applies again.
 */
export function SettingField({ def, config, errors, warnings, technical, disabled, update }: SettingFieldProps) {
  const { answer: providers, error: providersError } = useProviders();
  const path = parsePath(def.path);
  const value = getAt(config, path);
  const unset = value === undefined;

  const id = fieldId(def.path);
  const inputId = `${id}-input`;
  const error = issuesAt(errors, def.path)[0]?.message;
  const warnFromReport = issuesAt(warnings, def.path)[0]?.message;
  const missingKey = def.type === 'select' ? missingProviderKey(def.path, String(value ?? ''), providers) : null;
  const listUnavailable = providersError && def.optionsFrom && PROVIDER_SOURCES.includes(def.optionsFrom) ? `The provider list could not be loaded (${providersError}), so only the current choice is shown.` : undefined;
  const warning = warnFromReport ?? (missingKey ? `The server doesn’t have ${missingKey} yet. Tests and calls will fail until an admin adds it.` : listUnavailable);

  const onChange = (v: unknown) => {
    update(path, v);
    const follow = providerFollowUps[def.path];
    if (follow && typeof v === 'string') follow.apply(v, update);
  };

  const resetLink = !unset && !disabled && (
    <button
      type="button"
      onClick={() => update(path, undefined)}
      className="rounded text-[12px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      Use the server’s default
    </button>
  );

  if (def.type === 'toggle') {
    return (
      <div id={id} className="flex scroll-mt-28 items-start justify-between gap-6 rounded-md py-1 transition-[box-shadow] duration-200">
        <div className="min-w-0">
          <p className={cn('text-sm font-medium text-ink', technical && 'font-mono text-[13px]')}>{technical ? def.path : def.label}</p>
          <p className="mt-0.5 text-[13px] text-muted">{technical ? `${def.label} — ${def.help}` : def.help}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            {unset ? <span>Not set: {SERVER_DEFAULT.toLowerCase()}</span> : resetLink}
          </p>
          {error && <p className="mt-1 text-[13px] text-danger" role="alert">{error}</p>}
          {warning && <p className="mt-1 text-[13px] text-warning">{warning}</p>}
        </div>
        <Toggle id={inputId} checked={value === true} onChange={onChange} label={def.label} disabled={disabled} />
      </div>);

  }

  let control: React.ReactNode;
  const cls = cn(inputClass, error && inputErrorClass);
  if (def.type === 'textarea') {
    control = <textarea id={inputId} rows={4} className={cn(cls, 'resize-y leading-relaxed')} value={typeof value === 'string' ? value : ''} placeholder={unset ? SERVER_DEFAULT : undefined} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />;
  } else if (def.type === 'lines') {
    const lines = Array.isArray(value) ? value.map(String) : [];
    control =
    <textarea
      id={inputId}
      rows={Math.max(3, lines.length + 1)}
      className={cn(cls, 'resize-y leading-relaxed')}
      value={lines.join('\n')}
      placeholder={unset ? `${SERVER_DEFAULT}: none` : undefined}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value.split('\n'))}
      onBlur={() => {
        const kept = lines.map((l) => l.trim()).filter(Boolean);
        if (kept.length !== lines.length || kept.some((l, i) => l !== lines[i])) onChange(kept.length ? kept : undefined);
      }} />;

  } else if (def.type === 'number') {
    control =
    <div className="flex items-center gap-2">
        <input
        id={inputId}
        type="number"
        min={def.min}
        max={def.max}
        className={cn(cls, 'w-40')}
        value={typeof value === 'number' ? value : ''}
        placeholder={unset ? SERVER_DEFAULT : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />

        {def.unit && <span className="text-sm text-muted">{def.unit}</span>}
      </div>;

  } else if (def.type === 'select') {
    const options = resolveOptions(def, config, providers);
    const selected = unset ? '' : String(value);
    const known = unset || options.some((o) => o.value === selected);
    control =
    <select id={inputId} className={cls} value={selected} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
        <option value="">{SERVER_DEFAULT}</option>
        {!known && <option value={selected}>{selected} (not in the list)</option>}
        {options.map((o) =>
      <option key={o.value} value={o.value}>{o.label}</option>
      )}
      </select>;

  } else {
    control = <input id={inputId} type="text" className={cn(cls, technical && def.level === 'expert' && 'font-mono')} value={typeof value === 'string' ? value : ''} placeholder={unset ? SERVER_DEFAULT : undefined} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />;
  }

  return (
    <Field id={id} label={def.label} help={def.help} error={error} warning={warning} technicalName={def.path} showTechnical={technical}>
      {control}
      {resetLink && def.type !== 'select' && <div className="mt-1.5">{resetLink}</div>}
    </Field>);

}
