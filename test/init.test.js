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
  assert.match(text, /^API_BASE_URL=https:\/\/trap\.example\.com\/t\/envr_[0-9a-f]{20}$/m);
  assert.equal(Object.keys(r.tokens).length, 8);
  assert.ok(existsSync(join(d, 's.json')));
});

test('decoys never look like vendor secrets', () => {
  const { text } = buildDecoy({ trap: 'https://t.example', count: 14 });
  assert.doesNotMatch(text, /AKIA|sk-|ghp_|sk_live|pk_live|xox[bp]-/);
});

test('init refuses to overwrite without --force', () => {
  const d = dir();
  const out = join(d, 'decoy.bak');
  writeFileSync(out, 'keep me');
  assert.throws(() => runInit({ trap: 'https://t.example', out, stateFile: join(d, 's') }), /already exists/);
  assert.equal(readFileSync(out, 'utf8'), 'keep me');
  runInit({ trap: 'https://t.example', out, force: true, stateFile: join(d, 's') });
  assert.match(readFileSync(out, 'utf8'), /envr_/);
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
  assert.match(t, /^envr_[0-9a-f]{20}$/);
  assert.equal(findToken(`/t/${t}?x=1`), t);
  assert.equal(findToken(null, `Bearer ${t}`), t);
  assert.equal(findToken('/t/nothing'), null);
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
