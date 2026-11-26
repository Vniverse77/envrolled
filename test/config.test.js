import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig, loadConfigFile } from '../src/config.js';
import { validateRedirect, DEFAULT_REDIRECT } from '../src/redirect.js';

test('redirect validation', () => {
  assert.equal(validateRedirect('https://example.com/v'), 'https://example.com/v');
  assert.equal(validateRedirect('http://localhost:3000/'), 'http://localhost:3000/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '/relative', '//evil.com', 'ftp://x.com', '', 'file:///etc/passwd']) {
    assert.throws(() => validateRedirect(bad), /Invalid redirect/, bad);
  }
});

test('defaults', () => {
  const { values, sources } = resolveConfig({});
  assert.equal(values.port, 8787);
  assert.equal(values.redirect, DEFAULT_REDIRECT);
  assert.equal(sources.port, 'default');
});

test('precedence: flag > env > file > default', () => {
  const file = { redirect: 'https://file.example/', port: 1111 };
  const env = { ENVROLLED_REDIRECT: 'https://env.example/', ENVROLLED_PORT: '2222' };
  let r = resolveConfig({ file });
  assert.equal(r.values.redirect, 'https://file.example/');
  assert.equal(r.sources.redirect, 'file');
  r = resolveConfig({ file, env });
  assert.equal(r.values.redirect, 'https://env.example/');
  assert.equal(r.values.port, 2222);
  r = resolveConfig({ file, env, flags: { redirect: 'https://flag.example/', port: '3333' } });
  assert.equal(r.values.redirect, 'https://flag.example/');
  assert.equal(r.values.port, 3333);
  assert.equal(r.sources.redirect, 'flag');
});

test('PORT env is honoured, ENVROLLED_PORT wins', () => {
  assert.equal(resolveConfig({ env: { PORT: '9000' } }).values.port, 9000);
  assert.equal(resolveConfig({ env: { PORT: '9000', ENVROLLED_PORT: '9001' } }).values.port, 9001);
});

test('invalid redirect from any source is rejected', () => {
  assert.throws(() => resolveConfig({ env: { ENVROLLED_REDIRECT: 'javascript:alert(1)' } }));
  assert.throws(() => resolveConfig({ file: { redirect: 'data:x' } }));
});

test('booleans from env', () => {
  assert.equal(resolveConfig({ env: { ENVROLLED_TRUST_PROXY: 'true' } }).values.trustProxy, true);
  assert.equal(resolveConfig({ env: { ENVROLLED_STATS: '0' } }).values.stats, false);
});

test('config file: null is {}, array and scalars give a clear error', () => {
  const d = mkdtempSync(join(tmpdir(), 'envr-'));
  const f = (txt) => { const p = join(d, 'c.json'); writeFileSync(p, txt); return p; };
  assert.deepEqual(loadConfigFile(f('null')), {});
  assert.throws(() => loadConfigFile(f('[1]')), /must be a JSON object/);
  assert.throws(() => loadConfigFile(f('"x"')), /must be a JSON object/);
  assert.throws(() => loadConfigFile(f('{bad')), /Cannot parse/);
});

test('bad notify gives a notify-specific message', () => {
  assert.throws(() => resolveConfig({ flags: { notify: 'nope' } }), /Invalid notify URL/);
  assert.throws(() => resolveConfig({ flags: { redirect: 'nope' } }), /Invalid redirect URL/);
});

test('statsPort: defaults to 127.0.0.1, derives stats with correct source, must differ from port', () => {
  const r = resolveConfig({ env: { ENVROLLED_STATS_PORT: '9100' } });
  assert.equal(r.values.statsPort, 9100);
  assert.equal(r.values.statsHost, '127.0.0.1');
  assert.equal(r.values.stats, true);
  assert.match(r.sources.stats, /derived.*env:ENVROLLED_STATS_PORT/);
  assert.equal(resolveConfig({ env: { ENVROLLED_STATS_PORT: '9100', ENVROLLED_STATS_HOST: '10.0.0.5' } }).values.statsHost, '10.0.0.5');
  assert.equal(resolveConfig({ file: { statsPort: 9100, statsHost: '::1' } }).values.statsHost, '::1');
  assert.throws(() => resolveConfig({ flags: { port: '8787', statsPort: '8787' } }), /must differ from --port/);
  assert.throws(() => resolveConfig({ env: { PORT: '9000', ENVROLLED_STATS_PORT: '9000' } }), /must differ/);
  assert.equal(resolveConfig({ flags: { stats: true } }).sources.stats, 'flag');
});
