import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSUMED_THICK_CLOUD_OPTICAL_DEPTH } from '../src/cloud-render-model.js';
import { buildEarthStateProvenancePresentation, summarizeEarthStateRefreshFailure } from '../src/earth-state-provenance.js';

const asset = { href: './fixture.bin', mediaType: 'application/octet-stream', byteLength: 1, immutable: true, checksum: { algorithm: 'sha256', value: '0'.repeat(64) } };
const layer = datasetId => ({ datasetId, units: 'fixture', dimensions: { width: 2, height: 1 }, colorSpace: 'linear', channels: {}, textureSemantics: { mapping: 'equirectangular', sampling: 'linear' }, asset });

function contemporaryManifest() {
  const from = {
    validAt: '2026-08-28T10:00:00Z', observedFrom: '2026-08-28T09:50:00Z', observedTo: '2026-08-28T10:09:59Z', producedAt: '2026-08-28T10:15:00Z', retrievedAt: '2026-08-28T10:20:00Z',
    coverage: { observedFraction: .76, modelAssistedFraction: .19, fallbackFraction: .05, latitudeRange: [-90, 90] },
    layers: { cloudOpacity: { datasetId: 'satcorps', asset }, cloudDensity: { datasetId: 'satcorps', asset } },
    assistance: { polarObservation: { product: 'viirs-cloud', version: 'v2', observedFrom: '2026-08-28T09:50:00Z', observedTo: '2026-08-28T10:09:59Z' }, model: { product: 'gfs-total-cloud', version: '0p25', runAt: '2026-08-28T06:00:00Z', forecastHour: 4 }, staticFallback: 'bundled fair-cloud texture' },
  };
  const to = structuredClone(from);
  Object.assign(to, { validAt: '2026-08-28T11:00:00Z', observedFrom: '2026-08-28T10:50:00Z', observedTo: '2026-08-28T11:09:59Z', producedAt: '2026-08-28T11:15:00Z', retrievedAt: '2026-08-28T11:20:00Z' });
  to.assistance.model.forecastHour = 5;
  return {
    schemaVersion: 1,
    bundleId: 'earth-2026-08-28T11',
    classification: 'model-assisted',
    times: { observedFrom: '2026-08-20T00:00:00Z', observedTo: to.observedTo, validAt: to.validAt, producedAt: to.producedAt, retrievedAt: to.retrievedAt },
    datasets: [
      { id: 'satcorps', version: 'satcorps-v1', attribution: 'NASA Langley SatCORPS' },
      { id: 'gfs', version: 'gfs-0p25', attribution: 'NOAA/NCEP Global Forecast System' },
      { id: 'viirs-snow', version: 'v2.1', attribution: 'NOAA VIIRS snow' },
      { id: 'osi-sea-ice', version: 'osi-450-a', attribution: 'EUMETSAT OSI SAF' },
      { id: 'viirs-surface', version: 'vnp09', attribution: 'NASA VIIRS surface reflectance' },
    ],
    layers: {
      surfaceAlbedo: {
        ...layer('viirs-surface'),
        rollingComposite: {
          validAt: '2026-08-28T00:00:00Z', observedFrom: '2026-08-20T00:00:00Z', observedTo: '2026-08-27T23:59:59Z', producedAt: '2026-08-28T00:30:00Z', retrievedAt: '2026-08-28T00:35:00Z',
          coverage: { rollingFraction: .82, updatedFraction: .17, baselineFraction: .18 }, oldestPixelAgeDays: 8, newestPixelAgeDays: 1, sourceProducts: ['viirs-vnp09ga'], observationWindows: [], normalization: { method: 'robust-channel-gain-delta-limit-and-inward-feather', maxDailyChange: .1, seamFeatherPixels: 4, gainRange: [.8, 1.2] },
        },
      },
      nightLights: layer('viirs-surface'), cloudOpacity: layer('satcorps'), cloudDensity: layer('satcorps'),
      snowCover: { ...layer('viirs-snow'), provenance: { validAt: '2026-08-27T00:00:00Z', producedAt: '2026-08-27T04:00:00Z', retrievedAt: '2026-08-27T04:05:00Z', sourceVersion: 'v2.1', coverage: { observedFraction: .91, latitudeRange: [-90, 90], fallbackFraction: .09 }, fallback: 'seasonal snow climatology', attribution: 'NOAA VIIRS snow' } },
      seaIce: { ...layer('osi-sea-ice'), provenance: { validAt: '2026-08-28T00:00:00Z', producedAt: '2026-08-28T03:00:00Z', retrievedAt: '2026-08-28T03:05:00Z', sourceVersion: 'osi-450-a', coverage: { observedFraction: .97, latitudeRange: [-90, 90], fallbackFraction: .03 }, fallback: 'seasonal sea-ice climatology', attribution: 'EUMETSAT OSI SAF' } },
    },
    resources: {},
    cloudSequence: { provider: 'satcorps', interpolation: 'crossfade', transitionSeconds: 300, gapCompletion: { maxObservationAgeSeconds: 10800, minObservationQuality: .72, seamBlendPixels: 3 }, frames: [from, to] },
  };
}

