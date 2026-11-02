import React, { useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { BASE_LANGUAGES, languageName } from '../../../../models/languages';
import { extraLanguageOptions, languageBadge, mainLanguageOptions, readLanguages, setLanguageField, setMainLanguage, spokenChips, toggleSpoken } from '../../../../models/pickers';
import { Toggle } from '../../../ui/Toggle';
import { PickerPopover } from './PickerPopover';
import { PickerBlock } from './PickerBlock';

interface LanguagePickerProps {
  config: AgentConfig;
  set: (next: AgentConfig) => void;
  disabled?: boolean;
}

const nameOf = (code: string) => BASE_LANGUAGES.find((l) => l.code === code)?.name ?? languageName(code);

/**
 * An agent's languages, one decision each: the main language (a searchable list), the other languages it answers in
 * (chips, with "Add a language"), and whether it detects the caller's language, plus languages it only recognises.
 */
export function LanguagePicker({ config, set, disabled }: LanguagePickerProps) {
  const read = readLanguages(config);
  const [mainQuery, setMainQuery] = useState('');
  const [extraQuery, setExtraQuery] = useState('');
  const [hearQuery, setHearQuery] = useState('');
  const chips = spokenChips({ primary: read.primary, speaks: read.speaks });

  return (
    <div className="space-y-6">
      <PickerBlock title="Main language" path="defaults.language.primary" text="The language it speaks first, and the one its fixed lines (the greeting, the goodbye) are written in.">
        <PickerPopover
          label="Main language"
          placeholder="Search languages"
          options={mainLanguageOptions(mainQuery)}
          selected={read.primary ? [read.primary] : []}
          query={mainQuery}
          onQuery={setMainQuery}
          disabled={disabled}
          onPick={(code) => set(setMainLanguage(config, code))}
          trigger={
          read.primary ?
          <span className="flex items-center gap-2.5">
                <Badge code={read.primary} />
                <span className="min-w-0">
                  <strong className="block font-medium text-ink">{languageName(read.primary)}</strong>
                  <small className="block font-mono text-[11px] text-muted">{read.primary}</small>
                </span>
              </span> :

          <span className="text-muted">Choose the main language</span>
          } />
      </PickerBlock>

      <PickerBlock title="Also speaks" path="defaults.language.speaks" text="Other languages it can answer in. Its fixed lines need a text in each.">
        <ul aria-label="Languages it speaks" className="mb-3 flex flex-wrap gap-2">
          {chips.map((chip) =>
          <li key={chip.code} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1.5 pr-2 text-[13px] text-ink">
              <Badge code={chip.code} />
              <span>{chip.name}</span>
              {chip.main ?
            <em className="text-xs not-italic text-muted">main</em> :

            <button type="button" disabled={disabled} aria-label={`Remove ${chip.name}`} onClick={() => set(toggleSpoken(config, chip.code, false))} className="rounded-full p-0.5 text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <XIcon className="h-3 w-3" aria-hidden />
                </button>
            }
            </li>
          )}
          {chips.length === 0 && <li className="text-[13px] text-muted">Only the main language, once you choose one.</li>}
        </ul>
        <PickerPopover
          label="Add a language"
          placeholder="Search languages"
          options={extraLanguageOptions({ primary: read.primary, speaks: read.speaks, query: extraQuery })}
          multi
          query={extraQuery}
          onQuery={setExtraQuery}
          disabled={disabled}
          emptyText={extraQuery ? 'Nothing matches' : 'Every language is added'}
          onPick={(code) => set(toggleSpoken(config, code, true))}
          className="max-w-xs"
          trigger={
          <span className="inline-flex items-center gap-1.5 font-medium text-accent">
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              Add a language
            </span>
          } />
      </PickerBlock>

      <PickerBlock title="Recognising callers" path="defaults.language.also_understands" text="Languages it can recognise without answering in them, and whether it switches to the caller’s language by itself.">
        <div className="mb-3 flex items-start justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-3">
          <span>
            <span className="block text-sm font-medium text-ink">Detect the caller’s language automatically</span>
            <span className="block text-[13px] text-muted">Switch to it when it can tell.</span>
          </span>
          <Toggle checked={read.autoDetect} disabled={disabled} label="Detect the caller’s language automatically" onChange={(on) => set(setLanguageField(config, 'auto_detect', on))} />
        </div>
        <ul aria-label="Languages it only recognises" className="mb-3 flex flex-wrap gap-2">
          {read.alsoUnderstands.map((code) =>
          <li key={code} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1.5 pr-2 text-[13px] text-ink">
              <Badge code={code} />
              <span>{nameOf(code)}</span>
              <button
              type="button"
              disabled={disabled}
              aria-label={`Stop recognising ${nameOf(code)}`}
              onClick={() =>
              set(
                setLanguageField(
                  config,
                  'also_understands',
                  read.alsoUnderstands.filter((c) => c !== code)
                )
              )
              }
              className="rounded-full p-0.5 text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <XIcon className="h-3 w-3" aria-hidden />
              </button>
            </li>
          )}
          {read.alsoUnderstands.length === 0 && <li className="text-[13px] text-muted">None besides the languages it speaks.</li>}
        </ul>
        <PickerPopover
          label="Add a language to recognise"
          placeholder="Search languages"
          options={extraLanguageOptions({ primary: read.primary, speaks: [...read.speaks, ...read.alsoUnderstands], query: hearQuery })}
          multi
          query={hearQuery}
          onQuery={setHearQuery}
          disabled={disabled}
          emptyText={hearQuery ? 'Nothing matches' : 'Every language is added'}
          onPick={(code) => set(setLanguageField(config, 'also_understands', [...readLanguages(config).alsoUnderstands, code]))}
          className="max-w-xs"
          trigger={
          <span className="inline-flex items-center gap-1.5 font-medium text-accent">
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              Recognise another language
            </span>
          } />
      </PickerBlock>
    </div>);

}

function Badge({ code }: { code: string }) {
  return (
    <span className="inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded bg-accent-soft px-1 font-mono text-[10px] font-semibold text-accent" aria-hidden>
      {languageBadge(code)}
    </span>);

}
