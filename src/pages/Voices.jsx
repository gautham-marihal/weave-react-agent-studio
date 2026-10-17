import { VOICE_CATALOG } from '../voiceCatalog.js';
import { useEffect, useMemo, useState } from 'react';
import { loadConfigs } from '../studio/configCache.js';
import { voiceUsage } from '../studio/voiceUsage.js';
import { useVoicePreview } from './voicePreview.js';

const VOICE_LIBRARY = VOICE_CATALOG.map((voice) => ({
  ...voice,
  description: `${voice.style} ${voice.gender.toLowerCase()} voice for ${voice.language} conversations.`,
}));

export function VoicesWorkspace({ onAgents, onUseVoice, agents = [] }) {
  // Which agents speak with each voice comes from their saved configurations.
  const [configs, setConfigs] = useState({});
  useEffect(() => {
    let off = false;
    loadConfigs(agents.map((item) => item.id)).then((list) => {
      if (!off) setConfigs(Object.fromEntries(agents.map((item, index) => [item.id, list[index]])));
    });
    return () => {
      off = true;
    };
  }, [agents]);
  const usage = useMemo(() => voiceUsage(VOICE_LIBRARY, agents, configs), [agents, configs]);
  const [mode, setMode] = useState('default');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('All providers');
  const [language, setLanguage] = useState('All languages');
  const [gender, setGender] = useState('All genders');
  const sample = useVoicePreview();
  const [copied, setCopied] = useState('');
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('weave_voice_favorites') || '[]');
    } catch {
      return [];
    }
  });
  const filtered = VOICE_LIBRARY.filter((voice) => {
    const haystack = `${voice.name} ${voice.language} ${voice.style} ${voice.tags.join(' ')}`.toLowerCase();
    return (
      haystack.includes(query.trim().toLowerCase()) &&
      (provider === 'All providers' || voice.provider === provider) &&
      (language === 'All languages' || voice.language === language) &&
      (gender === 'All genders' || voice.gender.toLowerCase() === gender.toLowerCase())
    );
  });
  const languages = ['All languages', ...Array.from(new Set(VOICE_LIBRARY.map((voice) => voice.language)))];
  const copyId = async (voice) => {
    let done;
    try {
      await navigator.clipboard.writeText(voice.voiceId);
      done = true;
    } catch {
      // no clipboard API (a page on plain http) or it was refused: the old way, through a hidden box
      const box = document.createElement('textarea');
      box.value = voice.voiceId;
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      try {
        done = document.execCommand('copy');
      } catch {
        done = false;
      }
      box.remove();
    }
    setCopied(done ? voice.id : `failed:${voice.id}`);
    window.setTimeout(() => setCopied((now) => (now.endsWith(voice.id) ? '' : now)), done ? 1500 : 4000);
  };
  // a voice that is filtered away (or a tab that is left) must not go on talking with no button to stop it
  const { playing: nowPlaying, stop: stopSample } = sample;
  useEffect(() => {
    if (nowPlaying && (mode !== 'default' || !filtered.some((v) => v.id === nowPlaying))) stopSample();
  }, [nowPlaying, mode, filtered, stopSample]);
  const toggleFavorite = (id) =>
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try {
        localStorage.setItem('weave_voice_favorites', JSON.stringify(next));
      } catch {}
      return next;
    });
  return (
    <div className="workspaceFeaturePage">
      <section className="welcomeBlock pageHeaderBlock featureHero">
        <div>
          <div className="eyebrow cyan">VOICE LIBRARY</div>
          <h1>Voices</h1>
          <p>Explore provider voices, compare language and style, and choose the right voice for your agent.</p>
        </div>
        <button className="primaryCta createButton" type="button" onClick={onAgents}>
          Open agents <span className="buttonArrow">→</span>
        </button>
      </section>
      <div className="voiceWorkspaceTabs" role="tablist" aria-label="Voice library sections">
        <button role="tab" aria-selected={mode === 'default'} className={mode === 'default' ? 'active' : ''} onClick={() => setMode('default')}>
          <span>◫</span>
          <span>
            <strong>Default voices</strong>
            <small>Browse provider voice libraries</small>
          </span>
        </button>
        <button role="tab" aria-selected={mode === 'custom'} className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
          <span>◌</span>
          <span>
            <strong>Custom voices</strong>
            <small>Your own voice IDs and voice clones</small>
          </span>
          <em>Under development</em>
        </button>
      </div>
      {mode === 'custom' ? (
        <section className="customVoiceComing">
          <div className="customVoiceOrb">◌</div>
          <div className="eyebrow cyan">IN DEVELOPMENT</div>
          <h2>Custom voices are on the way</h2>
          <p>
            Voice cloning and workspace-managed custom voice uploads are not available yet. You can already use your provider's own voice ID: set it in an
            agent’s Config, under Models.
          </p>
          <button className="primaryCta" onClick={onAgents}>
            Open agents →
          </button>
        </section>
      ) : (
        <>
          <section className="featureToolbar voiceLibraryToolbar">
            <label className="featureSearch">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search voices by name, language or style"
                aria-label="Search voices"
              />
            </label>
            <select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Filter by provider">
              <option>All providers</option>
              <option>Cartesia</option>
              <option>ElevenLabs</option>
            </select>
            <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Filter by language">
              {languages.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select value={gender} onChange={(event) => setGender(event.target.value)} aria-label="Filter by voice gender">
              <option>All genders</option>
              <option>Female</option>
              <option>Male</option>
            </select>
          </section>
          <div className="featureSummary">
            <span>
              <b>{filtered.length}</b> curated voices · {VOICE_CATALOG.filter((voice) => provider === 'All providers' || voice.provider === provider).length}{' '}
              for selected provider
            </span>
            <span>The library’s voices play a recording of that voice. Cartesia’s recordings come from a public voice directory, not from Cartesia.</span>
          </div>
          {sample.note && (
            <p className="voicePreviewNote" role="status">
              {sample.note}
            </p>
          )}
          <div className="voiceTableWrap">
            <table className="voiceLibraryTable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Language</th>
                  <th>Gender</th>
                  <th>Provider</th>
                  <th>Style</th>
                  <th>Used by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((voice) => (
                  <tr key={voice.id}>
                    <td>
                      <div className="voiceTableName">
                        <span>{voice.name.slice(0, 1)}</span>
                        <div className="voiceNameStack">
                          <strong>{voice.name}</strong>
                          <span className="voiceIdCell">
                            <code title="The provider's id for this voice: this is what goes in the agent's configuration">{voice.voiceId}</code>
                            <button
                              type="button"
                              className="iconButton"
                              aria-label={`Copy the voice ID of ${voice.name}`}
                              title={copied === `failed:${voice.id}` ? 'Could not copy: select the ID and copy it' : 'Copy the voice ID'}
                              onClick={() => copyId(voice)}
                            >
                              {copied === voice.id ? '✓' : copied === `failed:${voice.id}` ? '!' : '⧉'}
                            </button>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {voice.language} <small>{voice.locale}</small>
                    </td>
                    <td>{voice.gender}</td>
                    <td>
                      <span className="voiceProviderTag">{voice.provider || 'Provider varies'}</span>
                    </td>
                    <td>{voice.style}</td>
                    <td>
                      {usage[voice.id]?.length ? (
                        <span className="voiceUsedBy" title={usage[voice.id].map((item) => item.name).join(', ')}>
                          {usage[voice.id].slice(0, 2).map((item) => (
                            <span key={item.id} className="voiceUsedChip">
                              {item.name}
                            </span>
                          ))}
                          {usage[voice.id].length > 2 && <span className="voiceUsedMore">+{usage[voice.id].length - 2}</span>}
                        </span>
                      ) : (
                        <span className="voiceUnused">Not in use</span>
                      )}
                    </td>
                    <td>
                      <div className="voiceTableActions">
                        <button
                          type="button"
                          className="iconButton"
                          title={sample.playing === voice.id ? 'Stop' : voice.previewUrl ? 'Hear the recorded sample' : 'Hear an approximation'}
                          aria-label={sample.playing === voice.id ? `Stop ${voice.name}` : `Listen to ${voice.name}`}
                          onClick={() => sample.play(voice)}
                        >
                          {sample.playing === voice.id ? 'Ⅱ' : '▶'}
                        </button>
                        <button
                          type="button"
                          className={`iconButton ${favorites.includes(voice.id) ? 'active' : ''}`}
                          title="Favorite"
                          onClick={() => toggleFavorite(voice.id)}
                        >
                          {favorites.includes(voice.id) ? '★' : '☆'}
                        </button>
                        <button
                          type="button"
                          className="secondaryCta"
                          onClick={() => {
                            try {
                              localStorage.setItem(
                                'weave_pending_voice',
                                JSON.stringify({ provider: voice.provider.toLowerCase(), name: voice.name, voiceId: voice.voiceId || '' }),
                              );
                            } catch {}
                            (onUseVoice || onAgents)(voice);
                          }}
                        >
                          Use in an agent
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <section className="emptyPanel featureEmpty">
              <div className="emptyPanelIcon">⌕</div>
              <h2>No voices found</h2>
              <p>Try changing your search or filters.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
