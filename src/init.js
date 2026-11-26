// SPDX-License-Identifier: GPL-3.0-or-later
// `envrolled init`: write a decoy env file whose values point at the trap.
// Layout (names, order, URL paths, header) is randomised per run so there is no
// fixed shape for a scraper to skip.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomInt } from 'node:crypto';
import { makeToken, validatePrefix } from './token.js';

// Default filename is kept on purpose: it is a plausible leftover backup name and
// it is accepted by the real-env guard because of the .bak suffix. Use --out to change it.
export const DEFAULT_OUT = '.env.production.bak';
export const LEGACY_STATE_FILE = '.envrolled.json'; // 0.1.0 location, read for migration

// ---- name / path pools (no vendor-specific names, no credentials) ----
const URL_VARS = [
  'API_BASE_URL', 'ADMIN_PANEL_URL', 'PAYMENT_WEBHOOK_URL', 'INTERNAL_API_URL', 'STAGING_API_URL',
  'BACKUP_SERVICE_URL', 'AUTH_CALLBACK_URL', 'METRICS_ENDPOINT', 'CDN_ORIGIN_URL', 'REPORTING_API_URL',
  'NOTIFICATION_SERVICE_URL', 'SEARCH_API_URL', 'BILLING_API_URL', 'UPLOAD_SERVICE_URL', 'SSO_ISSUER_URL',
  'WEBHOOK_RELAY_URL',
];
const TOKEN_VARS = [
  'INTERNAL_API_TOKEN', 'ADMIN_API_KEY', 'SERVICE_ACCOUNT_TOKEN', 'WEBHOOK_SIGNING_SECRET', 'SESSION_SECRET',
  'JWT_SIGNING_KEY', 'BACKUP_ACCESS_KEY', 'DEPLOY_TOKEN', 'ADMIN_SESSION_KEY', 'METRICS_API_KEY',
  'CRON_SECRET', 'INTERNAL_AUTH_TOKEN',
];
const PATHS = [
  '/v1', '/v2', '/api/v1', '/api/v2', '/admin/session', '/admin/auth', '/hooks/payments', '/hooks/events',
  '/internal/api', '/internal/v1', '/services/backup', '/auth/callback', '/graphql/v1', '/rpc', '/gateway/v2',
  '/webhooks/incoming', '/metrics/push', '/app/api',
];
const HEADERS = [
  '# Production environment backup (do not share)',
  '# prod env - backup before migration',
  '# .env.production (copy) - DO NOT COMMIT',
  '# backup of production settings',
  '# production config snapshot',
];
const PLAIN = {
  NODE_ENV: () => 'production',
  PORT: () => ['3000', '4000', '5000', '8080'][randomInt(4)],
  LOG_LEVEL: () => ['info', 'warn', 'error'][randomInt(3)],
  APP_NAME: () => ['webapp', 'api-server', 'dashboard', 'backend', 'portal'][randomInt(5)],
  TZ: () => 'UTC',
  WORKERS: () => String(2 + randomInt(7)),
};

const pick = (arr) => arr[randomInt(arr.length)];
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Real-env guard. Case-insensitive; .env and .env.* refused unless the name ends in .bak or .decoy. */
export function isProtectedName(file) {
  const b = basename(file).toLowerCase();
  if (!/^\.env(\..*)?$/.test(b)) return false;
  return !(b.endsWith('.bak') || b.endsWith('.decoy'));
}

/** Where the token record lives: outside the project, so it is never committed next to the decoy. */
export function defaultStateFile(env = process.env, platform = process.platform, home = homedir()) {
  if (platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'envrolled', 'state.json');
  const base = env.XDG_STATE_HOME || join(home, '.local', 'state');
  return join(base, 'envrolled', 'state.json');
}

