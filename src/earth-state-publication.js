import { validateEarthStateManifest } from './earth-state.js';
import { earthStateSha256, parseEarthStateJson } from './earth-state-codec.js';
import { earthStateExtensionForMediaType } from './earth-state-media-types.js';

const encoder = new TextEncoder();

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function encodeCanonicalJson(value) {
  return encoder.encode(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

function normalizeTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error('Invalid Earth-state publication targetTime');
  return parsed.toISOString().replace('.000Z', 'Z');
}

function requireLoadedSource(loaded, url) {
  if (!loaded || !(loaded.bytes instanceof Uint8Array) || typeof loaded.mediaType !== 'string') {
    throw new Error(`Earth-state source loader returned invalid data: ${url}`);
  }
}

async function verifyBytes(bytes, reference, path) {
  if (bytes.byteLength !== reference.byteLength) throw new Error(`Earth-state byteLength mismatch: ${path}`);
  const actual = await earthStateSha256(bytes);
  if (actual !== reference.checksum.value.toLowerCase()) throw new Error(`Earth-state checksum mismatch: ${path}`);
  return actual;
}

async function verifyPublished(store, path, reference) {
  const bytes = await store.read(path);
  if (!(bytes instanceof Uint8Array)) throw new Error(`Earth-state publication store returned invalid bytes: ${path}`);
  await verifyBytes(bytes, reference, path);
}

function publicationEntries(manifest) {
  return [
    ...Object.entries(manifest.layers).map(([name, descriptor]) => ({ role: 'layer', name, descriptor })),
    ...Object.entries(manifest.resources).map(([name, descriptor]) => ({ role: 'resource', name, descriptor })),
  ];
}

export function createEarthStatePublisher({ loadSource, store }) {
  return {
    async publish({ targetTime, sourceManifestUrl }) {
      const targetIso = normalizeTime(targetTime);
      const sourceDocument = await loadSource(sourceManifestUrl);
      requireLoadedSource(sourceDocument, sourceManifestUrl);
      if (sourceDocument.mediaType !== 'application/json') throw new Error('Earth-state source manifest must be application/json');

      const sourceManifest = parseEarthStateJson(sourceDocument.bytes, 'Earth-state source manifest is malformed JSON');
      validateEarthStateManifest(sourceManifest);

      const sourceEntries = await Promise.all(publicationEntries(sourceManifest).map(async entry => {
        const url = new URL(entry.descriptor.asset.href, sourceManifestUrl).href;
        const loaded = await loadSource(url);
        requireLoadedSource(loaded, url);
        if (loaded.mediaType !== entry.descriptor.asset.mediaType) {
          throw new Error(`Earth-state media type mismatch: ${entry.role}.${entry.name}`);
        }
        const checksum = await verifyBytes(loaded.bytes, entry.descriptor.asset, `${entry.role}.${entry.name}`);
        return { ...entry, bytes: loaded.bytes, checksum };
      }));

      const sourceSetBytes = encodeCanonicalJson({
        manifest: sourceManifest,
        targetTime: targetIso,
        verifiedAssets: sourceEntries.map(({ role, name, checksum }) => ({ role, name, checksum })),
      });
      const sourceSetId = (await earthStateSha256(sourceSetBytes)).slice(0, 16);
      const timeKey = targetIso.replaceAll(':', '-');
      const bundleDirectory = `bundles/${timeKey}-${sourceSetId}`;
      const manifest = structuredClone(sourceManifest);
      manifest.bundleId = `themarble-${timeKey}-${sourceSetId}`;
      manifest.times.validAt = targetIso;
      manifest.times.producedAt = targetIso;
      manifest.times.retrievedAt = targetIso;

      for (const entry of sourceEntries) {
        const extension = earthStateExtensionForMediaType(entry.descriptor.asset.mediaType);
        if (!extension) throw new Error(`Unsupported Earth-state publication media type: ${entry.descriptor.asset.mediaType}`);
        const filename = `${entry.role}-${entry.name}-${entry.checksum.slice(0, 16)}.${extension}`;
        const path = `${bundleDirectory}/assets/${filename}`;
        const publishedDescriptor = manifest[`${entry.role}s`][entry.name];
        publishedDescriptor.asset = {
          href: `./assets/${filename}`,
          mediaType: entry.descriptor.asset.mediaType,
          byteLength: entry.bytes.byteLength,
          immutable: true,
          checksum: { algorithm: 'sha256', value: entry.checksum },
        };
        await store.writeImmutable(path, entry.bytes);
        await verifyPublished(store, path, publishedDescriptor.asset);
      }

      validateEarthStateManifest(manifest);
      const manifestBytes = encodeCanonicalJson(manifest);
      const manifestPath = `${bundleDirectory}/manifest.json`;
      const manifestReference = {
        href: `./${manifestPath}`,
        mediaType: 'application/json',
        byteLength: manifestBytes.byteLength,
        immutable: true,
        checksum: { algorithm: 'sha256', value: await earthStateSha256(manifestBytes) },
      };
      await store.writeImmutable(manifestPath, manifestBytes);
      await verifyPublished(store, manifestPath, manifestReference);

      const latest = { schemaVersion: 1, bundleId: manifest.bundleId, manifest: manifestReference };
      await store.replaceLatest('latest.json', encodeCanonicalJson(latest));
      return { manifestPath, manifest, latest };
    },
  };
}
