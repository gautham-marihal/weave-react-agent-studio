import React, { useState } from 'react';
import { useForm } from './ctx.js';
import { formatPath } from '../format.js';

// The file's name for a setting, with copy-path and open-in-JSON. Drawn only with "Technical names" on, so customers
// read plain labels and developers see the names in the file.
export function TechName({ name, path, onOpenJson }) {
  const form = useForm();
  const openInJson = onOpenJson || form?.openInJson;
  const [copied, setCopied] = useState('');
  const text = formatPath(path);
  // The setting's parents (channels[0].modalities.) dimmed in
  // front of its own name, so the full path reads at a glance.
  const head = name && text.endsWith(name) ? text.slice(0, text.length - name.length) : '';
  const copy = async () => {
    try {
      await window.navigator.clipboard.writeText(text);
      setCopied('Copied');
    } catch {
      setCopied(text);
    }
    window.setTimeout(() => setCopied(''), 4000);
  };
  return (
    <span className="stFTech">
      {head && (
        <span className="stFKeyHead" aria-hidden="true">
          {head}
        </span>
      )}
      <code className="stFKey" title={`Path: ${text}`}>
        {name}
      </code>
      <button type="button" className="stLink" aria-label={`Copy the path of ${name}`} onClick={copy}>
        Copy path
      </button>
      {openInJson && (
        <button type="button" className="stLink" aria-label={`Open ${name} in the JSON`} onClick={() => openInJson(path)}>
          In JSON
        </button>
      )}
      {copied && (
        <span className="stFCopied" role="status">
          {copied}
        </span>
      )}
    </span>
  );
}

// For a hand-made editor (a tool, a channel): its label plus, with technical names on, the file's name for it. `path`
// is where the value lives; `name` is what to show (may be longer, like on_error.tool_error).
export function TechKey({ name, path }) {
  const { technical } = useForm();
  return technical ? <TechName name={name} path={path} /> : null;
}
