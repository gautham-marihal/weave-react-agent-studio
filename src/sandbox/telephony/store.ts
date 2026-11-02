// Where Sandbox telephony is kept: this browser's storage, one record per browser. It starts with a sample setup (two
// test numbers, three dispatch rules for the sample agents, two trunks) so every part has something to show.

import { useSyncExternalStore } from 'react';
import { SANDBOX_SAMPLE_IDS } from '../mode';
import { normalizeTelephony, RULE_DEFAULTS, type DispatchRule, type TelephonyData } from './model';

export const TELEPHONY_KEY = 'weave_sandbox_telephony';

const [SUPPORT, FRONT_DESK, BOOKINGS] = SANDBOX_SAMPLE_IDS;

/** The setup Sandbox starts with, dated from `now`. */
export function sampleTelephony(now: Date): TelephonyData {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const rule = (fields: Partial<DispatchRule> & Pick<DispatchRule, 'id' | 'name' | 'routing' | 'agentId'>, daysAgo: number): DispatchRule => ({
    type: 'individual',
    roomPrefix: 'call-',
    ...RULE_DEFAULTS,
    ...fields,
    createdAt: at(daysAgo),
    updatedAt: at(daysAgo),
  });
  return {
    numbers: [
      { id: 'PN_sample_us', number: '+1 415 555 0142', country: 'US', label: 'Support line', createdAt: at(9) },
      { id: 'PN_sample_gb', number: '+44 20 7946 0321', country: 'GB', label: 'Bookings, UK', createdAt: at(6) },
    ],
    rules: [
      rule({ id: 'SDR_sample_main', name: 'Main support line', routing: 'PN_sample_us', agentId: SUPPORT, maxHold: 30, overflow: 'person', holdMessage: 'Thanks for waiting, we’ll be with you shortly.' }, 9),
      rule({ id: 'SDR_sample_after', name: 'After-hours desk', routing: 'all', agentId: FRONT_DESK, hours: 'after', priority: 3, maxHold: 20, overflow: 'end' }, 8),
      rule({ id: 'SDR_sample_uk', name: 'UK bookings', routing: 'PN_sample_gb', agentId: BOOKINGS, hours: 'business', maxHold: 45, overflow: 'agent', overflowAgentId: SUPPORT }, 6),
    ],
    trunks: [
      { id: 'ST_sample_in', direction: 'inbound', name: 'Sample carrier, inbound', numbers: ['+1 415 555 0142', '+44 20 7946 0321'], address: '', username: '', createdAt: at(9) },
      { id: 'ST_sample_out', direction: 'outbound', name: 'Sample carrier, outbound', numbers: ['+1 415 555 0142'], address: 'sip.example.com', username: 'weave-sandbox', createdAt: at(9) },
    ],
    calls: [],
  };
}

let current: TelephonyData | null = null;
const listeners = new Set<() => void>();

function save(data: TelephonyData): void {
  try {
    window.localStorage.setItem(TELEPHONY_KEY, JSON.stringify(data));
  } catch {
    // full or unavailable: kept for this page only
  }
}

/** What is kept now (the sample setup the first time). */
export function readTelephony(): TelephonyData {
  if (current) return current;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TELEPHONY_KEY);
  } catch {
    raw = null;
  }
  try {
    current = raw ? normalizeTelephony(JSON.parse(raw)) : null;
  } catch {
    current = null;
  }
  if (!current) {
    current = sampleTelephony(new Date());
    save(current);
  }
  return current;
}

/** Changes what is kept, and redraws whoever shows it. */
export function updateTelephony(change: (data: TelephonyData) => TelephonyData): TelephonyData {
  current = change(readTelephony());
  save(current);
  listeners.forEach((l) => l());
  return current;
}

/** Back to the sample setup, with no calls. */
export const resetTelephony = (): TelephonyData => updateTelephony(() => sampleTelephony(new Date()));

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // another tab changed it: read it again
  const onStorage = (event: StorageEvent) => {
    if (event.key === TELEPHONY_KEY || event.key === null) {
      current = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The kept telephony, redrawn on every change. */
export const useSandboxTelephony = (): TelephonyData => useSyncExternalStore(subscribe, readTelephony, readTelephony);
