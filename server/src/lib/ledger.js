import crypto from 'crypto';

/**
 * Hash-chained ledger primitives (ARCHITECTURE §5.5) — pure and unit-testable.
 * Each entry stores its full payload; the chain hash covers a canonical,
 * key-order-independent serialisation, so any later edit to a stored payload
 * (or to prev_hash) breaks verification from that entry onward.
 */

export const GENESIS = 'GENESIS';

const FIELDS = [
  'entry_type', 'disbursement_id', 'installment_id', 'application_id',
  'program_id', 'amount', 'method', 'ref', 'paid_at', 'reason',
];

/** Canonical pipe-string over a fixed field order; numbers normalised. */
export function canonical(payload) {
  return FIELDS.map((f) => {
    const v = payload[f];
    if (v === undefined || v === null) return '';
    if (f === 'amount') return Number(v).toFixed(2);
    return String(v);
  }).join('|');
}

export function entryHash(prevHash, payload) {
  return crypto.createHash('sha256').update(`${prevHash}||${canonical(payload)}`).digest('hex');
}

/**
 * Walk entries (ordered by id ASC) recomputing the chain.
 * @returns {{ ok: boolean, entries: number, broken_at?: number, reason?: string }}
 */
export function verifyChain(entries) {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prev_hash !== prev) {
      return { ok: false, entries: entries.length, broken_at: Number(e.id), reason: 'prev_hash mismatch' };
    }
    if (entryHash(e.prev_hash, e.payload) !== e.hash) {
      return { ok: false, entries: entries.length, broken_at: Number(e.id), reason: 'payload hash mismatch' };
    }
    prev = e.hash;
  }
  return { ok: true, entries: entries.length };
}
