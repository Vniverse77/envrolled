// SPDX-License-Identifier: GPL-3.0-or-later
// The trap server: log every request, maybe notify, 302 to the configured URL.
// It serves no content and runs no code on visitors; it only logs and redirects.
import { createServer as httpServer } from 'node:http';
import { appendFile, readFileSync, appendFileSync } from 'node:fs';
import { findToken } from './token.js';
import { createNotifier, clean } from './notify.js';
import { validateRedirect } from './redirect.js';

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return clean(cf, 64);
    const real = req.headers['x-real-ip'];
    if (real) return clean(real, 64);
    // Rightmost entry is the one appended by the nearest proxy; leftmost is client-controlled.
    const xff = req.headers['x-forwarded-for'];
    if (xff) return clean(String(xff).split(',').pop().trim(), 64);
  }
  return req.socket.remoteAddress || 'unknown';
}

const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function createTrap(opts) {
  const redirect = validateRedirect(opts.redirect); // fixed at startup
  const { log = null, trustProxy = false, stats = false, onError = () => {}, now = () => new Date() } = opts;
  const notify = createNotifier({ url: opts.notify, fetchImpl: opts.fetchImpl, onError });
  const counts = { total: 0, byDay: {} };

  // Fail early if the log cannot be written.
  if (log) {
    try { appendFileSync(log, ''); } catch (e) { throw new Error(`Cannot write log file "${log}": ${e.message}`); }
  }

  // Seed counters from an existing log so /stats survives restarts.
  if (log) {
    let text = '';
    try { text = readFileSync(log, 'utf8'); } catch {}
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const day = JSON.parse(line).time?.slice(0, 10);
        counts.total++;
        if (day) counts.byDay[day] = (counts.byDay[day] || 0) + 1;
      } catch {} // skip a malformed line, keep seeding
    }
  }

  const server = httpServer((req, res) => {
    const path = (req.url || '/').split('?')[0];

    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n');
      return;
    }
    if (stats && path === '/stats') {
      const body = { total: counts.total, today: counts.byDay[today(now())] || 0 }; // counts only, no IPs
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body) + '\n');
      return;
    }

    const h = req.headers;
    const hit = {
      time: now().toISOString(),
      ip: clientIp(req, trustProxy),
      method: clean(req.method, 16),
      path: clean(req.url || '/'),
      userAgent: clean(h['user-agent']),
      token: findToken(req.url, h.authorization, h['x-api-key'], h['x-auth-token']),
    };
    counts.total++;
    counts.byDay[hit.time.slice(0, 10)] = (counts.byDay[hit.time.slice(0, 10)] || 0) + 1;
    if (log) appendFile(log, JSON.stringify(hit) + '\n', (e) => e && onError(e));
    notify(hit);

    res.writeHead(302, { location: redirect, 'cache-control': 'no-store' }).end();
  });
  server.requestTimeout = 10_000;
  return { server, counts, redirect };
}
