import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, buildDecoy, defaultStateFile } from '../src/init.js';
import { findToken, makeToken } from '../src/token.js';

const dir = () => mkdtempSync(join(tmpdir(), 'envr-'));

test('init writes KEY=value lines pointing at the trap', () => {
  const d = dir();
  const out = join(d, '.env.production.bak');
  const r = runInit({ trap: 'https://trap.example.com/', out, stateFile: join(d, 's.json') });
  const text = readFileSync(out, 'utf8');
  assert.match(text, /^[A-Z_]+_(URL|ENDPOINT)=https:\/\/trap\.example\.com(\/[a-z0-9]+)+\/[0-9a-f]{24}$/m);
  assert.ok(Object.keys(r.tokens).length >= 7 && Object.keys(r.tokens).length <= 9);
  assert.ok(existsSync(join(d, 's.json')));
});

test('decoys never look like vendor secrets (50 files)', () => {
  for (let i = 0; i < 50; i++) {
    const { text, tokens } = buildDecoy({ trap: 'https://t.example', count: 14 });
    assert.doesNotMatch(text, /AKIA|ASIA|sk-|ghp_|gho_|sk_live|pk_live|xox[a-z]-?|AIza|eyJ/);
    for (const t of Object.values(tokens)) assert.match(t, /^[0-9a-f]{24}$/); // not 32/40 hex
  }
});

test('default decoy output has no tool name and no honesty marker', () => {
  const { text } = buildDecoy({ trap: 'https://trap.example.com' });
  assert.doesNotMatch(text, /envr|decoy|honeytoken/i);
  assert.match(text.split('\n')[0], /^# /);
});

test('--label adds a neutral comment', () => {
  const { text } = buildDecoy({ trap: 'https://trap.example.com', label: true });
  assert.match(text, /^# Decoy file: .*honeytokens/m);
  assert.doesNotMatch(text, /envr/i);
});

test('--prefix is applied to tokens', () => {
  const { tokens } = buildDecoy({ trap: 'https://t.example', prefix: 'zz_' });
  for (const t of Object.values(tokens)) assert.match(t, /^zz_[0-9a-f]{24}$/);
});

test('init refuses to overwrite without --force', () => {
  const d = dir();
  const out = join(d, 'decoy.bak');
  writeFileSync(out, 'keep me');
  assert.throws(() => runInit({ trap: 'https://t.example', out, stateFile: join(d, 's') }), /already exists/);
  assert.equal(readFileSync(out, 'utf8'), 'keep me');
  runInit({ trap: 'https://t.example', out, force: true, stateFile: join(d, 's') });
  assert.match(readFileSync(out, 'utf8'), /[0-9a-f]{24}/);
});

test('init never touches real .env names', () => {
  const d = dir();
  for (const n of ['.env', '.env.local', '.env.production']) {
    assert.throws(() => runInit({ trap: 'https://t.example', out: join(d, n), force: true, stateFile: join(d, 's') }), /real env file/);
  }
});

test('init requires --trap and an http(s) url', () => {
  assert.throws(() => runInit({}), /--trap/);
  assert.throws(() => buildDecoy({ trap: 'ftp://x' }), /http/);
});

test('token recognition', () => {
  const t = makeToken();
  assert.match(t, /^[0-9a-f]{24}$/);
  assert.equal(findToken({ url: `/t/${t}?x=1` }), t);
  assert.equal(findToken({ url: '/other', headers: [null, `Bearer ${t}`] }), t);
  assert.equal(findToken({ url: `/other?k=${t}` }), t);
  assert.equal(findToken({ url: '/nothing', headers: ['abc'] }), null);
  const p = makeToken('zz_');
  assert.match(p, /^zz_[0-9a-f]{24}$/);
  assert.equal(findToken({ url: '/x', headers: [`Bearer ${p}`], prefix: 'zz_' }), p);
  assert.equal(findToken({ url: '/t/zzzzzzzz' }), null);
  assert.equal(findToken({ url: `/admin/session/${t}` }), t);
  assert.equal(findToken({ url: `/a/b/zz_${t}/c`, prefix: 'zz_' }), `zz_${t}`);
  assert.equal(findToken({ url: '/t/envr_0123' }), null);
  for (const bad of ['AKIA', 'ya29.', 'hf_', 'gsk_', 'shpat_', 'dop_', 'sq0', 'key-', 'sk-']) assert.throws(() => makeToken(bad), /vendor|--prefix/, bad);
  assert.throws(() => makeToken('bad prefix'), /--prefix/);
});

test('second init keeps the first token list (state merge)', () => {
  const d = dir();
  const st = join(d, 's.json');
  const a = runInit({ trap: 'https://t.example', out: join(d, 'a.bak'), stateFile: st });
  const b = runInit({ trap: 'https://t.example', out: join(d, 'd2.bak'), stateFile: st });
  const runs = JSON.parse(readFileSync(st, 'utf8')).runs;
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].tokens, a.tokens);
  assert.deepEqual(runs[1].tokens, b.tokens);
});

