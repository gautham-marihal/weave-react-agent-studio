// Saving an agent's configuration as a file. Pure browser work: nothing is sent anywhere.

export function exportFileName(botId, label) {
  const part = String(label || 'draft').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${botId}-${part}.json`;
}

export function configToText(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function downloadText(fileName, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access can be refused (insecure context, permissions): fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}
