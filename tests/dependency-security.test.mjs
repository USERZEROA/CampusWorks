import test from 'node:test';
import assert from 'node:assert/strict';
import merge from '../vendor/safe-deepmerge/index.cjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('merge rejects prototype keys in targets, sources, nested records and arrays', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const payload = JSON.parse(`{"${key}":{"poisoned":true},"safe":{"value":1}}`);
    for (const result of [merge(payload, {}), merge({}, payload), merge({ nested: payload }, {}), merge({}, { list: [payload] })]) {
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.poisoned, undefined);
      assert.equal(Object.hasOwn(result, key), false);
      assert.equal(result.nested?.poisoned, undefined);
      assert.equal(result.list?.[0]?.poisoned, undefined);
    }
    assert.equal({}.poisoned, undefined);
  }
});

test('merge preserves build resolver merge behavior and explicit options', () => {
  const symbol = Symbol('flag');
  const date = new Date();
  const source = { a: { right: 2 }, list: [2], date, [symbol]: true };
  const target = { a: { left: 1 }, list: [1] };
  const result = merge(target, source);
  assert.deepEqual(result.a, { left: 1, right: 2 });
  assert.deepEqual(result.list, [1, 2]);
  assert.equal(result.date, date);
  assert.equal(result[symbol], true);
  assert.deepEqual(target, { a: { left: 1 }, list: [1] });
  assert.deepEqual(merge({ a: [1] }, { a: [2] }, { arrayMerge: (_t, s) => s }), { a: [2] });
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
  assert.throws(() => merge.all(null), TypeError);
});

test('the resolver actually receives the safe implementation', () => {
  const resolver = createRequire(require.resolve('@rollup/plugin-node-resolve'));
  assert.equal(resolver('deepmerge'), merge);
});
