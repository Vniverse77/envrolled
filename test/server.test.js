import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createTrap } from '../src/server.js';
import { createNotifier } from '../src/notify.js';

const bin = new URL('../bin/envrolled.js', import.meta.url).pathname;
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
  const res = await get(`${s.base}/t/0123456789abcdef01234567?a=1`, { 'user-agent': 'bot/1.0' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), REDIR);
  await settle();
  const line = JSON.parse(readFileSync(log, 'utf8').trim());
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/t/0123456789abcdef01234567?a=1');
  assert.equal(line.userAgent, 'bot/1.0');
  assert.equal(line.token, '0123456789abcdef01234567');
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
    await get(`${s.base}/`, { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    await settle();
    const ip = JSON.parse(readFileSync(log, 'utf8').trim()).ip;
    assert.equal(ip === '203.0.113.9', trust); // rightmost entry, not the forgeable leftmost
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

test('trustProxy header priority: CF-Connecting-IP > X-Real-IP > rightmost XFF', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'envr-')), 'h.jsonl');
  const s = await start({ log, trustProxy: true });
  await get(`${s.base}/`, { 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' });
  await get(`${s.base}/`, { 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' });
  await settle();
  const ips = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).ip).sort();
  assert.deepEqual(ips, ['1.1.1.1', '2.2.2.2']);
  await s.close();
});

test('malformed log line does not stop /stats seeding', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'envr-')), 'h.jsonl');
  const day = new Date().toISOString();
  writeFileSync(log, `{"time":"${day}"}\nnot json\n{"time":"${day}"}\n`);
  const s = await start({ log, stats: true });
  assert.equal((await (await get(`${s.base}/stats`)).json()).total, 2);
  await s.close();
});

test('unwritable log path fails at startup with a clear message', () => {
  assert.throws(() => createTrap({ redirect: REDIR, log: '/nonexistent-dir/x.jsonl' }), /Cannot write log file/);
});

test('CLI: port in use gives a clean message and exit code 1', async () => {
  const blocker = createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  const r = spawnSync(process.execPath, [bin, 'serve', '--host', '127.0.0.1', '--port', String(port)], { encoding: 'utf8', timeout: 10000, cwd: tmpdir() });
  blocker.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already in use/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('unrecognised or odd paths still 302 to the configured URL', async () => {
  const s = await start({});
  for (const path of ['/', '/t/', '/t/x', '/random?token=nope', '/admin/session/0123456789abcdef01234567']) {
    const res = await get(`${s.base}${path}`);
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('location'), REDIR);
  }
  await s.close();
});

test('header token and custom prefix recognised', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'envr-')), 'h.jsonl');
  const s = await start({ log, prefix: 'zz_' });
  await get(`${s.base}/api`, { authorization: 'Bearer zz_0123456789abcdef01234567' });
  await get(`${s.base}/api`, { 'x-api-key': '0123456789abcdef01234567' });
  await settle();
  const toks = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).token);
  assert.deepEqual(toks, ['zz_0123456789abcdef01234567', '0123456789abcdef01234567']);
  await s.close();
});

test('token anywhere in the path is logged; noise gives null; 302 has content-length 0', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'envr-')), 'h.jsonl');
  const s = await start({ log });
  const r1 = await get(`${s.base}/hooks/payments/0123456789abcdef01234567`);
  assert.equal(r1.headers.get('content-length'), '0');
  await get(`${s.base}/t/zzzzzzzz`);
  await settle();
  const toks = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).token);
  assert.deepEqual(toks, ['0123456789abcdef01234567', null]);
  await s.close();
});

test('stats-port serves /stats separately and not on the trap port', async () => {
  const { server, statsServer } = createTrap({ redirect: REDIR, stats: true, statsPort: 1 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => statsServer.listen(0, '127.0.0.1', r));
  const trap = `http://127.0.0.1:${server.address().port}`;
  const adm = `http://127.0.0.1:${statsServer.address().port}`;
  assert.equal((await get(`${trap}/stats`)).status, 302);
  const body = await (await get(`${adm}/stats`)).json();
  assert.equal(body.total, 1);
  assert.equal((await get(`${adm}/other`)).status, 404);
  await new Promise((r) => server.close(r));
  await new Promise((r) => statsServer.close(r));
});
