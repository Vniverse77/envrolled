// Config precedence: flag > env var > config file > default.
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_REDIRECT, validateRedirect } from './redirect.js';

export const CONFIG_FILE = 'envrolled.config.json';

const DEFAULTS = {
  port: 8787,
  host: '0.0.0.0',
  redirect: DEFAULT_REDIRECT,
  notify: null,
  log: null,
  trustProxy: false,
  stats: false,
};

// key -> env var names, first one that is set wins
const ENV_NAMES = {
  port: ['ENVROLLED_PORT', 'PORT'],
  host: ['ENVROLLED_HOST'],
  redirect: ['ENVROLLED_REDIRECT'],
  notify: ['ENVROLLED_NOTIFY'],
  log: ['ENVROLLED_LOG'],
  trustProxy: ['ENVROLLED_TRUST_PROXY'],
  stats: ['ENVROLLED_STATS'],
};

const BOOL = new Set(['trustProxy', 'stats']);

function coerce(key, v) {
  if (key === 'port') {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`Invalid port: ${v}`);
    return n;
  }
  if (BOOL.has(key)) {
    if (typeof v === 'boolean') return v;
    return /^(1|true|yes|on)$/i.test(String(v));
  }
  return String(v);
}

export function loadConfigFile(path) {
  if (!path || !existsSync(path)) return {};
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    if (cfg === null) return {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('top level must be a JSON object');
    return cfg;
  } catch (e) {
    throw new Error(`Cannot parse config file ${path}: ${e.message}`);
  }
}

/**
 * @param {{flags?:object, env?:object, file?:object}} src
 * @returns {{values:object, sources:object}}
 */
export function resolveConfig({ flags = {}, env = {}, file = {} } = {}) {
  const values = {};
  const sources = {};
  for (const key of Object.keys(DEFAULTS)) {
    let raw;
    let source = 'default';
    if (flags[key] !== undefined) {
      raw = flags[key];
      source = 'flag';
    } else {
      const name = ENV_NAMES[key].find((n) => env[n] !== undefined && env[n] !== '');
      if (name) {
        raw = env[name];
        source = `env:${name}`;
      } else if (file[key] !== undefined) {
        raw = file[key];
        source = 'file';
      }
    }
    values[key] = source === 'default' ? DEFAULTS[key] : coerce(key, raw);
    sources[key] = source;
  }
  values.redirect = validateRedirect(values.redirect, 'redirect');
  if (values.notify) values.notify = validateRedirect(values.notify, 'notify');
  return { values, sources };
}