/** Read a state file. Returns {runs:[...]}; throws on corrupt JSON unless force. */
function readState(file, force) {
  if (!existsSync(file)) return { runs: [] };
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (s && Array.isArray(s.runs)) return { runs: s.runs };
    if (s && typeof s === 'object' && !Array.isArray(s) && s.tokens) return { runs: [s] }; // 0.1.0 single-run format
    throw new Error('unexpected structure');
  } catch (e) {
    if (force) return { runs: [] };
    throw new Error(`"${file}" is corrupt (${e.message}). Fix or delete it, or use --force to replace it.`);
  }
}

function normPath(p) {
  if (p === undefined || p === null || p === '') return null;
  if (!/^[A-Za-z0-9._\/-]{1,64}$/.test(p) || p.includes('..')) throw new Error('--path must be a simple URL path prefix like /v1');
  return '/' + p.replace(/^\/+|\/+$/g, '');
}

/** Build the decoy file text, token map and full URLs. */
export function buildDecoy({ trap, count = 8, prefix = '', label = false, path = '' }) {
  validatePrefix(prefix);
  const forced = normPath(path);
  let base;
  try {
    base = new URL(trap);
  } catch {
    throw new Error(`Invalid --trap URL (must be absolute http/https): ${trap}`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('--trap must be an http(s) URL');
  const root = trap.replace(/\/+$/, '');

  const n = Math.max(2, Math.min(Number(count) || 8, 20));
  const nUrl = Math.min(URL_VARS.length, Math.ceil(n / 2) + randomInt(2));
  const nTok = Math.min(TOKEN_VARS.length, n - Math.min(nUrl, n - 1));
  const urlNames = shuffle(URL_VARS).slice(0, nUrl);
  const tokNames = shuffle(TOKEN_VARS).slice(0, nTok);
  const paths = shuffle(PATHS);

  const entries = []; // [line] in final order
  const tokens = {};
  const urls = {};
  urlNames.forEach((name, i) => {
    const token = makeToken(prefix);
    tokens[name] = token;
    urls[name] = `${root}${forced ?? paths[i % paths.length]}/${token}`;
    entries.push(`${name}=${urls[name]}`);
  });
  for (const name of tokNames) {
    const token = makeToken(prefix);
    tokens[name] = token;
    entries.push(`${name}=${token}`);
  }
  // A few plausible non-secret lines, mixed in.
  for (const k of shuffle(Object.keys(PLAIN)).slice(0, 2 + randomInt(3))) entries.push(`${k}=${PLAIN[k]()}`);

  const lines = [pick(HEADERS)];
  if (label) lines.push('# Decoy file: the values below are honeytokens, not real credentials.');
  lines.push('', ...shuffle(entries));
  return { text: lines.join('\n') + '\n', tokens, urls };
}

export function runInit({
  trap, out = DEFAULT_OUT, count, prefix = '', label = false, path = '', force = false,
  stateFile, legacyFile,
}) {
  if (!trap) throw new Error('--trap <base-url> is required (public URL of your trap server)');
  if (isProtectedName(out)) {
    throw new Error(`Refusing to write "${out}": that looks like a real env file. Pick another name (default ${DEFAULT_OUT}).`);
  }
  if (existsSync(out) && !force) throw new Error(`"${out}" already exists. Use --force to overwrite it.`);
  const { text, tokens, urls } = buildDecoy({ trap, count, prefix, label, path });

  // Default state location is outside the project. If it does not exist yet and an old
  // ./.envrolled.json is present, its runs are carried over (the old file is left alone).
  const explicit = stateFile !== undefined;
  const file = stateFile ?? defaultStateFile();
  const legacy = legacyFile ?? (explicit ? null : LEGACY_STATE_FILE);
  const source = !existsSync(file) && legacy && existsSync(legacy) ? legacy : file;
  const state = readState(source, force); // before any write, so a corrupt file aborts cleanly

  if (dirname(out) !== '.') mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  state.runs.push({ created: new Date().toISOString(), trap, file: out, tokens, urls });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  return { out, stateFile: file, migratedFrom: source !== file ? source : null, tokens };
}
