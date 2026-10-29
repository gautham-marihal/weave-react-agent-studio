import type { SessionState } from '../fsm/session-machine.ts';

// Session state lives server-side only. This in-process store is correct for one gateway instance. Running more
// than one instance needs a shared store with compare-and-set (Redis WATCH/MULTI or a row version), because two
// tool calls for the same call can arrive at different instances: see docs/BANKING-AGENT-DESIGN.md §2.5.

export interface SessionStore {
  get(id: string): SessionState | undefined;
  byCallId(callId: string): SessionState | undefined;
  byRoom(room: string): SessionState | undefined;
  /** Replaces the session if `expected` is still the stored object (optimistic concurrency). */
  compareAndSet(expected: SessionState | undefined, next: SessionState): boolean;
  sweep(now: number, ttlMs: number): SessionState[];
}

export class MemorySessionStore implements SessionStore {
  readonly #byId = new Map<string, SessionState>();
  readonly #callIndex = new Map<string, string>();
  readonly #roomIndex = new Map<string, string>();

  get(id: string) {
    return this.#byId.get(id);
  }

  byCallId(callId: string) {
    const id = this.#callIndex.get(callId);
    return id ? this.#byId.get(id) : undefined;
  }

  byRoom(room: string) {
    const id = this.#roomIndex.get(room);
    return id ? this.#byId.get(id) : undefined;
  }

  compareAndSet(expected: SessionState | undefined, next: SessionState): boolean {
    if (this.#byId.get(next.id) !== expected) return false;
    this.#byId.set(next.id, next);
    this.#callIndex.set(next.callId, next.id);
    if (next.room) this.#roomIndex.set(next.room, next.id);
    return true;
  }

  /** Removes sessions idle for longer than the TTL and returns them so their secrets can be revoked. */
  sweep(now: number, ttlMs: number): SessionState[] {
    const removed: SessionState[] = [];
    for (const [id, s] of this.#byId) {
      if (now - s.lastActivityAt > ttlMs) {
        this.#byId.delete(id);
        this.#callIndex.delete(s.callId);
        if (s.room) this.#roomIndex.delete(s.room);
        removed.push(s);
      }
    }
    return removed;
  }
}
