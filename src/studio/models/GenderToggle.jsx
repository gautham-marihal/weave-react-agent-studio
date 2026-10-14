import React, { useEffect, useState } from 'react';
import { VOICE_GENDERS, genderOfVoice, voicesFor } from './config.js';

// Female | Male switch over a provider's voices. It starts on the gender of the voice in use (Female when there is none), and follows
// the voice when it changes from elsewhere. Used by the Simple view and by the AI Model editor, so both list voices the same way.
export function useVoiceGender(provider, voiceId) {
  const [gender, setGender] = useState(() => genderOfVoice(provider, voiceId));
  const known = voicesFor(provider).some((voice) => voice.voiceId === voiceId);
  const own = genderOfVoice(provider, voiceId);
  useEffect(() => { if (known) setGender(own); }, [known, own]);
  return [gender, setGender];
}

export default function GenderToggle({ provider, value, onChange }) {
  return (
    <div className="segmented vgToggle" role="group" aria-label="Voice gender">
      {VOICE_GENDERS.map((gender) => {
        const count = voicesFor(provider, gender).length;
        return (
          <button type="button" key={gender} className={value === gender ? 'active' : ''} aria-pressed={value === gender} disabled={count === 0} onClick={() => onChange(gender)}>
            {gender} <small>({count})</small>
          </button>
        );
      })}
    </div>
  );
}
