import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const cloudModelSource = await readFile(new URL('../src/cloud-render-model.js', import.meta.url), 'utf8');

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

test('SatCORPS physical cloud fields drive height, spherical shadows, phase, and night attenuation', () => {
  assert.match(mainSource, /cloudPhysicsFrom: \{ value:/);
  assert.match(mainSource, /cloudPhysicsTo: \{ value:/);
  assert.match(mainSource, /cloudAgeFrom: \{ value:/);
  assert.match(mainSource, /float cloudRadius=1\.0\+heightKm\/6371\.0/);
  assert.match(mainSource, /CLOUD_RENDER_GLSL/);
  assert.match(cloudModelSource, /vec2 sphericalCloudShadowUv\(/);
  assert.match(cloudModelSource, /float decodeCloudOpticalDepth\(/);
  assert.match(cloudModelSource, /float cloudTransmission\(/);
  assert.match(mainSource, /vec4 casterPhysics=mix\(texture2D\(cloudPhysicsFrom,shadowUv1\),texture2D\(cloudPhysicsTo,shadowUv1\),cloudMix\)/);
  assert.match(mainSource, /vec4 casterWeather=mix\(texture2D\(cloudDensityFrom,shadowUv1\),texture2D\(cloudDensityTo,shadowUv1\),cloudMix\)/);
  assert.match(mainSource, /night\*=cloudTransmission\(opticalDepth,cloudQuality\)/);
  assert.match(mainSource, /float icePhase=physics\.g/);
  assert.doesNotMatch(mainSource, /mix\(vec3\(\.018,\.03,\.052\),litCloud/);
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

test('every unretrieved optical depth comes from the one shared assumed-thickness curve', () => {
  // The direct, caster and cloud-layer expressions are the same physical
  // quantity; #21 was one coefficient written three times, and a divergence
  // between them would be the same defect again.
  assert.doesNotMatch(mainSource, /-log\(max\(1\.0-\w+\.?\w*\*\.82,\.01\)\)/);
  assert.match(mainSource, /opticalDepth=mix\(assumedCloudOpticalDepth\(localCloud\.a\),opticalDepth,physicalWeight\)/);
  assert.match(mainSource, /casterOpticalDepth=mix\(assumedCloudOpticalDepth\(cloudShadow1\),casterOpticalDepth,casterPhysicalWeight\)/);
  assert.match(mainSource, /opticalDepth=mix\(assumedCloudOpticalDepth\(cloud\.a\),opticalDepth,physicalWeight\)/);
  assert.equal(mainSource.match(/assumedCloudOpticalDepth\(/g).length, 3);
  assert.match(cloudModelSource, /float assumedCloudOpticalDepth\(/);
});
