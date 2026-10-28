import React, { useEffect, useId, useMemo, useState } from 'react';
import Fold from '../../../ui/Fold.jsx';
import Icon from '../../../ui/Icon.jsx';
import SimpleKey from '../../simple/SimpleKey.jsx';
import { useVoicePreview } from '../../../pages/voicePreview.js';
import { applyVoice, readModels, setVoiceId } from '../../models/config.js';
import { withArticle } from '../../form/channelTypes.js';
import { providerLabel } from '../../models/catalog.js';
import { useProviders } from '../../models/useProviders.js';
import { languageName, readSimple } from '../../simple/simpleModel.js';
import { filterVoices, voiceFilters, voiceHue, voiceInUse } from './pickerLogic.js';
import Select from '../../../ui/Select.tsx';
import './pickers.css';
import { Input } from '../../../ui/Input.tsx';

// An agent's voice, chosen from a list: search, filter, listen and pick. Picking a voice also sets its engine (and that
// engine's model), noted under the list. The list opens filtered to the main language, with the voice in use on top.
//   speech: whether it talks anywhere (phone or website); an agent that only chats needs no voice yet
export default function VoicePicker({ config, set, speech = true }) {
  const voiceIdBox = useId();
  const { providers } = useProviders();
  const tts = readModels(config).tts;
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('');
  const [engine, setEngine] = useState('');
  const filters = useMemo(() => voiceFilters(), []);
  const [language, setLanguage] = useState(() => {
    const main = languageName(readSimple(config).primaryLanguage);
    return filters.languages.includes(main) ? main : '';
  });
  const [opened] = useState(() => tts); // ordered by the voice the panel opened with, so the list doesn't jump on a pick
  const inUse = voiceInUse(tts);
  const voices = useMemo(() => filterVoices({ query, gender, engine, language, current: opened }), [query, gender, engine, language, opened]);
  const preview = useVoicePreview();
  // stop a sample hidden by a search or filter (unless it is the voice in use), so it never plays without a stop button
  const { playing: playingId, stop: stopSample } = preview;
  useEffect(() => {
    if (playingId && playingId !== inUse?.id && !voices.some((v) => v.id === playingId)) stopSample();
  }, [playingId, inUse, voices, stopSample]);
  const [justSet, setJustSet] = useState('');
  const custom = !!tts.voiceId && !inUse;
  const offered = (name) => providers.some((p) => p.name === name && (p.stages || []).includes('tts') && p.installed !== false);

  const choose = (voice) => {
    const switching = voice.engine !== String(tts.provider).toLowerCase();
    set(applyVoice(config, { provider: voice.engine, voiceId: voice.voiceId }, providers));
    setJustSet(switching ? `${voice.name} is ${withArticle(voice.engineName)} voice, so the voice engine is now ${voice.engineName}.` : '');
  };
  const clear = () => {
    setQuery('');
    setGender('');
    setEngine('');
    setLanguage('');
  };
  const filtered = !!(query || gender || engine || language);

  return (
    <div className="pkPicker">
      <section className="pkNow" aria-label="The voice now">
        {tts.voiceId ? (
          <>
            <span className="pkAvatar" style={{ '--hue': voiceHue(inUse?.name || tts.voiceId) }} aria-hidden="true">
              {(inUse?.name || 'V')[0]}
            </span>
            <span className="pkNowText">
              <strong>{inUse ? inUse.name : 'A voice from your own account'}</strong>
              <small>
                {inUse
                  ? `${inUse.style} · ${inUse.language} · ${inUse.engineName}`
                  : `${tts.voiceId}${tts.provider ? ` · ${providerLabel(tts.provider)}` : ''}`}
              </small>
            </span>
            {inUse && preview.can && (
              <button
                type="button"
                className="pkPlay"
                aria-label={preview.playing === inUse.id ? `Stop ${inUse.name}` : `Listen to ${inUse.name}`}
                onClick={() => preview.play(inUse)}
              >
                <Icon name={preview.playing === inUse.id ? 'stop' : 'play'} size={14} />
              </button>
            )}
          </>
        ) : (
          <span className="pkNowText">
            <strong>{speech ? 'No voice chosen yet' : 'Not needed while it only chats'}</strong>
            <small>{speech ? 'Pick one below.' : 'Choose one for phone calls or talking on your website.'} Listen first with the play button.</small>
          </span>
        )}
        <SimpleKey path={['defaults', 'models', 'tts', 'voice_id']} />
      </section>

      <div className="pkTools">
        <input
          className="pkSearch big"
          type="search"
          value={query}
          placeholder="Search voices by name, style or language"
          aria-label="Search voices"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="pkFilters" role="group" aria-label="Filter voices">
          <label>
            <span>Gender</span>
            <Select value={gender} onChange={(event) => setGender(event.target.value)} aria-label="Gender">
              <option value="">Any</option>
              {filters.genders.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span>Engine</span>
            <Select value={engine} onChange={(event) => setEngine(event.target.value)} aria-label="Engine">
              <option value="">Any</option>
              {filters.engines.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span>Language</span>
            <Select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Language of the voice">
              <option value="">Any</option>
              {filters.languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          {filtered && (
            <button type="button" className="linkButton" onClick={clear}>
              Clear
            </button>
          )}
        </div>
      </div>

      <ul className="pkVoices" aria-label="Voices">
        {voices.map((voice) => {
          const on = voice.voiceId === tts.voiceId && voice.engine === String(tts.provider).toLowerCase();
          return (
            <li key={voice.id} className={on ? 'on' : ''}>
              <button
                type="button"
                className="pkVoiceMain"
                aria-pressed={on}
                aria-label={`${on ? 'Using' : 'Use'} ${voice.name}, ${voice.style}, ${voice.language}, ${voice.engineName}`}
                onClick={() => choose(voice)}
              >
                <span className="pkAvatar" style={{ '--hue': voiceHue(voice.name) }} aria-hidden="true">
                  {voice.name[0]}
                </span>
                <span className="pkVoiceText">
                  <strong>{voice.name}</strong>
                  <small>
                    {voice.style} · {voice.gender}
                  </small>
                  <small>{voice.language}</small>
                </span>
                <span className="pkEngine">
                  {voice.engineName}
                  {!offered(voice.engine) && providers.length > 0 ? <em title="This server can’t run this engine yet"> · not on this server</em> : null}
                </span>
                {on && (
                  <span className="pkTick" aria-hidden="true">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </button>
              {preview.can && (
                <button
                  type="button"
                  className="pkPlay"
                  aria-label={preview.playing === voice.id ? `Stop ${voice.name}` : `Listen to ${voice.name}`}
                  onClick={() => preview.play(voice)}
                >
                  <Icon name={preview.playing === voice.id ? 'stop' : 'play'} size={14} />
                </button>
              )}
            </li>
          );
        })}
        {voices.length === 0 && (
          <li className="pkNone">
            No voice matches.{' '}
            <button type="button" className="linkButton" onClick={clear}>
              Clear the search
            </button>
          </li>
        )}
      </ul>
      {justSet && (
        <p className="pkNote" role="status">
          {justSet}
        </p>
      )}
      {preview.note && <p className="pkNote">{preview.note}</p>}
      {preview.can ? (
        <p className="pkNote">Library voices play a recording of that voice. Cartesia’s recordings come from a public voice directory, not from Cartesia.</p>
      ) : null}

      <Fold className="pkOwn" open={custom}>
        <summary>A voice from your own account</summary>
        <div className="pkOwnBody">
          <label htmlFor={voiceIdBox}>Voice id</label>
          <Input
            id={voiceIdBox}
            mono
            type="text"
            spellCheck={false}
            value={tts.voiceId}
            placeholder="The voice id shown by your provider"
            // a voice id needs an engine, so the engine comes first (an id already typed can still be cleared)
            disabled={!tts.provider && !tts.voiceId}
            onChange={(event) => set(setVoiceId(config, event.target.value))}
            aria-label="Voice id"
          />
          <small>{tts.provider ? `Used with ${providerLabel(tts.provider)}.` : 'Pick any voice above first, to choose the engine this id is used with.'}</small>
        </div>
      </Fold>
    </div>
  );
}
