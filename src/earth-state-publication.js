import { validateEarthStateManifest } from './earth-state.js';
import { earthStateSha256, parseEarthStateJson } from './earth-state-codec.js';
import { earthStateExtensionForMediaType } from './earth-state-media-types.js';
import { encodeCanonicalEarthStateJson } from './earth-state-canonical-json.js';

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
  const topAsset = manifest.layers.surfaceAlbedo.asset;
  const seasonalSurfaceEntries = manifest.layers.surfaceAlbedo.seasonalCycle?.frames
    .filter(frame => frame.asset.href !== topAsset.href
      || frame.asset.byteLength !== topAsset.byteLength
      || frame.asset.checksum.value.toLowerCase() !== topAsset.checksum.value.toLowerCase())
    .map(frame => ({
      role: 'seasonal-layer-frame',
      name: 'surfaceAlbedo',
      month: frame.month,
      descriptor: { ...manifest.layers.surfaceAlbedo, datasetId: frame.datasetId, asset: frame.asset },
    })) ?? [];
  const cloudFrameEntries = manifest.cloudSequence?.frames.flatMap((frame, frameIndex) => (
    Object.entries(frame.layers)
      .filter(([name, descriptor]) => {
        const primary = manifest.layers[name].asset;
        return descriptor.asset.href !== primary.href
          || descriptor.asset.byteLength !== primary.byteLength
          || descriptor.asset.checksum.value.toLowerCase() !== primary.checksum.value.toLowerCase();
      })
      .map(([name, descriptor]) => ({
        role: 'cloud-observation-frame',
        name,
        frameIndex,
        descriptor: { ...manifest.layers[name], datasetId: descriptor.datasetId, asset: descriptor.asset },
      }))
  )) ?? [];
  return [
    ...Object.entries(manifest.layers).map(([name, descriptor]) => ({ role: 'layer', name, descriptor })),
    ...Object.entries(manifest.resources).map(([name, descriptor]) => ({ role: 'resource', name, descriptor })),
    ...seasonalSurfaceEntries,
    ...cloudFrameEntries,
  ];
}

export function createEarthStatePublisher({ loadSource, store, assetLayout = 'bundle' }) {
  if (!['bundle', 'content-addressed'].includes(assetLayout)) {
    throw new Error(`Unsupported Earth-state asset layout: ${assetLayout}`);
  }
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

      const sourceSetBytes = encodeCanonicalEarthStateJson({
        manifest: sourceManifest,
        targetTime: targetIso,
        verifiedAssets: sourceEntries.map(({ role, name, month, frameIndex, checksum }) => ({
          role,
          name,
          ...(month ? { month } : {}),
          ...(frameIndex !== undefined ? { frameIndex } : {}),
          checksum,
        })),
      });
      const sourceSetId = (await earthStateSha256(sourceSetBytes)).slice(0, 16);
      const timeKey = targetIso.replaceAll(':', '-');
      const bundleDirectory = `bundles/${timeKey}-${sourceSetId}`;
      const manifest = structuredClone(sourceManifest);
      manifest.bundleId = `themarble-${timeKey}-${sourceSetId}`;
      if (!manifest.cloudSequence) {
        manifest.times.validAt = targetIso;
        manifest.times.producedAt = targetIso;
        manifest.times.retrievedAt = targetIso;
      }

      for (const entry of sourceEntries) {
        const extension = earthStateExtensionForMediaType(entry.descriptor.asset.mediaType);
        if (!extension) throw new Error(`Unsupported Earth-state publication media type: ${entry.descriptor.asset.mediaType}`);
        const monthSuffix = entry.month ? `-${String(entry.month).padStart(2, '0')}` : '';
        const frameSuffix = entry.frameIndex !== undefined ? `-${String(entry.frameIndex).padStart(2, '0')}` : '';
        const filename = assetLayout === 'content-addressed'
          ? `${entry.checksum}.${extension}`
          : `${entry.role}-${entry.name}${monthSuffix}${frameSuffix}-${entry.checksum.slice(0, 16)}.${extension}`;
        const path = assetLayout === 'content-addressed'
          ? `assets/${filename}`
          : `${bundleDirectory}/assets/${filename}`;
        const publishedDescriptor = entry.role === 'seasonal-layer-frame'
          ? manifest.layers[entry.name].seasonalCycle.frames.find(frame => frame.month === entry.month)
          : entry.role === 'cloud-observation-frame'
            ? manifest.cloudSequence.frames[entry.frameIndex].layers[entry.name]
          : manifest[`${entry.role}s`][entry.name];
        publishedDescriptor.asset = {
          href: assetLayout === 'content-addressed' ? `../../assets/${filename}` : `./assets/${filename}`,
          mediaType: entry.descriptor.asset.mediaType,
          byteLength: entry.bytes.byteLength,
          immutable: true,
          checksum: { algorithm: 'sha256', value: entry.checksum },
        };
        await store.writeImmutable(path, entry.bytes);
        await verifyPublished(store, path, publishedDescriptor.asset);
        if (entry.role === 'layer' && entry.name === 'surfaceAlbedo' && publishedDescriptor.seasonalCycle && !publishedDescriptor.rollingComposite) {
          publishedDescriptor.seasonalCycle.frames.find(frame => frame.month === 1).asset = structuredClone(publishedDescriptor.asset);
        }
        if (entry.role === 'layer' && Object.hasOwn(manifest.cloudSequence?.frames.at(-1)?.layers ?? {}, entry.name)) {
          manifest.cloudSequence.frames.at(-1).layers[entry.name].asset = structuredClone(publishedDescriptor.asset);
        }
      }

      validateEarthStateManifest(manifest);
      const manifestBytes = encodeCanonicalEarthStateJson(manifest);
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
      await store.replaceLatest('latest.json', encodeCanonicalEarthStateJson(latest));
      return { manifestPath, manifest, latest };
    },
  };
}
