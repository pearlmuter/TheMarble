import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');

test('the surface shader blends adjacent seasonal textures continuously', () => {
  assert.match(mainSource, /uniform sampler2D dayMapFrom; uniform sampler2D dayMapTo; uniform float seasonalMix;/);
  assert.match(mainSource, /mix\(texture2D\(dayMapFrom,vUv\)\.rgb,texture2D\(dayMapTo,vUv\)\.rgb,seasonalMix\)/);
});

test('the physical ocean uses the surface terminator astronomical Sun vector', () => {
  assert.match(mainSource, /uniform vec3 sunDirection;/);
  assert.match(mainSource, /vec3 sunView=normalize\(\(viewMatrix\*vec4\(sunDirection,0\.0\)\)\.xyz\)/);
  assert.match(mainSource, /vec3 halfVector=normalize\(sunView\+viewDirection\)/);
  assert.doesNotMatch(mainSource, /oceanSun(Direction)?/);
});
