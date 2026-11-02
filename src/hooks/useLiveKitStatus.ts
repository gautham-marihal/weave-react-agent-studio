import { useSyncExternalStore } from 'react';

// The outcome of the last real test session in this tab (POST /bots/{id}/sessions, then joining the LiveKit room).
// The API has no LiveKit health endpoint, and starting a session just to check would create a room, so until a test
// conversation has been started the status is honestly "unknown".

export type LiveKitStatus =
  | { state: 'unknown' }
  | { state: 'ok'; at: number; connectMs: number }
  | { state: 'failed'; at: number; message: string };

let status: LiveKitStatus = { state: 'unknown' };
const listeners = new Set<() => void>();

export function reportLiveKitStatus(next: LiveKitStatus): void {
  status = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useLiveKitStatus(): LiveKitStatus {
  return useSyncExternalStore(subscribe, () => status, () => status);
}
