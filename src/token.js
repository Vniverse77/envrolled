// SPDX-License-Identifier: GPL-3.0-or-later
// Decoy tokens come in three shapes, picked at random per variable, none of which
// carries a tool name or matches a vendor secret format (AKIA/ASIA, sk-, ghp_,
// xox*, sk_live, AIza, JWT/eyJ, ...):
//   hex   24 lowercase hex chars
//   b64   32 base64url chars (must mix digits, lower and upper case)
//   uuid  UUID-v4-like (8-4-4-4-12 lowercase hex, version nibble 4)
// Optional --prefix is validated for the same reason.
import { randomBytes, randomUUID } from 'node:crypto';

export const FORMS = ['hex', 'b64', 'uuid'];

const HEX = '[0-9a-f]{24}';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const B64 = '[A-Za-z0-9_-]{32}';
const VENDOR_PREFIX = /^(a[ks]ia|sk|ghp|gho|ghs|ghu|github|xox|aiza|eyj|pk|rk|whsec|npm|glpat|ya29|hf_|gsk_|shpat|dop_|sq0|key-)/i;
// Substrings a generated b64 token must never contain (it is random text, so check anywhere).
const VENDOR_ANYWHERE = /(sk[-_]|[pk]k[-_]|gh[pousr]_|akia|asia|aiza|xox|eyj|ya29|hf_|gsk_|shpat|dop_|sq0|key-|whsec|glpat|npm_)/i;

export function validatePrefix(prefix) {
  if (prefix === undefined || prefix === null || prefix === '') return '';
  const p = String(prefix);
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(p)) throw new Error('--prefix must be 1-16 chars of A-Z a-z 0-9 _ -');
  if (VENDOR_PREFIX.test(p)) throw new Error('--prefix must not look like a real vendor secret prefix');
  return p;
}

/** A b64 token only counts if it mixes digit, lower and upper case (keeps noise like "zzzz..." out). */
const isB64 = (s) => /^[A-Za-z0-9_-]{32}$/.test(s) && /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);
const isBare = (s) => new RegExp(`^(?:${HEX}|${UUID})$`).test(s) || isB64(s);

function makeBare(form) {
  if (form === 'hex') return randomBytes(12).toString('hex');
  if (form === 'uuid') return randomUUID();
  for (;;) {
    const t = randomBytes(24).toString('base64url');
    if (isB64(t) && !VENDOR_ANYWHERE.test(t)) return t;
  }
}

export function makeToken(prefix = '', form = FORMS[randomBytes(1)[0] % FORMS.length]) {
  if (!FORMS.includes(form)) throw new Error(`unknown token form: ${form}`);
  return validatePrefix(prefix) + makeBare(form);
}

/**
 * Recognise a decoy token (any of the three shapes, optionally with the configured
 * prefix) as a whole path segment anywhere in the path, or standing alone in the query
 * or a header value. Noise such as /t/zzzzzzzz yields null. `url` is path + query.
 */
export function findToken({ url, headers = [], prefix = '' } = {}) {
  const p = prefix ? validatePrefix(prefix) : '';
  const strip = (s) => (p && s.startsWith(p) ? s.slice(p.length) : s);
  const u = String(url || '');
  for (const seg of u.split('?')[0].split('/')) {
    if (isBare(strip(seg)) || isBare(seg)) return seg;
  }
  const re = new RegExp(`(?<![A-Za-z0-9_-])(?:${p})?(?:${UUID}|${B64}|${HEX})(?![A-Za-z0-9_-])`, 'g');
  for (const s of [u, ...headers]) {
    if (typeof s !== 'string') continue;
    for (const m of s.matchAll(re)) if (isBare(strip(m[0])) || isBare(m[0])) return m[0];
  }
  return null;
}
