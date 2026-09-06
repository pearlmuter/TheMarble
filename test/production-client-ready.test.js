import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForProductionClient } from '../src/production-client-ready.js';

test('a slow bundled startup does not shorten the live activation deadline', async () => {
  let elapsed = 0;
  const page = {
    async waitForSelector(selector, { timeout }) {
      assert.equal(selector, '#loading[aria-hidden="true"]');
      assert.ok(timeout >= 100);
      elapsed += 100;
    },
    async waitForFunction(condition, unused, { timeout }) {
      // Live activation begins after the fallback; 280 ms is within its 300 ms deadline.
      if (timeout < 280) throw new Error('Live state still checking: monitor expired before activation deadline');
      elapsed += 280;
    },
  };
  await waitForProductionClient(page, 330);
  assert.equal(elapsed, 380);
});
