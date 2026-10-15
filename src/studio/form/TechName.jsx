import React, { useState } from 'react';
import { useForm } from './ctx.js';
import { formatPath } from '../format.js';

// The name the configuration file uses for a setting, with a way to copy its path or open it in the JSON. It is drawn only when "Technical
// names" is on, so a customer reads plain labels and a developer can see what each one is called in the file.
export function TechName({ name, path }) {
  const { openInJson } = useForm();
  const [copied, setCopied] = useState('');
  const text = formatPath(path);
  const copy = async () => {
    try { await window.navigator.clipboard.writeText(text); setCopied('Copied'); } catch { setCopied(text); }
    window.setTimeout(() => setCopied(''), 4000);
  };
  return (
    <span className="stFTech">
      <code className="stFKey" title={`Path: ${text}`}>{name}</code>
      <button type="button" className="stLink" aria-label={`Copy the path of ${name}`} onClick={copy}>Copy path</button>
      {openInJson && <button type="button" className="stLink" aria-label={`Open ${name} in the JSON`} onClick={() => openInJson(path)}>In JSON</button>}
      {copied && <span className="stFCopied" role="status">{copied}</span>}
    </span>
  );
}

// For a hand-made editor (a tool, a channel): its label plus, when technical names are on, the file's name for it. `path` is where the value
// lives in the configuration; `name` is what to show (it can be a longer path, like on_error.tool_error).
export function TechKey({ name, path }) {
  const { technical } = useForm();
  return technical ? <TechName name={name} path={path} /> : null;
}
