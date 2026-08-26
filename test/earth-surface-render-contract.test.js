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

test('cloud color, opacity, quality, and surface shadow crossfade as two complete hourly states', () => {
  assert.match(mainSource, /cloudMapFrom: \{ value:/);
  assert.match(mainSource, /cloudMapTo: \{ value:/);
  assert.match(mainSource, /cloudDensityFrom: \{ value:/);
  assert.match(mainSource, /cloudDensityTo: \{ value:/);
  assert.match(mainSource, /cloudMix: \{ value: 0 \}/);
  assert.match(mainSource, /mix\(texture2D\(cloudMapFrom,vUv\),texture2D\(cloudMapTo,vUv\),cloudMix\)/);
  assert.match(mainSource, /mix\(texture2D\(cloudDensityFrom,vUv\),texture2D\(cloudDensityTo,vUv\),cloudMix\)/);
});

test('daily land snow and sea ice have separate physical surface semantics', () => {
  assert.match(mainSource, /uniform sampler2D snowCoverMap; uniform sampler2D seaIceMap;/);
  assert.match(mainSource, /float snowCover=texture2D\(snowCoverMap,vUv\)\.r;/);
  assert.match(mainSource, /float seaIce=texture2D\(seaIceMap,vUv\)\.r;/);
  assert.match(mainSource, /float landSnow=snowCover;/);
  assert.match(mainSource, /float oceanIce=seaIce;/);
  assert.doesNotMatch(mainSource, /snowCover\*\(1\.0-ocean\)|seaIce\*ocean/);
  assert.match(mainSource, /roughness=mix\(roughness,[^,]+,oceanIce\)/);
  assert.doesNotMatch(mainSource, /cloud[^;\n]*snowCover|snowCover[^;\n]*cloud/i);
});
