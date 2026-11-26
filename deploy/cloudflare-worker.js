// SPDX-License-Identifier: GPL-3.0-or-later
// envrolled trap as a Cloudflare Worker. Same behaviour as `envrolled serve`:
// log (to Worker logs), optionally notify a webhook, redirect. Nothing else.
//
// Env vars (wrangler.toml [vars] or secrets):
//   REDIRECT_URL  absolute http(s) URL to send visitors to (default: Rick Astley)
//   TOKEN_PREFIX  optional, only if you used `init --prefix`
//   NOTIFY_URL    optional webhook (Discord / Slack / generic JSON / Telegram sendMessage)
//
// The redirect target comes ONLY from REDIRECT_URL, never from the request.

const DEFAULT_REDIRECT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
// Same recognition as the CLI (src/token.js): three token shapes, optionally with TOKEN_PREFIX,
// as a whole path segment or standing alone in the query / headers.
const HEX = '[0-9a-f]{24}';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const B64 = '[A-Za-z0-9_-]{32}';
const isB64 = (s) => /^[A-Za-z0-9_-]{32}$/.test(s) && /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);
const isBare = (s) => new RegExp(`^(?:${HEX}|${UUID})$`).test(s) || isB64(s);
function findToken(url, headers, prefix) {
  const p = /^[A-Za-z0-9_-]{1,16}$/.test(prefix || '') ? prefix : '';
  const strip = (s) => (p && s.startsWith(p) ? s.slice(p.length) : s);
  for (const seg of url.pathname.split('/')) if (isBare(strip(seg)) || isBare(seg)) return seg;
  const re = new RegExp(`(?<![A-Za-z0-9_-])(?:${p})?(?:${UUID}|${B64}|${HEX})(?![A-Za-z0-9_-])`, 'g');
  for (const s of [url.pathname + url.search, ...headers]) {
    if (!s) continue;
    for (const m of s.matchAll(re)) if (isBare(strip(m[0])) || isBare(m[0])) return m[0];
  }
  return null;
}
const WINDOW_MS = 60_000;
const lastNotified = new Map(); // best-effort per-isolate rate limit (ip -> ts)

const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);

function safeUrl(value, fallback) {
  try {
    const u = new URL(value);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return fallback;
}

async function notify(url, hit) {
  const now = Date.now();
  if (lastNotified.size > 2000) lastNotified.clear();
  const prev = lastNotified.get(hit.ip);
  if (prev !== undefined && now - prev < WINDOW_MS) return;
  lastNotified.set(hit.ip, now);
  const text = `envrolled: trap hit from ${hit.ip} ${hit.method} ${hit.path}` +
    (hit.token ? ` (token ${hit.token})` : '') + ` UA: ${hit.userAgent}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text, allowed_mentions: { parse: [] }, event: 'envrolled.hit', hit }),
    });
  } catch {}
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok\n');

    const redirect = safeUrl(env.REDIRECT_URL, DEFAULT_REDIRECT);
    if (env.REDIRECT_URL && redirect === DEFAULT_REDIRECT && env.REDIRECT_URL !== DEFAULT_REDIRECT) {
      console.error('envrolled: REDIRECT_URL is not a valid http(s) URL, falling back to the default video');
    }
    const h = request.headers;
    const hit = {
      time: new Date().toISOString(),
      ip: clean(h.get('cf-connecting-ip') || 'unknown', 64),
      method: clean(request.method, 16),
      path: clean(url.pathname + url.search),
      userAgent: clean(h.get('user-agent')),
      token: findToken(url, [h.get('authorization'), h.get('x-api-key')], env.TOKEN_PREFIX),
    };
    console.log(JSON.stringify(hit)); // visible in `wrangler tail` / Workers Logs
    const hook = env.NOTIFY_URL && safeUrl(env.NOTIFY_URL, null);
    if (hook) ctx.waitUntil(notify(hook, hit));

    return new Response(null, { status: 302, headers: { location: redirect, 'cache-control': 'no-store' } });
  },
};
