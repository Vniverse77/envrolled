import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrap } from '../src/server.js';
import { createNotifier } from '../src/notify.js';

const REDIR = 'https://example.com/video';

async function start(opts) {
  const { server, counts } = createTrap({ redirect: REDIR, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, counts, close: () => new Promise((r) => server.close(r)) };
}
const get = (url, headers) => fetch(url, { redirect: 'manual', headers });
const settle = () => new Promise((r) => setTimeout(r, 50));

test('302 to configured URL, JSONL log, token recognised', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'envr-')), 'hits.jsonl');
  const s = await start({ log });
  const res = await get(`${s.base}/t/envr_0123456789abcdef0123?a=1`, { 'user-agent': 'bot/1.0' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), REDIR);
  await settle();
  const line = JSON.parse(readFileSync(log, 'utf8').trim());
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/t/envr_0123456789abcdef0123?a=1');
  assert.equal(line.userAgent, 'bot/1.0');
  assert.equal(line.token, 'envr_0123456789abcdef0123');
  assert.ok(line.ip && line.time);
  await s.close();
});

test('redirect never comes from the request', async () => {
  const s = await start({});
  const res = await get(`${s.base}/?redirect=https://evil.example&next=//evil.example`, { host: 'evil.example' });
  assert.equal(res.headers.get('location'), REDIR);
  await s.close();
});

test('healthz is ok and not logged; stats counts only', async () => {
  const s = await start({ stats: true });
  assert.equal(await (await get(`${s.base}/healthz`)).text(), 'ok\n');
  assert.equal(s.counts.total, 0);
  await get(`${s.base}/x`);
  const stats = await (await get(`${s.base}/stats`)).json();
  assert.deepEqual(Object.keys(stats).sort(), ['today', 'total']);
  assert.equal(stats.total, 1);
  await s.close();
});

test('/stats is just another trap path when disabled', async () => {
  const s = await start({});
  assert.equal((await get(`${s.base}/stats`)).status, 302);
  await s.close();
});

test('X-Forwarded-For only honoured with trustProxy', async () => {
  for (const trust of [false, true]) {
    const log = join(mkdtempSync(join(tmpdir(), 'envr-')), 'h.jsonl');
    const s = await start({ log, trustProxy: trust });
    await get(`${s.base}/`, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    await settle();
    const ip = JSON.parse(readFileSync(log, 'utf8').trim()).ip;
    assert.equal(ip === '203.0.113.9', trust);
    await s.close();
  }
});

test('notification is rate limited per IP (mock fetch)', async () => {
  const calls = [];
  let t = 1000;
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  const n = createNotifier({ url: 'https://hook.example/x', fetchImpl, now: () => t });
  const hit = { ip: '1.1.1.1', method: 'GET', path: '/t/x', userAgent: 'ua\nline', token: null };
  assert.equal(await n(hit), true);
  assert.equal(await n(hit), false);
  assert.equal(await n({ ...hit, ip: '2.2.2.2' }), true);
  t += 61_000;
  assert.equal(await n(hit), true);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].body.text && calls[0].body.content);
  assert.doesNotMatch(calls[0].body.text, /\n/);
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [] });
});

test('server triggers webhook through mock fetch', async () => {
  const calls = [];
  const s = await start({ notify: 'https://hook.example/x', fetchImpl: async (u) => { calls.push(u); return { ok: true }; } });
  await get(`${s.base}/a`);
  await get(`${s.base}/b`);
  await settle();
  assert.equal(calls.length, 1); // same IP, rate limited
  await s.close();
});
