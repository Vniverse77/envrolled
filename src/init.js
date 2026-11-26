// `envrolled init`: write a decoy env file whose values point at the trap.
// SPDX-License-Identifier: GPL-3.0-or-later
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { makeToken, validatePrefix } from './token.js';

export const DEFAULT_OUT = '.env.production.bak';
export const STATE_FILE = '.envrolled.json';

// URL-style decoys: the visitor is sent to <trap>/t/<token>.
const URL_VARS = [
  'API_BASE_URL',
  'ADMIN_PANEL_URL',
  'PAYMENT_WEBHOOK_URL',
  'INTERNAL_API_URL',
  'STAGING_API_URL',
  'BACKUP_SERVICE_URL',
  'AUTH_CALLBACK_URL',
  'METRICS_ENDPOINT',
];
// Opaque-token decoys: a bot that replays them sends them as headers/params.
const TOKEN_VARS = [
  'INTERNAL_API_TOKEN',
  'ADMIN_API_KEY',
  'SERVICE_ACCOUNT_TOKEN',
  'WEBHOOK_SIGNING_SECRET',
  'SESSION_SECRET',
  'JWT_SIGNING_KEY',
];

/** Refuse anything that looks like a real env file. */
// Case-insensitive (macOS/Windows are). Anything named .env or .env.* is refused,
// except decoy-marked names ending in .bak or .decoy (e.g. .env.production.bak).
export function isProtectedName(file) {
  const b = basename(file).toLowerCase();
  if (!/^\.env(\..*)?$/.test(b)) return false;
  return !(b.endsWith('.bak') || b.endsWith('.decoy'));
}

/** Read the state file. Returns {runs:[...]}; throws on corrupt JSON unless force. */
function readState(stateFile, force) {
  if (!existsSync(stateFile)) return { runs: [] };
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (s && Array.isArray(s.runs)) return { runs: s.runs };
    if (s && typeof s === 'object' && !Array.isArray(s) && s.tokens) return { runs: [s] }; // 0.1.0 single-run format
    throw new Error('unexpected structure');
  } catch (e) {
    if (force) return { runs: [] };
    throw new Error(`"${stateFile}" is corrupt (${e.message}). Fix or delete it, or use --force to replace it.`);
  }
}

/** Pure: build the decoy file text and the token map. */
export function buildDecoy({ trap, count = 8, prefix = '', label = false }) {
  validatePrefix(prefix);
  let base;
  try {
    base = new URL(trap);
  } catch {
    throw new Error(`Invalid --trap URL (must be absolute http/https): ${trap}`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('--trap must be an http(s) URL');
  }
  const root = trap.replace(/\/+$/, '');
  const n = Math.max(2, Math.min(Number(count) || 8, URL_VARS.length + TOKEN_VARS.length));
  const nUrl = Math.ceil(n / 2);
  const names = [...URL_VARS.slice(0, nUrl), ...TOKEN_VARS.slice(0, n - nUrl)];
  const tokens = {};
  const lines = [
    '# Production environment backup (do not share)',
  ];
  // Honest marker is opt-in: by default the file must look like a real backup.
  if (label) lines.push('# Decoy file: the values below are honeytokens, not real credentials.');
  lines.push('');
  for (const name of names) {
    const token = makeToken(prefix);
    tokens[name] = token;
    lines.push(`${name}=${URL_VARS.includes(name) ? `${root}/t/${token}` : token}`);
  }
  return { text: lines.join('\n') + '\n', tokens };
}

export function runInit({ trap, out = DEFAULT_OUT, count, prefix = '', label = false, force = false, stateFile = STATE_FILE }) {
  if (!trap) throw new Error('--trap <base-url> is required (public URL of your trap server)');
  if (isProtectedName(out)) {
    throw new Error(`Refusing to write "${out}": that looks like a real env file. Pick another name (default ${DEFAULT_OUT}).`);
  }
  if (existsSync(out) && !force) {
    throw new Error(`"${out}" already exists. Use --force to overwrite it.`);
  }
  const { text, tokens } = buildDecoy({ trap, count, prefix, label });
  const state = readState(stateFile, force); // before any write, so a corrupt file aborts cleanly
  if (dirname(out) !== '.') mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  // Informational only: the server recognises tokens by their shape, it does not need this file.
  // Merge: keep the token lists of earlier runs.
  state.runs.push({ created: new Date().toISOString(), trap, file: out, tokens });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  return { out, stateFile, tokens };
}
