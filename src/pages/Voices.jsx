import { VOICE_CATALOG } from '../voiceCatalog.js';
import { useEffect, useMemo, useState } from 'react';
import { loadConfigs } from '../studio/configCache.js';
import { voiceUsage } from '../studio/voiceUsage.js';
import { pickBrowserVoice } from './browserVoice.js';

const VOICE_LIBRARY = VOICE_CATALOG.map((voice) => ({
  ...voice,
  description: `${voice.style} ${voice.gender.toLowerCase()} voice for ${voice.language} conversations.`,
}));

export function VoicesWorkspace({ onAgents, onUseVoice, agents = [] }) {
  // Which agents speak with each voice comes from their saved configurations.
  const [configs, setConfigs] = useState({});
  useEffect(() => {
    let off = false;
    loadConfigs(agents.map((item) => item.id)).then((list) => { if (!off) setConfigs(Object.fromEntries(agents.map((item, index) => [item.id, list[index]]))); });
    return () => { off = true; };
  }, [agents]);
  const usage = useMemo(() => voiceUsage(VOICE_LIBRARY, agents, configs), [agents, configs]);
  const [mode, setMode] = useState('default');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('All providers');
  const [language, setLanguage] = useState('All languages');
  const [gender, setGender] = useState('All genders');
  const [playing, setPlaying] = useState(null);
  const [previewNote, setPreviewNote] = useState('');
  // the browser's installed voices; they load a moment after the page does
  const [browserVoices, setBrowserVoices] = useState([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, []);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('weave_voice_favorites') || '[]'); } catch { return []; }
  });
  const filtered = VOICE_LIBRARY.filter((voice) => {
    const haystack = `${voice.name} ${voice.language} ${voice.style} ${voice.tags.join(' ')}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase()) &&
      (provider === 'All providers' || voice.provider === provider) &&
      (language === 'All languages' || voice.language === language) &&
      (gender === 'All genders' || voice.gender.toLowerCase() === gender.toLowerCase());
  });
  const languages = ['All languages', ...Array.from(new Set(VOICE_LIBRARY.map((voice) => voice.language)))];
  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);
  const preview = (voice) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (playing === voice.id) { setPlaying(null); return; }
    const utterance = new SpeechSynthesisUtterance(`Hello, I'm ${voice.name}. How can I help you today?`);
    utterance.lang = voice.locale;
    utterance.rate = 0.96;
    // a female voice is played with a female browser voice and a male one with a male one; when the browser has none of that gender the
    // pitch is nudged and the note below the table says so
    const pick = pickBrowserVoice(browserVoices.length ? browserVoices : window.speechSynthesis.getVoices(), voice);
    if (pick.voice) utterance.voice = pick.voice;
    utterance.pitch = pick.pitch;
    setPreviewNote(pick.certain ? '' : `Your browser has no ${voice.gender.toLowerCase()} ${voice.language} voice installed, so this preview is an approximation of ${voice.name}. The real voice is the provider's.`);
    utterance.onend = () => setPlaying(null);
    utterance.onerror = () => setPlaying(null);
    setPlaying(voice.id);
    window.speechSynthesis.speak(utterance);
  };
  const toggleFavorite = (id) => setFavorites((current) => {
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    try { localStorage.setItem('weave_voice_favorites', JSON.stringify(next)); } catch {}
    return next;
  });
  return <div className="workspaceFeaturePage">
    <section className="welcomeBlock pageHeaderBlock featureHero"><div><div className="eyebrow cyan">VOICE LIBRARY</div><h1>Voices</h1><p>Explore provider voices, compare language and style, and choose the right voice for your agent.</p></div><button className="primaryCta createButton" type="button" onClick={onAgents}>Open agents <span className="buttonArrow">→</span></button></section>
    <div className="voiceWorkspaceTabs" role="tablist" aria-label="Voice library sections"><button role="tab" aria-selected={mode === 'default'} className={mode === 'default' ? 'active' : ''} onClick={() => setMode('default')}><span>◫</span><span><strong>Default voices</strong><small>Browse provider voice libraries</small></span></button><button role="tab" aria-selected={mode === 'custom'} className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}><span>◌</span><span><strong>Custom voices</strong><small>Your own voice IDs and voice clones</small></span><em>Under development</em></button></div>
    {mode === 'custom' ? <section className="customVoiceComing"><div className="customVoiceOrb">◌</div><div className="eyebrow cyan">IN DEVELOPMENT</div><h2>Custom voices are on the way</h2><p>Voice cloning and workspace-managed custom voice uploads are not available yet. You can already use your provider's own voice ID: set it in an agent’s Config, under Models.</p><button className="primaryCta" onClick={onAgents}>Open agents →</button></section> : <>
      <section className="featureToolbar voiceLibraryToolbar"><label className="featureSearch"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search voices by name, language or style" aria-label="Search voices" /></label><select value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Filter by provider"><option>All providers</option><option>Cartesia</option><option>ElevenLabs</option></select><select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Filter by language">{languages.map((item) => <option key={item}>{item}</option>)}</select><select value={gender} onChange={(event) => setGender(event.target.value)} aria-label="Filter by voice gender"><option>All genders</option><option>Female</option><option>Male</option></select></section>
      <div className="featureSummary"><span><b>{filtered.length}</b> curated voices · {VOICE_CATALOG.filter((voice) => provider === 'All providers' || voice.provider === provider).length} for selected provider</span><span>Preview uses your browser's speech engine; it is not a provider audio sample.</span></div>
      {previewNote && <p className="voicePreviewNote" role="status">{previewNote}</p>}
      <div className="voiceTableWrap"><table className="voiceLibraryTable"><thead><tr><th>Name</th><th>Language</th><th>Gender</th><th>Provider</th><th>Style</th><th>Used by</th><th>Actions</th></tr></thead><tbody>{filtered.map((voice) => <tr key={voice.id}><td><div className="voiceTableName"><span>{voice.name.slice(0,1)}</span><strong>{voice.name}</strong></div></td><td>{voice.language} <small>{voice.locale}</small></td><td>{voice.gender}</td><td><span className="voiceProviderTag">{voice.provider || 'Provider varies'}</span></td><td>{voice.style}</td><td>{usage[voice.id]?.length ? <span className="voiceUsedBy" title={usage[voice.id].map((item) => item.name).join(', ')}>{usage[voice.id].slice(0, 2).map((item) => <span key={item.id} className="voiceUsedChip">{item.name}</span>)}{usage[voice.id].length > 2 && <span className="voiceUsedMore">+{usage[voice.id].length - 2}</span>}</span> : <span className="voiceUnused">Not in use</span>}</td><td><div className="voiceTableActions"><button type="button" className="iconButton" title={playing === voice.id ? 'Playing preview' : 'Preview voice'} onClick={() => preview(voice)}>{playing === voice.id ? 'Ⅱ' : '▶'}</button><button type="button" className={`iconButton ${favorites.includes(voice.id) ? 'active' : ''}`} title="Favorite" onClick={() => toggleFavorite(voice.id)}>{favorites.includes(voice.id) ? '★' : '☆'}</button><button type="button" className="secondaryCta" onClick={() => { try { localStorage.setItem('weave_pending_voice', JSON.stringify({ provider: voice.provider.toLowerCase(), name: voice.name, voiceId: voice.voiceId || '' })); } catch {} (onUseVoice || onAgents)(voice); }}>Use in an agent</button></div></td></tr>)}</tbody></table></div>
      {!filtered.length && <section className="emptyPanel featureEmpty"><div className="emptyPanelIcon">⌕</div><h2>No voices found</h2><p>Try changing your search or filters.</p></section>}
    </>}
  </div>;
}
