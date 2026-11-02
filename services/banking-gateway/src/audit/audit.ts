import { sha256 } from '../security/crypto.ts';

// Audit trail. Each record carries the hash of the previous one, so deleting or editing a record breaks the chain
// and `verifyChain` reports where. Records hold redacted arguments only: no PIN, OTP, NRIC or full account number
// is ever written here. The sink decides where records go (stdout JSON lines here; a WORM store / SIEM in
// production: see docs/BANKING-AGENT-DESIGN.md §6.7).

export interface AuditRecord {
  readonly seq: number;
  readonly at: string;
  readonly sessionId: string;
  readonly callId: string;
  readonly kind: 'session' | 'tool' | 'capture' | 'transaction' | 'auth' | 'security';
  readonly action: string;
  readonly outcome: 'ok' | 'refused' | 'failed' | 'error';
  readonly detail: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly hash: string;
}

export type AuditInput = Omit<AuditRecord, 'seq' | 'at' | 'prevHash' | 'hash'>;

export type AuditSink = (record: AuditRecord) => void;

export class AuditLog {
  #seq = 0;
  #prev = 'genesis';
  readonly #sinks: AuditSink[];
  readonly #clock: () => number;

  constructor(sinks: AuditSink[], clock: () => number) {
    this.#sinks = sinks;
    this.#clock = clock;
  }

  write(input: AuditInput): AuditRecord {
    const base = { ...input, seq: ++this.#seq, at: new Date(this.#clock()).toISOString(), prevHash: this.#prev };
    const hash = sha256(JSON.stringify(base));
    const record: AuditRecord = { ...base, hash };
    this.#prev = hash;
    for (const sink of this.#sinks) sink(record);
    return record;
  }
}

/** Returns the index of the first record that does not chain correctly, or -1 when the chain is intact. */
export function verifyChain(records: readonly AuditRecord[]): number {
  let prev = records[0]?.prevHash ?? 'genesis';
  for (let i = 0; i < records.length; i++) {
    const r = records[i] as AuditRecord;
    const { hash, ...rest } = r;
    if (r.prevHash !== prev || sha256(JSON.stringify(rest)) !== hash) return i;
    prev = hash;
  }
  return -1;
}

export const jsonLineSink: AuditSink = (record) => process.stdout.write(`${JSON.stringify({ audit: record })}\n`);
