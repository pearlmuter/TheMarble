import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCryosphereCatalog, newestObservedCryosphereDays } from '../src/cryosphere-catalog.js';

const product = (name, options = {}) => ({
  product: name,
  validAt: options.validAt ?? '2026-08-30T00:00:00Z',
  producedAt: options.producedAt ?? '2026-08-30T04:30:00Z',
  version: options.version ?? `${name}-v1`,
  arrayPath: options.arrayPath ?? `arrays/${name}.npy`,
  ...(options.qualityArrayPath === null ? {} : options.qualityArrayPath ? { qualityArrayPath: options.qualityArrayPath } : {}),
  coverage: options.coverage ?? { latitudeRange: [-90, 90], observedFraction: 0.99 },
  ...(options.attribution ? { attribution: options.attribution } : {}),
});

const northern = { latitudeRange: [0, 90], observedFraction: 0.5 };

const build = (products, options = {}) => buildCryosphereCatalog({
  products,
  retrievedAt: options.retrievedAt ?? '2026-08-30T06:00:00Z',
});

const operationalDay = () => [
  product('ims-snow-ice', { coverage: northern }),
  product('gmasi-snow'),
  product('gmasi-sea-ice'),
  product('viirs-snow', { qualityArrayPath: 'arrays/viirs-quality.npy', coverage: { latitudeRange: [-90, 90], observedFraction: 0.4 } }),
];

test('a complete operational day becomes a catalog the daily selector accepts', () => {
  const catalog = build(operationalDay());
  assert.equal(catalog.retrievedAt, '2026-08-30T06:00:00Z');
  assert.deepEqual(catalog.candidates.map(candidate => candidate.product), [
    'ims-snow-ice', 'gmasi-snow', 'gmasi-sea-ice', 'viirs-snow',
  ]);
  assert.equal(catalog.candidates[0].href, './arrays/ims-snow-ice.npy');
  assert.equal(catalog.candidates[3].qualityHref, './arrays/viirs-quality.npy');
  assert.equal(catalog.selection.validAt, '2026-08-30T00:00:00Z');
  assert.equal(catalog.selection.fallback.ims, false);
  assert.deepEqual(catalog.excluded, []);
});

test('each candidate carries the documented attribution its manifest will repeat', () => {
  const catalog = build(operationalDay());
  assert.equal(catalog.candidates[0].attribution, 'U.S. National Ice Center IMS');
  assert.equal(catalog.candidates[1].attribution, 'NOAA/NESDIS GMASI');
  assert.equal(catalog.candidates[3].attribution, 'NASA VIIRS VNP10_NRT');
});

test('a VIIRS refinement without its quality array cannot be trusted to sharpen an edge', () => {
  assert.throws(
    () => build([...operationalDay().slice(0, 3), product('viirs-snow', { qualityArrayPath: null })]),
    /quality/i,
  );
});

test('an archival AMSR2 day is excluded rather than presented alongside a current GMASI analysis', () => {
  const catalog = build([
    ...operationalDay(),
    product('amsr2-snow', { validAt: '2026-08-28T00:00:00Z', producedAt: '2026-08-28T05:00:00Z' }),
    product('amsr2-sea-ice', { validAt: '2026-08-28T00:00:00Z', producedAt: '2026-08-28T05:00:00Z' }),
  ]);
  assert.deepEqual(catalog.candidates.map(candidate => candidate.product), [
    'ims-snow-ice', 'gmasi-snow', 'gmasi-sea-ice', 'viirs-snow',
  ]);
  assert.equal(catalog.excluded.length, 2);
  assert.match(catalog.excluded[0].reason, /2026-08-28.*older than the current 2026-08-30/);
});

test('AMSR2 is accepted as a disclosed contingency when no current GMASI delivery exists', () => {
  const catalog = build([
    product('ims-snow-ice', { coverage: northern }),
    product('amsr2-snow'),
    product('amsr2-sea-ice'),
  ]);
  assert.equal(catalog.selection.validAt, '2026-08-30T00:00:00Z');
  assert.equal(catalog.contingency, 'amsr2');
  assert.match(catalog.contingencyReason, /GMASI/);
});

test('half a global pair is ignored rather than published as a global analysis', () => {
  // Global snow without global sea ice is not a cryosphere. IMS still covers
  // the Northern Hemisphere, and that is what gets published, disclosed as such.
  const catalog = build([product('ims-snow-ice', { coverage: northern }), product('gmasi-snow')]);
  assert.equal(catalog.selection.analysis.globalFallback, undefined);
  assert.equal(catalog.selection.analysis.northernPrimary.product, 'ims-snow-ice');
  assert.match(catalog.selection.fallback.reason, /Southern Hemisphere is not observed/i);
});

