import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../src/format.js', import.meta.url), 'utf8');
const { compactEnergy, exactEnergy } = runInNewContext(source + ';EnergyFormat');

test('small energy keeps one decimal', () => {
  assert.equal(compactEnergy(0), '0.0');
  assert.equal(compactEnergy(3.44), '3.4');
  assert.equal(compactEnergy(99.94), '99.9');
});

test('hundreds drop the decimal', () => {
  assert.equal(compactEnergy(99.96), '100');
  assert.equal(compactEnergy(123.4), '123');
  assert.equal(compactEnergy(999.4), '999');
});

test('large energy uses three significant digits and a suffix', () => {
  assert.equal(compactEnergy(999.6), '1K');
  assert.equal(compactEnergy(1234), '1.23K');
  assert.equal(compactEnergy(12_345), '12.3K');
  assert.equal(compactEnergy(123_456), '123K');
  assert.equal(compactEnergy(999_950), '1M');
  assert.equal(compactEnergy(3_400_000), '3.4M');
  assert.equal(compactEnergy(2_000_000_000), '2B');
  assert.equal(compactEnergy(987_654_321_012), '988B');
  assert.equal(compactEnergy(4.56e12), '4.56T');
  assert.equal(compactEnergy(1.234e15), '1.2e15');
  assert.equal(compactEnergy(999.99e12), '1e15');
});

test('compact labels stay short for any magnitude', () => {
  for (let tenths = 0; tenths < 150; tenths++) {
    const value = 10 ** (tenths / 10);
    assert.ok(compactEnergy(value).length <= 5, String(value));
  }
});

test('negative energy keeps its sign', () => {
  assert.equal(compactEnergy(-12_345), '−12.3K');
});

test('missing values read as zero', () => {
  assert.equal(compactEnergy(undefined), '0.0');
  assert.equal(exactEnergy(NaN), '0.0');
});

test('exact energy groups digits and keeps one decimal', () => {
  assert.equal(exactEnergy(2), '2.0');
  assert.equal(exactEnergy(987_654_321_012.34), '987,654,321,012.3');
});
