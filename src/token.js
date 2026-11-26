// SPDX-License-Identifier: GPL-3.0-or-later
// Decoy tokens: 24 random lowercase hex chars, no tool name in them, so a leaked
// file does not advertise the trap. 24 hex is neither 32 nor 40 (MD5/SHA-1 shaped)
// and contains no uppercase/hyphen/underscore, so it cannot match vendor formats
// (AKIA/ASIA, sk-, ghp_, xox*, sk_live, AIza, JWT). Optional --prefix is
// validated below for the same reason.
import { randomBytes } from 'node:crypto';

const HEX24 = /(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])/;
const PATH_TOKEN = /^\/t\/([A-Za-z0-9_-]{8,80})/;
const VENDOR_PREFIX = /^(a[ks]ia|sk|ghp|gho|ghs|ghu|github|xox|aiza|eyj|pk|rk|whsec|npm|glpat)/i;

export function validatePrefix(prefix) {
  if (prefix === undefined || prefix === null || prefix === '') return '';
  const p = String(prefix);
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(p)) throw new Error('--prefix must be 1-16 chars of A-Z a-z 0-9 _ -');
  if (VENDOR_PREFIX.test(p)) throw new Error('--prefix must not look like a real vendor secret prefix');
  return p;
}

export function makeToken(prefix = '') {
  return validatePrefix(prefix) + randomBytes(12).toString('hex');
}

/**
 * Recognise a decoy token. `url` is the request URL (path + query); the other
 * parts are header values. Order: /t/<token> path shape, then prefix+hex24,
 * then plain hex24.
 */
export function findToken({ url, headers = [], prefix = '' } = {}) {
  const m = PATH_TOKEN.exec(String(url || '').split('?')[0]);
  if (m) return m[1];
  const p = prefix ? validatePrefix(prefix) : '';
  const custom = p ? new RegExp(`${p}[0-9a-f]{24}(?![0-9a-f])`) : null;
  for (const s of [url, ...headers]) {
    if (typeof s !== 'string') continue;
    const c = custom?.exec(s);
    if (c) return c[0];
    const h = HEX24.exec(s);
    if (h) return h[0];
  }
  return null;
}