test('corrupt state file is not overwritten without --force', () => {
  const d = dir();
  const st = join(d, 's.json');
  writeFileSync(st, '{oops');
  assert.throws(() => runInit({ trap: 'https://t.example', out: join(d, 'a.bak'), stateFile: st }), /corrupt/);
  assert.equal(readFileSync(st, 'utf8'), '{oops');
  assert.ok(!existsSync(join(d, 'a.bak')));
  runInit({ trap: 'https://t.example', out: join(d, 'a.bak'), stateFile: st, force: true });
  assert.equal(JSON.parse(readFileSync(st, 'utf8')).runs.length, 1);
});

test('real-env guard is case-insensitive and covers .env.*', () => {
  const d = dir();
  for (const n of ['.ENV', '.Env.Local', '.env.prod', '.env.dev', '.env.example', '.env.local']) {
    assert.throws(() => runInit({ trap: 'https://t.example', out: join(d, n), force: true, stateFile: join(d, 's') }), /real env file/, n);
  }
  for (const n of ['.env.production.bak', '.env.x.decoy', 'decoy.env', 'config.bak']) {
    runInit({ trap: 'https://t.example', out: join(d, n), force: true, stateFile: join(d, 's') });
  }
});

test('field-specific error for bad --trap', () => {
  assert.throws(() => buildDecoy({ trap: 'notaurl' }), /Invalid --trap URL/);
});

test('URL paths are varied, end in the token, and --path forces one prefix', () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const { urls } = buildDecoy({ trap: 'https://t.example', count: 12 });
    for (const u of Object.values(urls)) {
      assert.match(u, /^https:\/\/t\.example\/[a-z0-9\/]+\/[0-9a-f]{24}$/);
      seen.add(u.replace(/\/[0-9a-f]{24}$/, ''));
    }
  }
  assert.ok(seen.size >= 6, `only ${seen.size} distinct paths`);
  const { urls } = buildDecoy({ trap: 'https://t.example', path: 'v9/', count: 10 });
  for (const u of Object.values(urls)) assert.match(u, /^https:\/\/t\.example\/v9\/[0-9a-f]{24}$/);
  assert.throws(() => buildDecoy({ trap: 'https://t.example', path: '../x' }), /--path/);
});

test('no two default runs share a layout; plain lines mixed in', () => {
  const layouts = new Set();
  for (let i = 0; i < 15; i++) {
    const { text } = buildDecoy({ trap: 'https://t.example' });
    assert.match(text, /^(NODE_ENV|PORT|LOG_LEVEL|APP_NAME|TZ|WORKERS)=/m);
    assert.doesNotMatch(text, /DATABASE_URL|PRIVATE KEY/);
    layouts.add(text.replace(/[0-9a-f]{24}/g, 'T'));
  }
  assert.equal(layouts.size, 15);
});

test('--count controls decoy variable count', () => {
  const { tokens } = buildDecoy({ trap: 'https://t.example', count: 5 });
  assert.equal(Object.keys(tokens).length, 5);
});

test('state file: default outside project (XDG / Windows), --state honoured, legacy migrated', () => {
  assert.equal(defaultStateFile({ XDG_STATE_HOME: '/x/state' }, 'linux', '/h'), '/x/state/envrolled/state.json');
  assert.equal(defaultStateFile({}, 'linux', '/h'), '/h/.local/state/envrolled/state.json');
  assert.match(defaultStateFile({ LOCALAPPDATA: '/L' }, 'win32', '/h'), /L.envrolled.state\.json$/);
  const d = dir();
  const legacy = join(d, '.envrolled.json');
  writeFileSync(legacy, JSON.stringify({ created: 'x', trap: 'https://old', file: 'o', tokens: { A: 'old' } }));
  const st = join(d, 'sub', 'state.json');
  const r = runInit({ trap: 'https://t.example', out: join(d, 'a.bak'), stateFile: st, legacyFile: legacy });
  assert.equal(r.stateFile, st);
  assert.equal(r.migratedFrom, legacy);
  const runs = JSON.parse(readFileSync(st, 'utf8')).runs;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].tokens.A, 'old');
  assert.ok(runs[1].urls);
  assert.ok(existsSync(legacy)); // old file left in place
  assert.ok(!existsSync(join(d, '.envrolled.json.new')));
});
