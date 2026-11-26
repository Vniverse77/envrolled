// Decoy tokens: "envr_" + 20 random hex chars. Deliberately NOT shaped like any
// real vendor secret (no AKIA, sk-, ghp_, Stripe formats), so GitHub push
// protection and vendor auto-revocation never get involved.
import { randomBytes } from 'node:crypto';

export const TOKEN_RE = /envr_[0-9a-f]{20}/;

export function makeToken() {
  return 'envr_' + randomBytes(10).toString('hex');
}

/** Return the first decoy token found in any of the given strings, or null. */
export function findToken(...parts) {
  for (const p of parts) {
    if (typeof p !== 'string') continue;
    const m = TOKEN_RE.exec(p);
    if (m) return m[0];
  }
  return null;
}
