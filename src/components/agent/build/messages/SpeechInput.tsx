import React from 'react';
import type { AgentConfig } from '../../../../types/studio';
import { messagesOf, speechText } from '../../../../models/messages';
import { cn, inputClass } from '../../../../utils/styles';

/**
 * Something the agent says: typed here, or one of its fixed lines ({ message: id }). Empty typed text gives undefined,
 * so the caller can take the part away.
 */
export function SpeechInput({ id, value, config, onChange, disabled, placeholder, label }: { id?: string; value: unknown; config: AgentConfig; onChange: (v: string | { message: string } | undefined) => void; disabled?: boolean; placeholder?: string; label: string }) {
  const lines = messagesOf(config);
  const ref = typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string' ? (value as { message: string }).message : '';
  return (
    <div className="flex flex-wrap gap-2">
      {lines.length > 0 &&
      <select
        aria-label={`${label}: typed or a fixed line`}
        className={cn(inputClass, 'w-auto max-w-[14rem]')}
        value={ref ? `m:${ref}` : 'typed'}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'typed') onChange(speechText(value, config) || undefined);
          else onChange({ message: v.slice(2) });
        }}>
          <option value="typed">Typed here</option>
          {lines.map((m) =>
        <option key={m.id} value={`m:${m.id}`}>
              Fixed line “{m.id}”
            </option>
        )}
        </select>
      }
      {ref ?
      <p className="min-w-[200px] flex-1 self-center text-[13px] text-ink-soft">“{speechText(value, config) || '…'}”</p> :

      <input
        id={id}
        aria-label={label}
        className={cn(inputClass, 'min-w-[220px] flex-1')}
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : undefined)} />

      }
    </div>);

}
