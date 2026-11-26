import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit, buildDecoy } from '../src/init.js';
import { findToken, makeToken } from '../src/token.js';

const dir = () => mkdtempSync(join(tmpdir(), 'envr-'));

test('init writes KEY=value lines pointing at the trap', () => {
  const d = dir();
  const out = join(d, '.env.production.bak');
  const r = runInit({ trap: 'https://trap.example.com/', out, stateFile: join(d, 's.json') });
  const text = readFileSync(out, 'utf8');
  assert.match(text, /^API_BASE_URL=https:\/\/trap\.example\.com\/t\/[0-9a-f]{24}$/m);
  assert.equal(Object.keys(r.tokens).length, 8);
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
  assert.match(text, /^# Production environment backup/);
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
  assert.equal(findToken({ url: '/t/anything-opaque_1' }), 'anything-opaque_1');
  assert.throws(() => makeToken('AKIA'), /vendor/);
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
