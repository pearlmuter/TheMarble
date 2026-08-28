import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the hidden corner owns a labeled, initially hidden provenance region and concise accessible status', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="provenance-trigger"[^>]*aria-controls="provenance-panel"[^>]*aria-expanded="false"[^>]*aria-describedby="earth-state-summary"/s);
  assert.match(html, /id="provenance-panel"[^>]*role="region"[^>]*aria-labelledby="provenance-title"[^>]*hidden/s);
  assert.match(html, /id="earth-state-summary"[^>]*class="sr-only"/s);
  assert.doesNotMatch(html, /id="earth-state-summary"[^>]*aria-live=/s);
});

test('touch devices do not receive permanently visible provenance chrome', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@media\s*\(hover:\s*none\)[\s\S]*?\.hud\s*\{[^}]*opacity:\s*1/);
});
