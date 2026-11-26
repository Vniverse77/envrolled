// SPDX-License-Identifier: GPL-3.0-or-later
// Webhook notifications with a per-IP rate limit.
// Payload is generic JSON that also satisfies Discord ("content"), Slack
// ("text") and Telegram sendMessage ("text" + chat_id in the URL query).

const MAX_FIELD = 200;

/** Attacker-controlled text: strip control chars, cap length. */
export function clean(s, max = MAX_FIELD) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

export function createNotifier({ url, fetchImpl = globalThis.fetch, windowMs = 60_000, now = Date.now, onError = () => {} }) {
  const last = new Map(); // ip -> timestamp of last notification
  return async function notify(hit) {
    if (!url) return false;
    const t = now();
    if (last.size > 5000) {
      for (const [ip, ts] of last) if (t - ts > windowMs) last.delete(ip);
      if (last.size > 5000) last.clear();
    }
    const prev = last.get(hit.ip);
    if (prev !== undefined && t - prev < windowMs) return false;
    last.set(hit.ip, t);
    const text =
      `envrolled: trap hit from ${clean(hit.ip, 64)} ` +
      `${clean(hit.method, 16)} ${clean(hit.path)}` +
      (hit.token ? ` (token ${hit.token})` : '') +
      ` UA: ${clean(hit.userAgent)}`;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          content: text,
          allowed_mentions: { parse: [] }, // Discord: never ping anyone from attacker text
          event: 'envrolled.hit',
          hit,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) onError(new Error(`webhook answered ${res.status}`));
    } catch (e) {
      onError(e);
    }
    return true;
  };
}