test('a day with neither a global pair nor northern IMS is refused', () => {
  assert.throws(() => build([product('gmasi-snow')]), /did not find a usable cryosphere day/);
});

test('a missing IMS day is a disclosed fallback, not a failed catalog', () => {
  const catalog = build([product('gmasi-snow'), product('gmasi-sea-ice')]);
  assert.equal(catalog.selection.fallback.ims, true);
  assert.match(catalog.selection.fallback.reason, /IMS unavailable/);
});

test('an unknown provider product is refused before it can reach the compositor', () => {
  assert.throws(() => build([...operationalDay(), product('sentinel-snow')]), /Unsupported cryosphere product/);
});

test('a coverage claim outside the published grid is refused at catalog time', () => {
  assert.throws(
    () => build([...operationalDay().slice(1), product('ims-snow-ice', { coverage: { latitudeRange: [0, 120], observedFraction: 0.5 } })]),
    /Invalid cryosphere coverage/,
  );
});

test('an adapter product without an array path cannot become a catalog candidate', () => {
  assert.throws(() => build([...operationalDay().slice(1), product('ims-snow-ice', { arrayPath: '', coverage: northern })]), /arrayPath/);
});

const adapted = (name, day, observedFraction) => ({
  product: name,
  validAt: `${day}T00:00:00Z`,
  producedAt: `${day}T04:00:00Z`,
  version: `${name}-v1`,
  arrayPath: `${name}@${day}.npy`,
  coverage: { latitudeRange: [-90, 90], observedFraction },
});

test('the day a source contributes is the newest one whose pixels carry coverage', () => {
  const resolved = newestObservedCryosphereDays([
    adapted('gmasi-snow', '2026-08-28', 0.99),
    adapted('gmasi-snow', '2026-08-29', 0.99),
    adapted('gmasi-snow', '2026-08-30', 0.99),
  ]);
  assert.equal(resolved.products.length, 1);
  assert.equal(resolved.products[0].validAt, '2026-08-30T00:00:00Z');
  assert.deepEqual(resolved.excluded, []);
});

test('a day the provider does not yet hold is excluded rather than published as current', () => {
  const resolved = newestObservedCryosphereDays([
    adapted('gmasi-snow', '2026-08-29', 0.99),
    adapted('gmasi-snow', '2026-08-30', 0),
  ]);
  assert.equal(resolved.products[0].validAt, '2026-08-29T00:00:00Z');
  assert.equal(resolved.excluded.length, 1);
  assert.match(resolved.excluded[0].reason, /2026-08-30 was delivered but carried no observed pixels/);
});

test('sources that resolve to different days keep the archival contingency guard meaningful', () => {
  const resolved = newestObservedCryosphereDays([
    adapted('gmasi-snow', '2026-08-30', 0.99),
    adapted('gmasi-sea-ice', '2026-08-30', 0.99),
    adapted('amsr2-snow', '2026-08-27', 0.99),
    adapted('amsr2-sea-ice', '2026-08-27', 0.99),
  ]);
  const catalog = buildCryosphereCatalog({ products: resolved.products, retrievedAt: '2026-08-30T06:00:00Z' });
  assert.deepEqual(catalog.candidates.map(candidate => candidate.product), ['gmasi-snow', 'gmasi-sea-ice']);
  assert.equal(catalog.excluded.length, 2);
  assert.match(catalog.excluded[0].reason, /older than the current 2026-08-30/);
});

test('the configured IMS endpoint is the archive that serves values, not the one that serves pictures', async () => {
  const { readFile } = await import('node:fs/promises');
  const configuration = JSON.parse(await readFile(new URL('../config/cryosphere-sources.json', import.meta.url), 'utf8'));
  const ims = configuration.sources.find(source => source.product === 'ims-snow-ice');

  assert.ok(ims.urlTemplate, 'IMS has no configured endpoint');
  // #17 withdrew the ImageServer because it returns rendered symbology. The
  // NSIDC archive serves the documented class grid itself.
  assert.doesNotMatch(ims.urlTemplate, /ImageServer|arcgis|WMS|GetMap/i);
  assert.match(ims.urlTemplate, /noaadata\.apps\.nsidc\.org\/NOAA\/G02156\//);
  // A polar square needs its coordinates, and a headerless grid needs its shape.
  assert.equal(ims.input.kind, 'scattered');
  for (const axis of ['latitudes', 'longitudes']) {
    assert.ok(ims.input.grids[axis].url);
    assert.ok(Array.isArray(ims.input.grids[axis].shape));
    assert.ok(ims.input.grids[axis].dtype);
  }
  assert.deepEqual(ims.semantics.allowed, [0, 1, 2, 3, 4]);
});
