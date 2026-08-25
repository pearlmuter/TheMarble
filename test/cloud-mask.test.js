import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudAlpha, createCloudAlphaMask } from '../src/cloud-mask.js';

test('unobserved black satellite swaths are fully transparent', () => {
  assert.equal(cloudAlpha(0, 0, 0), 0);
  assert.equal(createCloudAlphaMask(new Uint8ClampedArray([0, 0, 0, 255]))[1], 0);
});

test('bright, neutral satellite pixels remain visible as clouds', () => {
  assert.ok(cloudAlpha(245, 245, 245) > 230);
});

test('warm, saturated land pixels do not become clouds', () => {
  assert.ok(cloudAlpha(175, 116, 61) < 2);
});
