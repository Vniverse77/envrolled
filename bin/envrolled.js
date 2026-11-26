#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { runInit, DEFAULT_OUT } from '../src/init.js';
import { resolveConfig, loadConfigFile, CONFIG_FILE } from '../src/config.js';
import { createTrap } from '../src/server.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `envrolled ${pkg.version} - plant a decoy .env, rickroll whoever uses it

Usage:
  envrolled init  --trap <url> [--out <file>] [--count <n>] [--force]
  envrolled serve [--port <n>] [--redirect <url>] [--notify <url>] [--log <file>]
                  [--trust-proxy] [--stats] [--host <addr>] [--config <file>]
  envrolled config [--config <file>]   show the resolved configuration
  envrolled --help | --version

init options:
  --trap <url>      public URL of your trap server (required)
  --out <file>      decoy file to write (default ${DEFAULT_OUT}); never a real .env
  --count <n>       number of decoy variables (default 8)
  --force           overwrite an existing decoy file

serve options (precedence: flag > env var > ${CONFIG_FILE} > default):
  --port <n>        listen port (ENVROLLED_PORT or PORT, default 8787)
  --host <addr>     listen address (ENVROLLED_HOST, default 0.0.0.0)
  --redirect <url>  where visitors are sent (ENVROLLED_REDIRECT, default Rick Astley)
  --notify <url>    webhook for hit notifications (ENVROLLED_NOTIFY)
  --log <file>      JSONL hit log (ENVROLLED_LOG)
  --trust-proxy     read CF-Connecting-IP / X-Forwarded-For (ENVROLLED_TRUST_PROXY)
  --stats           enable GET /stats, counts only (ENVROLLED_STATS)
  --config <file>   config file (default ./${CONFIG_FILE})
`;

const options = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  trap: { type: 'string' },
  out: { type: 'string' },
  count: { type: 'string' },
  force: { type: 'boolean' },
  port: { type: 'string' },
  host: { type: 'string' },
  redirect: { type: 'string' },
  notify: { type: 'string' },
  log: { type: 'string' },
  'trust-proxy': { type: 'boolean' },
  stats: { type: 'boolean' },
  config: { type: 'string' },
};

function flagsToConfig(v) {
  const f = { port: v.port, host: v.host, redirect: v.redirect, notify: v.notify, log: v.log };
  if (v['trust-proxy']) f.trustProxy = true;
  if (v.stats) f.stats = true;
  return f;
}

function main() {
  const { values, positionals } = parseArgs({ options, allowPositionals: true });
  if (values.version) return console.log(pkg.version);
  const cmd = positionals[0];
  if (values.help || !cmd) return console.log(HELP);

  if (cmd === 'init') {
    const r = runInit({ trap: values.trap, out: values.out, count: values.count, force: values.force });
    console.log(`Wrote decoy env file: ${r.out}`);
    for (const [k, t] of Object.entries(r.tokens)) console.log(`  ${k.padEnd(24)} ${t}`);
    console.log(`Token list saved to ${r.stateFile} (informational; add it to .gitignore).`);
    console.log('\nNext steps:');
    console.log(`  1. Run the trap:   npx envrolled serve --redirect <your video url>`);
    console.log(`  2. Make sure ${values.trap} reaches it (reverse proxy / tunnel / Cloudflare Worker).`);
    console.log(`  3. Commit or leave ${r.out} where scrapers look. Never reuse real secrets in it.`);
    return;
  }

  if (cmd === 'serve' || cmd === 'config') {
    const file = loadConfigFile(values.config || CONFIG_FILE);
    const { values: cfg, sources } = resolveConfig({ flags: flagsToConfig(values), env: process.env, file });
    if (cmd === 'config') {
      for (const k of Object.keys(cfg)) console.log(`${k.padEnd(11)} ${String(cfg[k]).padEnd(48)} (${sources[k]})`);
      return;
    }
    const { server } = createTrap({ ...cfg, onError: (e) => console.error('envrolled:', e.message) });
    server.on('error', (e) => {
      const msg = e.code === 'EADDRINUSE' ? `port ${cfg.port} is already in use`
        : e.code === 'EADDRNOTAVAIL' || e.code === 'ENOTFOUND' ? `cannot listen on host "${cfg.host}" (${e.code})`
        : e.code === 'EACCES' ? `no permission to listen on port ${cfg.port}`
        : e.message;
      console.error(`envrolled: ${msg}`);
      process.exit(1);
    });
    server.listen(cfg.port, cfg.host, () => {
      const a = server.address();
      console.log(`envrolled trap listening on ${a.address}:${a.port}`);
      console.log(`redirecting to ${cfg.redirect}`);
      if (cfg.notify) console.log('notifications: on');
      if (cfg.log) console.log(`logging to ${cfg.log}`);
    });
    return;
  }

  throw new Error(`Unknown command "${cmd}". Try --help.`);
}

try {
  main();
} catch (e) {
  console.error(`envrolled: ${e.message}`);
  process.exitCode = 1;
}
