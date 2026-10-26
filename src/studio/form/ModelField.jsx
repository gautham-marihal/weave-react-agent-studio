import React, { useMemo } from 'react';
import { MODEL_OPTIONS, isRecommendedModel, modelsFor, providerLabel, providersForStage, providerOptionNote } from '../models/catalog.js';
import { useProviders } from '../models/useProviders.js';
import { useConfigSelect } from './ctx.js';
import { TextInput } from './fields.jsx';
import SuggestInput from './SuggestInput.jsx';

// The Provider and Model boxes of the speech, language and voice settings: a list of what the studio knows (the
// providers the server can run, the models the catalogue lists for the chosen provider), and any other value can be
// typed. Nothing here limits what is saved: the server does not check model ids.
export default function ModelField({ stage, leaf, path, value, onChange, disabled, invalid, id, placeholder }) {
  const { providers, turnDetectors } = useProviders();
  const parent = path.slice(0, -1);
  // the model list depends on the provider next to it
  const provider = useConfigSelect((config) => String(parent.reduce((node, key) => (node == null ? node : node[key]), config)?.provider || ''));
  const options = useMemo(() => {
    // the turn detector is chosen from the server's own list of them (GET /providers' `turn_detectors`)
    if (leaf === 'provider' && stage === 'turn_detector')
      return turnDetectors.map((name) => ({ value: name, label: providerLabel(name), description: name !== providerLabel(name) ? name : '' }));
    if (leaf === 'provider') {
      return providersForStage(providers, stage).map((p) => ({
        value: p.name,
        label: providerLabel(p.name),
        description: providerOptionNote(p, stage),
      }));
    }
    return modelsFor(stage, provider).map((m) => ({
      value: m.id,
      label: isRecommendedModel(stage, provider, m.id) ? `${m.label} · Recommended` : m.label,
      description: [m.id !== m.label ? m.id : '', m.note].filter(Boolean).join(' · '),
    }));
  }, [leaf, stage, provider, providers, turnDetectors]);

  // a provider with no list of its own (any OpenAI-compatible service) is simply typed
  if (!options.length || (leaf === 'model' && !(stage in MODEL_OPTIONS))) {
    return <TextInput id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} invalid={invalid} />;
  }
  return (
    <SuggestInput
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      invalid={invalid}
      placeholder={leaf === 'provider' ? 'Choose a provider or type one' : 'Choose a model or type its id'}
      ariaLabel={leaf === 'provider' ? 'Provider' : 'Model'}
      footer={leaf === 'provider' ? 'Or type the name of any other provider.' : 'Or type any other model id: the server doesn’t check them.'}
    />
  );
}
