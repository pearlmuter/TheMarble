import { earthStateSha256, parseEarthStateJson } from './earth-state-codec.js';
import { encodeCanonicalEarthStateJson } from './earth-state-canonical-json.js';
import { validateEarthStateManifest } from './earth-state.js';
import { validateEarthStatePresentationIndex } from './earth-state-presentation.js';

const DEFAULT_TIERS = Object.freeze([
  Object.freeze({ id: '8k', width: 8192, height: 4096, timeToFirstCoherentGlobeMs: 5_000, shaderCompilationMs: 700, minimumSustainedFps: 30 }),
  Object.freeze({ id: '16k', width: 16384, height: 8192, timeToFirstCoherentGlobeMs: 8_000, shaderCompilationMs: 1_000, minimumSustainedFps: 45 }),
]);

function scientificIdentitySource(manifest) {
  const identity = structuredClone(manifest);
  delete identity.bundleId;
  return identity;
}

function collectAssetSlots(root) {
  const slots = [];
  const visit = (value, path) => {
    if (value === null || typeof value !== 'object') return;
    if (!Array.isArray(value) && value.asset && typeof value.asset.href === 'string') {
      slots.push({ holder: value, reference: value.asset, path });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'asset') visit(child, `${path}.${key}`);
    }
  };
  visit(root, 'manifest');
  return slots;
}

function requireLoadedSource(source, url) {
  if (!source || !(source.bytes instanceof Uint8Array) || typeof source.mediaType !== 'string') {
    throw new Error(`Earth presentation source unavailable: ${url}`);
  }
}

async function verifySource(source, reference, path) {
  requireLoadedSource(source, path);
  if (source.mediaType !== reference.mediaType) throw new Error(`Earth presentation source media type mismatch: ${path}`);
  if (source.bytes.byteLength !== reference.byteLength) throw new Error(`Earth presentation source byte length mismatch: ${path}`);
  if (await earthStateSha256(source.bytes) !== reference.checksum.value.toLowerCase()) {
    throw new Error(`Earth presentation source checksum mismatch: ${path}`);
  }
}

function targetDimensions(sourceDimensions, tier) {
  if (!sourceDimensions) return {};
  const width = Math.min(sourceDimensions.width, tier.width);
  const height = Math.round(sourceDimensions.height * width / sourceDimensions.width);
  return { width, height };
}

function textureGpuBytes(width, height) {
  // Basis Universal remains block-compressed on the GPU; include a complete mip chain.
  return Math.ceil(width * height * 4 / 3);
}

function descriptorDefaults(manifest, slot) {
  const layerName = slot.path.match(/\.layers\.([^.]+)/)?.[1];
  const resourceName = slot.path.match(/\.resources\.([^.]+)/)?.[1];
  return layerName ? manifest.layers[layerName] : resourceName ? manifest.resources[resourceName] : undefined;
}

async function writeVerified(store, path, bytes) {
  await store.writeImmutable(path, bytes);
  const stored = await store.read(path);
  if (!(stored instanceof Uint8Array) || stored.byteLength !== bytes.byteLength
    || await earthStateSha256(stored) !== await earthStateSha256(bytes)) {
    throw new Error(`Earth presentation publication verification failed: ${path}`);
  }
}

