import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../ui/Icon.jsx';
import SimpleKey from '../../simple/SimpleKey.jsx';
import { pickBrowserVoice } from '../../../pages/browserVoice.js';
import { applyVoice, readModels, setVoiceId } from '../../models/config.js';
import { providerLabel } from '../../models/catalog.js';
import { useProviders } from '../../models/useProviders.js';
import { filterVoices, voiceFilters, voiceHue, voiceInUse } from './pickerLogic.js';
import './pickers.css';

// Plays a short line with the browser's own speech voices (the real voice is the provider's, which the studio can't play without a call): the closest
// browser voice for the language and gender, and a note when it had to guess.
function useBrowserPreview() {
  const [playing, setPlaying] = useState('');
  const [note, setNote] = useState('');
  const [browserVoices, setBrowserVoices] = useState([]);
  const can = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => {
    if (!can) return undefined;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load);
      window.speechSynthesis.cancel();
    };
  }, [can]);
  const play = (voice) => {
    if (!can) return;
    window.speechSynthesis.cancel();
    if (playing === voice.id) {
      setPlaying('');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(`Hello, I'm ${voice.name}. How can I help you today?`);
    utterance.lang = voice.locale;
    utterance.rate = 0.96;
    const pick = pickBrowserVoice(browserVoices.length ? browserVoices : window.speechSynthesis.getVoices(), voice);
    if (pick.voice) utterance.voice = pick.voice;
    utterance.pitch = pick.pitch;
    setNote(
      pick.certain ? '' : `Your browser has no ${voice.gender.toLowerCase()} ${voice.language} voice, so this is only an approximation of ${voice.name}.`,
    );
    utterance.onend = () => setPlaying('');
    utterance.onerror = () => setPlaying('');
    setPlaying(voice.id);
    window.speechSynthesis.speak(utterance);
  };
  return { can, playing, note, play };
}

// The voice of an agent, chosen from a list: search, filter by engine, gender and language, listen, and pick. Picking a voice also sets the engine it
// belongs to (and that engine's model), which the line under the list says.
export default function VoicePicker({ config, set }) {
  const { providers } = useProviders();
  const tts = readModels(config).tts;
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('');
  const [engine, setEngine] = useState('');
  const [language, setLanguage] = useState('');
  const filters = useMemo(() => voiceFilters(), []);
  const [opened] = useState(() => tts); // the order is worked out from the voice the panel opened with, so the list does not jump when one is picked
  const inUse = voiceInUse(tts);
  const voices = useMemo(() => filterVoices({ query, gender, engine, language, current: opened }), [query, gender, engine, language, opened]);
  const preview = useBrowserPreview();
  const [justSet, setJustSet] = useState('');
  const custom = !!tts.voiceId && !inUse;
  const offered = (name) => providers.some((p) => p.name === name && (p.stages || []).includes('tts') && p.installed !== false);

  const choose = (voice) => {
    const switching = voice.engine !== String(tts.provider).toLowerCase();
    set(applyVoice(config, { provider: voice.engine, voiceId: voice.voiceId }, providers));
    setJustSet(switching ? `${voice.name} is an ${voice.engineName} voice, so the voice engine is now ${voice.engineName}.` : '');
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
            <strong>No voice chosen yet</strong>
            <small>Pick one below. Listen first with the play button.</small>
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
            <select value={gender} onChange={(event) => setGender(event.target.value)} aria-label="Gender">
              <option value="">Any</option>
              {filters.genders.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Engine</span>
            <select value={engine} onChange={(event) => setEngine(event.target.value)} aria-label="Engine">
              <option value="">Any</option>
              {filters.engines.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Language of the voice">
              <option value="">Any</option>
              {filters.languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
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
      {preview.can ? <p className="pkNote">Listening uses your browser’s own voices, so it only gives an idea; the real voice is the engine’s.</p> : null}

      <details className="pkOwn" open={custom || undefined}>
        <summary>A voice from your own account</summary>
        <div className="pkOwnBody">
          <label htmlFor="pk-voice-id">Voice id</label>
          <input
            id="pk-voice-id"
            className="stFInput mono"
            type="text"
            spellCheck={false}
            value={tts.voiceId}
            placeholder="The voice id shown by your provider"
            onChange={(event) => set(setVoiceId(config, event.target.value))}
            aria-label="Voice id"
          />
          <small>{tts.provider ? `Used with ${providerLabel(tts.provider)}.` : 'Pick any voice above first, to choose the engine this id is used with.'}</small>
        </div>
      </details>
    </div>
  );
}
