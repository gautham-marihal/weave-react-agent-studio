// The pure parts of SmartSelect.jsx: the accepted shapes of a choice list, and how typing narrows it.

export const SEARCH_AFTER = 8;

export const normalizeOptions = (options) =>
  (Array.isArray(options) ? options : []).map((o) =>
    typeof o === 'string' || typeof o === 'number'
      ? { value: String(o), label: String(o) }
      : { value: String(o.value), label: o.label ?? String(o.value), description: o.description || '', group: o.group || '', disabled: !!o.disabled },
  );

// options matching every typed word, anywhere in label, value, description or group, ignoring case
export function filterOptions(options, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const text = `${o.label} ${o.value} ${o.description || ''} ${o.group || ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
