import { format, formatDistanceToNowStrict } from 'date-fns';
import type { VersionBump } from '../types/studio';

export const minutesAgo = (m: number): string => new Date(Date.now() - m * 60000).toISOString();

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 45000) return 'just now';
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

export const formatClock = (iso: string): string => format(new Date(iso), 'HH:mm');
export const formatDateTime = (iso: string): string => format(new Date(iso), 'd MMM yyyy, HH:mm');
export const formatShortDate = (iso: string): string => format(new Date(iso), 'd MMM, HH:mm');

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

export function formatOffset(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const formatPercent = (n: number, digits = 0): string => `${(n * 100).toFixed(digits)}%`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function bumpVersion(current: string | undefined, bump: VersionBump): string {
  if (!current) return bump === 'major' ? '1.0.0' : bump === 'minor' ? '0.1.0' : '0.0.1';
  const [a, b, c] = current.split('.').map((n) => Number(n) || 0);
  if (bump === 'major') return `${a + 1}.0.0`;
  if (bump === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

function hash(input: string, seed: number): string {
  let h = seed;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function fakeChecksum(value: unknown): string {
  const s = JSON.stringify(value);
  return `sha256:${hash(s, 2166136261)}${hash(s, 33554467)}`;
}

export const randomHex = (n: number): string =>
Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');