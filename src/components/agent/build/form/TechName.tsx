import React, { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, FileJsonIcon } from 'lucide-react';
import type { Path } from '../../../../types/studio';
import { formatPath } from '../../../../models/schemaForm/paths';

interface TechNameProps {
  /** Where the value lives in the config. */
  path: Path;
  /** What to show; the last key of the path when left out. */
  name?: string;
  /** Opens the JSON view at this place. Without it there is no "In JSON". */
  onOpenJson?: ((path: Path) => void) | null;
}

/**
 * The file's name for a setting, as a chip, with Copy path and In JSON. Shown with "Technical names" on, so customers
 * read plain labels and developers see the names in the file. Any hand-made editor can put one beside its fields.
 */
export function TechName({ path, name, onOpenJson }: TechNameProps) {
  const [copied, setCopied] = useState('');
  const text = formatPath(path);
  const own = name ?? String(path[path.length - 1] ?? '');
  // the setting's parents (channels[0].modalities.) dimmed in front of its own name, so the full path reads at a glance
  const head = own && text.endsWith(own) ? text.slice(0, text.length - own.length) : '';
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(''), 3000);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await window.navigator.clipboard.writeText(text);
      setCopied('Copied');
    } catch {
      setCopied(`Copy failed: select ${text}`);
    }
  };
  const linkClass =
    'inline-flex items-center gap-1 rounded px-1 text-[11px] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1" data-tech-name={text}>
      <code className="max-w-full truncate rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-soft" title={`Path: ${text}`}>
        {head && (
          <span className="text-muted" aria-hidden>
            {head}
          </span>
        )}
        {own}
      </code>
      <button type="button" className={linkClass} aria-label={`Copy the path of ${own}`} onClick={copy}>
        {copied === 'Copied' ? <CheckIcon className="h-3 w-3" aria-hidden /> : <CopyIcon className="h-3 w-3" aria-hidden />}
        Copy path
      </button>
      {onOpenJson && (
        <button type="button" className={linkClass} aria-label={`Open ${own} in the JSON`} onClick={() => onOpenJson(path)}>
          <FileJsonIcon className="h-3 w-3" aria-hidden />
          In JSON
        </button>
      )}
      {copied && (
        <span className="text-[11px] text-muted" role="status">
          {copied}
        </span>
      )}
    </span>
  );
}
