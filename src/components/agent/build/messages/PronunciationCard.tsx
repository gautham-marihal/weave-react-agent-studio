import React from 'react';
import { Trash2Icon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import {
  PRONUNCIATION_KINDS,
  addRule,
  entriesToText,
  moveRule,
  pronunciationOf,
  pronunciationWords,
  removeRule,
  ruleWords,
  setApplyTo,
  setRule,
  textToEntries,
  type RuleType,
} from '../../../../models/messagesSpeech';
import { Button } from '../../../ui/Button';
import { Segmented } from '../../../ui/Segmented';
import { cn, inputClass } from '../../../../utils/styles';
import { AddChoices, Card, LinesInput } from './parts';
import { useDeleted } from './useDeleted';
import { SortableList } from './SortableList';
import { TrySpeech } from '../try/TrySpeech';

type Json = Record<string, unknown>;

/** How written text is said aloud: the rules in order, which speech goes through them, and "Try a line" (POST /preview/speech). */
export function PronunciationCard({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  const { notice, remember } = useDeleted(editor);
  if (!config) return null;
  const disabled = !editor.canEdit;
  const { rules, applyTo } = pronunciationOf(config);
  const set = (i: number, patch: Json) => editor.replaceConfig(setRule(config, i, patch));

  return (
    <Card title="How it says things aloud" text="Rules that turn written text into how it should be said: amounts, times, codes, words a voice reads wrongly. They apply in order, to what the voice is given only; the transcript keeps the words as written.">
      <div className="space-y-3">
        {notice}
        {rules.length > 0 &&
        <SortableList ids={rules.map((r, i) => `${String(r.id ?? r.type)}-${i}`)} nameOf={(i) => `rule ${i + 1}`} disabled={disabled} onMove={(from, to) => editor.replaceConfig(moveRule(config, from, to))}>
            {(i, handle) => {
            const r = rules[i];
            return (
              <div className="rounded-lg border border-line px-3 py-3" data-rule={i}>
                  <div className="flex items-center gap-2">
                    {handle}
                    <span className="text-xs font-medium text-muted">{i + 1}.</span>
                    <p className="min-w-0 flex-1 text-sm text-ink">{pronunciationWords(r)}</p>
                    <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Delete rule ${i + 1}`}
                    onClick={() => {
                      remember(`Rule ${i + 1} (${ruleWords(r.type)}) deleted.`, config);
                      editor.replaceConfig(removeRule(config, i));
                    }}>
                      <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                  <RuleFields rule={r} index={i} disabled={disabled} set={set} />
                </div>);

          }}
          </SortableList>
        }
        <AddChoices label="Add a rule" disabled={disabled} choices={PRONUNCIATION_KINDS.map((k) => ({ id: k.type, label: k.label, help: k.help }))} onPick={(id) => editor.replaceConfig(addRule(config, id as RuleType))} />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-[13px] text-ink-soft">What goes through the rules</span>
          <Segmented
            size="sm"
            label="What goes through the rules"
            value={applyTo || 'default'}
            options={[
            { value: 'default', label: 'Server’s default' },
            { value: 'model', label: 'The AI’s own words' },
            { value: 'all', label: 'Fixed lines too' }]
            }
            onChange={(v) => !disabled && editor.replaceConfig(setApplyTo(config, v === 'default' ? '' : (v as 'model' | 'all')))} />
        </div>
        <TrySpeech config={config} />
      </div>
    </Card>);

}

/** The few fields each kind of rule has, in words. */
function RuleFields({ rule, index, disabled, set }: { rule: Json; index: number; disabled: boolean; set: (i: number, patch: Json) => void }) {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const numIn = (key: string, label: string, min: number, placeholder: string) =>
  <label className="flex items-center gap-2 text-[13px] text-muted">
      {label}
      <input type="number" min={min} className={cn(inputClass, 'h-8 w-20 py-1')} value={typeof rule[key] === 'number' ? String(rule[key]) : ''} placeholder={placeholder} disabled={disabled} onChange={(e) => set(index, { [key]: e.target.value === '' ? undefined : Math.max(min, Math.round(Number(e.target.value))) })} />
    </label>;

  const textIn = (key: string, label: string, mono = false, placeholder = '') =>
  <label className="flex min-w-[200px] flex-1 items-center gap-2 text-[13px] text-muted">
      {label}
      <input className={cn(inputClass, 'h-8 flex-1 py-1 text-[13px]', mono && 'font-mono')} value={str(rule[key])} placeholder={placeholder} disabled={disabled} spellCheck={!mono} onChange={(e) => set(index, { [key]: e.target.value })} />
    </label>;

  let body: React.ReactNode = null;
  switch (rule.type) {
    case 'dictionary':
      body =
      <div>
          <p className="mb-1 text-[13px] text-muted">One per line: how it is written = how to say it.</p>
          <DictionaryBox value={rule.entries} disabled={disabled} onChange={(entries) => set(index, { entries })} />
        </div>;

      break;
    case 'replace':
      body =
      <div className="flex flex-wrap gap-3">
          {textIn('pattern', 'Find', true, '\\bSMS\\b')}
          {textIn('replacement', 'Say instead', false, 'text message')}
        </div>;

      break;
    case 'spell':
      body = <div className="flex flex-wrap gap-3">{textIn('pattern', 'What to spell out', true, '\\b(TK|INC)-?\\d{4,8}\\b')}</div>;
      break;
    case 'digits':
      body =
      <div className="flex flex-wrap gap-4">
          {numIn('min_length', 'Numbers of at least', 2, '6')}
          {numIn('group_size', 'digits, in groups of', 1, '4')}
          {textIn('plus_prefix', 'A leading + is said', false, 'plus ')}
        </div>;

      break;
    case 'currency':
      body =
      <div className="flex flex-wrap gap-3">
          <div className="min-w-[200px] flex-1">
            <p className="mb-1 text-[13px] text-muted">Symbols or codes before an amount, one per line</p>
            <LinesInput label="Symbols or codes before an amount" value={Array.isArray(rule.symbols) ? rule.symbols.map(String) : []} disabled={disabled} onChange={(v) => set(index, { symbols: v.length ? v : undefined })} />
          </div>
          {textIn('major_unit', 'Main unit', false, 'dollars')}
          {textIn('minor_unit', 'Smaller unit', false, 'cents')}
        </div>;

      break;
    default:
      return null;
  }
  return <div className="mt-2 pl-7">{body}</div>;
}

function DictionaryBox({ value, onChange, disabled }: { value: unknown; onChange: (v: Record<string, string>) => void; disabled: boolean }) {
  const [text, setText] = React.useState(entriesToText(value));
  return (
    <textarea
      aria-label="Words and how to say them"
      rows={Math.max(2, Math.min(8, text.split('\n').length))}
      className={cn(inputClass, 'resize-y font-mono text-[13px]')}
      value={text}
      disabled={disabled}
      placeholder={'Nimbus = Nim-bus\nAcme = Ack-me'}
      onChange={(e) => {
        setText(e.target.value);
        onChange(textToEntries(e.target.value));
      }} />);


}
