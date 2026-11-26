// SPDX-License-Identifier: GPL-3.0-or-later
// envrolled trap as a Cloudflare Worker. Same behaviour as `envrolled serve`:
// log (to Worker logs), optionally notify a webhook, redirect. Nothing else.
//
// Env vars (wrangler.toml [vars] or secrets):
//   REDIRECT_URL  absolute http(s) URL to send visitors to (default: Rick Astley)
//   NOTIFY_URL    optional webhook (Discord / Slack / generic JSON / Telegram sendMessage)
//
// The redirect target comes ONLY from REDIRECT_URL, never from the request.

const DEFAULT_REDIRECT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const TOKEN_RE = /envr_[0-9a-f]{20}/;
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
      token: [url.pathname + url.search, h.get('authorization'), h.get('x-api-key')]
        .map((s) => TOKEN_RE.exec(s || '')?.[0]).find(Boolean) || null,
    };
    console.log(JSON.stringify(hit)); // visible in `wrangler tail` / Workers Logs
    const hook = env.NOTIFY_URL && safeUrl(env.NOTIFY_URL, null);
    if (hook) ctx.waitUntil(notify(hook, hit));

    return new Response(null, { status: 302, headers: { location: redirect, 'cache-control': 'no-store' } });
  },
};
