import React, { useMemo } from 'react';
import Icon from '../../../ui/Icon.jsx';
import SimpleKey from '../../simple/SimpleKey.jsx';
import { languageName, readSimple, setPrimaryLanguage, toggleSpoken } from '../../simple/simpleModel.js';
import PickerPopover from './PickerPopover.jsx';
import { extraLanguageOptions, languageBadge, mainLanguageOptions, setLanguageField, spokenChips } from './pickerLogic.js';
import { BASE_LANGUAGES } from '../../simple/simpleModel.js';
import './pickers.css';

// An agent's languages, one decision each: the main language (a searchable list) and the other languages it speaks
// (chips you can remove; "Add a language" lists the rest).
//   brief: only those two (the guided setup); the languages it only recognises stay on the Agent page
export default function LanguagePicker({ config, set, brief = false }) {
  const read = readSimple(config);
  const [mainQuery, setMainQuery] = React.useState('');
  const [extraQuery, setExtraQuery] = React.useState('');
  const [hearQuery, setHearQuery] = React.useState('');
  const lang = config?.defaults?.language || {};
  const understood = Array.isArray(lang.also_understands) ? lang.also_understands.filter((c) => typeof c === 'string') : [];
  const hearOptions = extraLanguageOptions({ primary: read.primaryLanguage, speaks: [...read.speaks, ...understood], query: hearQuery });
  const nameOf = (code) => BASE_LANGUAGES.find((l) => l.code === code)?.name || languageName(code);
  const chips = useMemo(() => spokenChips({ primary: read.primaryLanguage, speaks: read.speaks }), [read.primaryLanguage, read.speaks]);
  const main = mainLanguageOptions(mainQuery);
  const mainLabel = read.primaryLanguage ? languageName(read.primaryLanguage) : '';
  const extras = extraLanguageOptions({ primary: read.primaryLanguage, speaks: read.speaks, query: extraQuery });

  return (
    <div className="pkPicker">
      <section className="pkBlock">
        <header>
          <h3>
            Main language <SimpleKey path={['defaults', 'language', 'primary']} />
          </h3>
          <p>The language it speaks first, and the one the fixed lines (greeting, goodbye) are written in.</p>
        </header>
        <PickerPopover
          label="Main language"
          placeholder="Search languages"
          options={main}
          selected={read.primaryLanguage ? [read.primaryLanguage] : []}
          query={mainQuery}
          onQuery={setMainQuery}
          onPick={(code) => set(setPrimaryLanguage(config, code))}
          className="pkWide"
          trigger={
            read.primaryLanguage ? (
              <span className="pkValue">
                <span className="pkBadge" aria-hidden="true">
                  {languageBadge(read.primaryLanguage)}
                </span>
                <span className="pkValueText">
                  <strong>{mainLabel}</strong>
                  <small>{read.primaryLanguage}</small>
                </span>
              </span>
            ) : (
              <span className="pkValue empty">Choose the main language</span>
            )
          }
        />
      </section>

      <section className="pkBlock">
        <header>
          <h3>
            Also speaks <SimpleKey path={['defaults', 'language', 'speaks']} />
          </h3>
          <p>Other languages it can answer in. Fixed lines (the greeting, the goodbye) need a text in each.</p>
        </header>
        <ul className="pkChips" aria-label="Languages it speaks">
          {chips.map((chip) => (
            <li key={chip.code} className={chip.main ? 'main' : ''}>
              <span className="pkBadge" aria-hidden="true">
                {languageBadge(chip.code)}
              </span>
              <span>{chip.name}</span>
              {chip.main ? (
                <em>main</em>
              ) : (
                <button type="button" aria-label={`Remove ${chip.name}`} onClick={() => set(toggleSpoken(config, chip.code, false))}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </li>
          ))}
          {chips.length === 0 && <li className="none">Only the main language, once you choose one.</li>}
        </ul>
        <PickerPopover
          label="Add a language"
          placeholder="Search languages"
          options={extras}
          multi
          query={extraQuery}
          onQuery={setExtraQuery}
          emptyText={extraQuery ? 'Nothing matches' : 'Every language is added'}
          onPick={(code) => set(toggleSpoken(config, code, true))}
          className="pkAdd"
          trigger={
            <span className="pkAddLabel">
              <Icon name="plus" size={14} />
              Add a language
            </span>
          }
        />
        {/* in the setup, the greeting and goodbye are written below for each language */}
        {!brief && <p className="pkNote">Write the fixed lines for each language under “Fixed lines” on the Agent page.</p>}
      </section>

      {!brief && (
        <section className="pkBlock">
          <header>
            <h3>
              Recognising callers <SimpleKey path={['defaults', 'language', 'also_understands']} />
            </h3>
            <p>Languages it can recognise from a caller without answering in them, and whether it switches to the caller’s language by itself.</p>
          </header>
          <label className="pkSwitch">
            <input
              type="checkbox"
              checked={lang.auto_detect === true}
              onChange={(event) => set(setLanguageField(config, 'auto_detect', event.target.checked))}
              aria-label="Detect the caller’s language automatically"
            />
            <span>
              Detect the caller’s language automatically <small>Switch to it when it can tell.</small>
            </span>
          </label>
          <ul className="pkChips" aria-label="Languages it only understands">
            {understood.map((code) => (
              <li key={code}>
                <span className="pkBadge" aria-hidden="true">
                  {languageBadge(code)}
                </span>
                <span>{nameOf(code)}</span>
                <button
                  type="button"
                  aria-label={`Stop recognising ${nameOf(code)}`}
                  onClick={() =>
                    set(
                      setLanguageField(
                        config,
                        'also_understands',
                        understood.filter((c) => c !== code),
                      ),
                    )
                  }
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
            {understood.length === 0 && <li className="none">None besides the languages it speaks.</li>}
          </ul>
          <PickerPopover
            label="Add a language to recognise"
            placeholder="Search languages"
            options={hearOptions}
            multi
            query={hearQuery}
            onQuery={setHearQuery}
            emptyText={hearQuery ? 'Nothing matches' : 'Every language is added'}
            onPick={(code) => set(setLanguageField(config, 'also_understands', [...understood, code]))}
            className="pkAdd"
            trigger={
              <span className="pkAddLabel">
                <Icon name="plus" size={14} />
                Recognise another language
              </span>
            }
          />
        </section>
      )}
    </div>
  );
}