export function createEarthStatePresentationPublisher({ loadSource, store, transcodeTexture, tiers = DEFAULT_TIERS }) {
  if (typeof loadSource !== 'function' || typeof transcodeTexture !== 'function'
    || typeof store?.writeImmutable !== 'function' || typeof store?.read !== 'function' || typeof store?.replaceLatest !== 'function') {
    throw new Error('Invalid Earth presentation publisher adapters');
  }
  return {
    async publish({ sourceManifestUrl }) {
      const sourceDocument = await loadSource(sourceManifestUrl);
      requireLoadedSource(sourceDocument, sourceManifestUrl);
      if (sourceDocument.mediaType !== 'application/json') throw new Error('Earth presentation source manifest must be application/json');
      const sourceManifest = parseEarthStateJson(sourceDocument.bytes, 'Earth presentation source manifest is malformed JSON');
      validateEarthStateManifest(sourceManifest);
      const surfaceDimensions = sourceManifest.layers.surfaceAlbedo.dimensions;
      if (surfaceDimensions.width !== surfaceDimensions.height * 2) {
        throw new Error('Scientific source must declare a 2:1 global surface');
      }
      if (surfaceDimensions.width < tiers[0].width || surfaceDimensions.height < tiers[0].height) {
        throw new Error('Scientific surface source does not justify an 8K presentation');
      }

      const scientificContentId = `sha256:${await earthStateSha256(encodeCanonicalEarthStateJson(scientificIdentitySource(sourceManifest)))}`;
      const baseDirectory = `presentations/${sourceManifest.bundleId}`;
      const manifests = {};
      const indexTiers = [];

      for (const tier of tiers.filter(candidate => surfaceDimensions.width >= candidate.width && surfaceDimensions.height >= candidate.height)) {
        const manifest = structuredClone(sourceManifest);
        manifest.bundleId = `${sourceManifest.bundleId}-${tier.id}`;
        const publishedByKey = new Map();
        let transferBytes = 0;
        let decodedGpuBytes = 0;
        let cloudCrossfadeOverheadBytes = 0;

        for (const slot of collectAssetSlots(manifest)) {
          const sourceUrl = new URL(slot.reference.href, sourceManifestUrl).href;
          const defaults = descriptorDefaults(manifest, slot);
          const dimensions = slot.holder.dimensions ?? defaults?.dimensions;
          const desired = targetDimensions(dimensions, tier);
          const key = `${sourceUrl}|${desired.width ?? 'native'}x${desired.height ?? 'native'}`;
          let published = publishedByKey.get(key);
          if (!published) {
            const source = await loadSource(sourceUrl);
            await verifySource(source, slot.reference, slot.path);
            let bytes = source.bytes;
            let mediaType = source.mediaType;
            let outputDimensions = desired;
            if (mediaType.startsWith('image/')) {
              const transcoded = await transcodeTexture({
                bytes,
                mediaType,
                width: desired.width,
                height: desired.height,
                tierId: tier.id,
                path: slot.path,
                colorSpace: slot.holder.colorSpace ?? defaults?.colorSpace,
              });
              if (!transcoded || !(transcoded.bytes instanceof Uint8Array)) throw new Error(`Invalid KTX2 transcoder output: ${slot.path}`);
              bytes = transcoded.bytes;
              mediaType = 'image/ktx2';
              outputDimensions = { width: transcoded.width, height: transcoded.height };
              if (!Number.isSafeInteger(outputDimensions.width) || !Number.isSafeInteger(outputDimensions.height)) {
                throw new Error(`KTX2 transcoder omitted dimensions: ${slot.path}`);
              }
            } else if (mediaType !== 'application/json') {
              throw new Error(`Raw scientific asset cannot enter an Earth presentation tier: ${slot.path}`);
            }
            const checksum = await earthStateSha256(bytes);
            const extension = mediaType === 'image/ktx2' ? 'ktx2' : 'json';
            const filename = `${checksum}.${extension}`;
            const path = `${baseDirectory}/${tier.id}/assets/${filename}`;
            await writeVerified(store, path, bytes);
            published = {
              reference: {
                href: `./assets/${filename}`,
                mediaType,
                byteLength: bytes.byteLength,
                immutable: true,
                checksum: { algorithm: 'sha256', value: checksum },
              },
              dimensions: outputDimensions,
              gpuBytes: mediaType === 'image/ktx2' ? textureGpuBytes(outputDimensions.width, outputDimensions.height) : 0,
            };
            publishedByKey.set(key, published);
            transferBytes += bytes.byteLength;
            decodedGpuBytes += published.gpuBytes;
            if (slot.path.toLowerCase().includes('cloud')) cloudCrossfadeOverheadBytes += published.gpuBytes;
          }
          slot.holder.asset = structuredClone(published.reference);
          if (slot.holder.dimensions && published.dimensions.width) slot.holder.dimensions = structuredClone(published.dimensions);
        }

        validateEarthStateManifest(manifest);
        const manifestBytes = encodeCanonicalEarthStateJson(manifest);
        const manifestPath = `${baseDirectory}/${tier.id}/manifest.json`;
        await writeVerified(store, manifestPath, manifestBytes);
        transferBytes += manifestBytes.byteLength;
        const manifestChecksum = await earthStateSha256(manifestBytes);
        manifests[tier.id] = manifest;
        indexTiers.push({
          id: tier.id,
          dimensions: { width: tier.width, height: tier.height },
          requirements: { maxTextureSize: tier.width, textureCompression: 'basis-universal' },
          budgets: {
            timeToFirstCoherentGlobeMs: tier.timeToFirstCoherentGlobeMs,
            transferBytes,
            decodedGpuBytes,
            shaderCompilationMs: tier.shaderCompilationMs,
            minimumSustainedFps: tier.minimumSustainedFps,
            cloudCrossfadeOverheadBytes: Math.max(1, cloudCrossfadeOverheadBytes),
            cacheBytes: transferBytes,
          },
          manifest: {
            href: `./${tier.id}/manifest.json`, mediaType: 'application/json', byteLength: manifestBytes.byteLength,
            immutable: true, checksum: { algorithm: 'sha256', value: manifestChecksum },
          },
        });
      }

      const index = { schemaVersion: 1, bundleId: sourceManifest.bundleId, scientificContentId, tiers: indexTiers };
      validateEarthStatePresentationIndex(index);
      const indexBytes = encodeCanonicalEarthStateJson(index);
      const indexPath = `${baseDirectory}/index.json`;
      await writeVerified(store, indexPath, indexBytes);
      const latestIndex = structuredClone(index);
      for (const tier of latestIndex.tiers) tier.manifest.href = `./${baseDirectory}/${tier.id}/manifest.json`;
      await store.replaceLatest('latest-presentations.json', encodeCanonicalEarthStateJson(latestIndex));
      return { indexPath, index, manifests };
    },
  };
}