test('presentation makes contemporary observations and every approximation inspectable', () => {
  const presentation = buildEarthStateProvenancePresentation({
    manifest: contemporaryManifest(),
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'remote', refresh: 'current' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(presentation.stateLabel, /Verified remote Earth state/);
  assert.match(text, /NASA SatCORPS.*satcorps-v1/);
  assert.match(text, /10:50.*11:09 UTC/);
  assert.match(text, /50 min old.*current/);
  assert.match(text, /76% observed/);
  assert.match(text, /19% model-assisted.*GFS.*06:00 UTC.*f005/);
  assert.match(text, /Crossfade.*10:00.*11:00 UTC.*5 min/);
  assert.match(text, /Snow.*27 Aug 2026.*91% observed.*9% seasonal/);
  assert.match(text, /Sea ice.*28 Aug 2026.*97% observed.*3% seasonal/);
  assert.match(text, /Rolling surface.*20 Aug 2026.*27 Aug 2026.*82% rolling.*18% seasonal/);
  assert.match(text, /satcorps @ satcorps-v1/);
  assert.match(text, /NASA Langley SatCORPS/);
  assert.match(presentation.accessibleSummary, /50 minutes old/);
  assert.match(presentation.accessibleSummary, /19% model-assisted/);
  assert.match(presentation.accessibleSummary, /rolling surface.*20 Aug 2026.*27 Aug 2026.*82%/i);
  assert.match(presentation.accessibleSummary, /Snow.*27 Aug 2026.*91% observed/i);
  assert.match(presentation.accessibleSummary, /Sea ice.*28 Aug 2026.*97% observed/i);
  assert.match(presentation.accessibleSummary, /5 dataset versions and attributions/i);
});

test('staleness follows the selected provider policy rather than gap-completion metadata', () => {
  const manifest = contemporaryManifest();
  delete manifest.cloudSequence.gapCompletion;
  const presentation = buildEarthStateProvenancePresentation({
    manifest,
    now: new Date('2026-08-28T13:30:00Z'),
    runtime: { source: 'remote', refresh: 'current' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(text, /2 h 20 min old.*stale/);
  assert.match(text, /SatCORPS provider freshness limit 120 min from valid time/);
  assert.doesNotMatch(text, /acceptance limit 360 min/);
});

test('a legacy sequence without an identifiable provider never invents GMGSI provenance', () => {
  const manifest = contemporaryManifest();
  delete manifest.cloudSequence.provider;
  for (const frame of manifest.cloudSequence.frames) frame.layers.cloudOpacity.datasetId = 'legacy-clouds';
  manifest.datasets.push({ id: 'legacy-clouds', version: 'legacy-v1', attribution: 'Cloud source was not recorded' });
  const presentation = buildEarthStateProvenancePresentation({
    manifest,
    now: new Date('2026-08-28T18:30:00Z'),
    runtime: { source: 'offline-cache', refresh: 'failed' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(text, /Cloud source not recorded.*legacy-v1/);
  assert.match(text, /staleness unknown.*provider freshness policy unavailable/);
  assert.doesNotMatch(text, /NOAA GMGSI/);
  assert.match(presentation.accessibleSummary, /freshness is unknown/i);
});

test('offline cache and staleness are explicit and described as last-known-good', () => {
  const presentation = buildEarthStateProvenancePresentation({
    manifest: contemporaryManifest(),
    now: new Date('2026-08-28T18:30:00Z'),
    runtime: { source: 'offline-cache', refresh: 'failed' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(presentation.stateLabel, /Offline cache/);
  assert.match(presentation.stateLabel, /last-known-good/);
  assert.match(text, /7 h 20 min old.*stale/);
  assert.match(text, /Latest refresh failed/);
  assert.match(presentation.accessibleSummary, /offline cache/i);
  assert.match(presentation.accessibleSummary, /stale/i);
});

test('bundled fallback plainly identifies static clouds and missing contemporary products', () => {
  const manifest = contemporaryManifest();
  manifest.classification = 'static-fallback';
  delete manifest.cloudSequence;
  delete manifest.layers.snowCover;
  delete manifest.layers.seaIce;
  delete manifest.layers.surfaceAlbedo.rollingComposite;
  manifest.layers.cloudOpacity.datasetId = 'bundled-clouds';
  manifest.datasets.push({ id: 'bundled-clouds', version: 'sha256-abcd', attribution: 'Bundled fair-cloud texture' });

  const presentation = buildEarthStateProvenancePresentation({
    manifest,
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'bundled-fallback', refresh: 'failed' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(presentation.stateLabel, /Bundled fallback/);
  assert.match(text, /Static cloud fallback/);
  assert.match(text, /No cloud interpolation/);
  assert.match(text, /No model assistance/);
  assert.match(text, /Snow.*not present/);
  assert.match(text, /Sea ice.*not present/);
  assert.match(text, /Seasonal surface fallback/);
  assert.match(presentation.accessibleSummary, /bundled fallback/i);
});

test('a retrieved optical depth is named as retrieved', () => {
  const presentation = buildEarthStateProvenancePresentation({
    manifest: contemporaryManifest(),
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'remote', refresh: 'current' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(text, /Cloud thickness · retrieved optical depth/);
  assert.doesNotMatch(text, /Cloud thickness · assumed/);
  assert.doesNotMatch(presentation.accessibleSummary, /thickness is assumed/i);
});

test('a GMGSI bundle says plainly that cloud thickness is assumed, not measured', () => {
  const manifest = contemporaryManifest();
  manifest.cloudSequence.provider = 'gmgsi';
  const presentation = buildEarthStateProvenancePresentation({
    manifest,
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'remote', refresh: 'current' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(text, /Cloud thickness · assumed/);
  assert.match(text, /no retrieved optical depth/);
  assert.match(text, new RegExp(`optical depth ${ASSUMED_THICK_CLOUD_OPTICAL_DEPTH}`));
  assert.match(presentation.accessibleSummary, /cloud thickness is assumed/i);
});

test('static bundled cloud is assumed thickness too, and says so', () => {
  const manifest = contemporaryManifest();
  manifest.classification = 'static-fallback';
  delete manifest.cloudSequence;
  const presentation = buildEarthStateProvenancePresentation({
    manifest,
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'bundled-fallback', refresh: 'failed' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(text, /Cloud thickness · assumed/);
  assert.match(presentation.accessibleSummary, /cloud thickness is assumed/i);
});

test('a refresh failure keeps the reason it failed, so a 404 and a checksum mismatch differ', () => {
  assert.equal(
    summarizeEarthStateRefreshFailure(new Error('Earth-state asset unavailable (404) after 4 attempts: https://example.test/a.png')),
    'Earth-state asset unavailable (404) after 4 attempts',
  );
  assert.equal(
    summarizeEarthStateRefreshFailure(new Error('Invalid Earth-state manifest field: cloudSequence.frames.1.layers.cloudOpacity.asset')),
    'Invalid Earth-state manifest field: cloudSequence.frames.1.layers.cloudOpacity.asset',
  );
  assert.equal(summarizeEarthStateRefreshFailure(new TypeError('Failed to fetch')), 'Failed to fetch');
});

test('a refresh reason never carries a URL that could hold a query-string credential', () => {
  const reason = summarizeEarthStateRefreshFailure(
    new Error('fetch failed for https://store.test/bundle.json?token=s3cr3t&sig=abc while activating'),
  );
  assert.doesNotMatch(reason, /s3cr3t|abc|token|store\.test|https?:/);
  assert.equal(reason, 'fetch failed for while activating');
});

test('a refresh reason stays short and single-line whatever was thrown', () => {
  const long = summarizeEarthStateRefreshFailure(new Error(`${'verbose '.repeat(60)}end`));
  assert.ok(long.length <= 160);
  assert.match(long, /…$/);
  assert.equal(summarizeEarthStateRefreshFailure(new Error('line one\n  line two')), 'line one line two');
  assert.equal(summarizeEarthStateRefreshFailure('plain string failure'), 'plain string failure');
  assert.equal(summarizeEarthStateRefreshFailure(new Error('')), 'Error');
  assert.equal(summarizeEarthStateRefreshFailure(undefined), 'unknown error');
  assert.equal(summarizeEarthStateRefreshFailure({}), 'unknown error');
});

test('the active-state line names why the last refresh failed rather than only that it did', () => {
  const presentation = buildEarthStateProvenancePresentation({
    manifest: contemporaryManifest(),
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'bundled-fallback', refresh: 'failed', reason: 'Earth-state asset unavailable (404) after 4 attempts' },
  });
  const [state] = presentation.sections;

  assert.equal(state.id, 'state');
  assert.match(state.items[0], /Latest refresh failed/);
  assert.match(state.items[0], /Earth-state asset unavailable \(404\) after 4 attempts/);
});

test('every runtime source reports its failure reason, and none invents one when it succeeded', () => {
  for (const source of ['bundled-fallback', 'offline-cache', 'remote']) {
    const failed = buildEarthStateProvenancePresentation({
      manifest: contemporaryManifest(),
      now: new Date('2026-08-28T12:00:00Z'),
      runtime: { source, refresh: 'failed', reason: 'checksum mismatch' },
    });
    assert.match(failed.sections[0].items[0], /checksum mismatch/, source);

    const current = buildEarthStateProvenancePresentation({
      manifest: contemporaryManifest(),
      now: new Date('2026-08-28T12:00:00Z'),
      runtime: { source, refresh: 'current' },
    });
    assert.doesNotMatch(current.sections[0].items[0], /checksum mismatch|because/, source);
  }
});

test('cloud a provider did not deliver is named as unobserved, not passed off as clear sky', () => {
  // A dropped GMGSI sector draws no cloud at all. Once the night side is lit
  // that reads as a hard-edged hole, and a viewer must be able to learn it is
  // missing data rather than a clear night.
  const manifest = contemporaryManifest();
  manifest.cloudSequence.provider = 'gmgsi';
  for (const frame of manifest.cloudSequence.frames) {
    frame.coverage = { observedFraction: .913, latitudeRange: [-72.7368, 72.7154] };
    delete frame.assistance;
  }
  const presentation = buildEarthStateProvenancePresentation({
    manifest,
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'remote', refresh: 'current' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  assert.match(text, /91% observed/);
  assert.match(text, /9% not observed/);
  // And why the poles are always part of it.
  assert.match(text, /72\.7°S–72\.7°N/);
  assert.match(presentation.accessibleSummary, /9% not observed/);
});

test('a fully observed frame does not invent a gap', () => {
  const presentation = buildEarthStateProvenancePresentation({
    manifest: contemporaryManifest(),
    now: new Date('2026-08-28T12:00:00Z'),
    runtime: { source: 'remote', refresh: 'current' },
  });
  const text = presentation.sections.flatMap(section => section.items).join(' | ');

  // 76% observed + 19% model-assisted + 5% static fallback leaves nothing out.
  assert.match(text, /76% observed/);
  assert.match(text, /5% static fallback/);
  assert.doesNotMatch(text, /not observed/);
  assert.doesNotMatch(presentation.accessibleSummary, /not observed/);
});
