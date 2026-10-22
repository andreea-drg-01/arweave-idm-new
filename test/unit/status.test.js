import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatusList } from '../../src/status.js';

test('set / get / clear bits', () => {
  const l = new StatusList();
  assert.equal(l.get(0), false);
  l.set(0); l.set(7); l.set(8); l.set(131071);
  assert.equal(l.get(0), true);
  assert.equal(l.get(7), true);
  assert.equal(l.get(8), true);
  assert.equal(l.get(131071), true);
  assert.equal(l.get(1), false);
  l.set(7, false);
  assert.equal(l.get(7), false);
});

test('out-of-range index throws', () => {
  const l = new StatusList();
  assert.throws(() => l.set(131072), RangeError);
  assert.throws(() => l.get(-1), RangeError);
});

test('encode / decode round-trip; empty list compresses far below 16 KiB', () => {
  const l = new StatusList();
  l.set(42); l.set(99999);
  const enc = l.encode();
  const back = StatusList.decode(enc);
  assert.equal(back.get(42), true);
  assert.equal(back.get(99999), true);
  assert.equal(back.get(43), false);
  assert.ok(Buffer.from(new StatusList().encode(), 'base64').length < 1024);
});
