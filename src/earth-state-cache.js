import { parseEarthStateJson } from './earth-state-codec.js';
import { createEarthStateActivator } from './earth-state.js';

const INDEX_KEY = 'remote-bundle-index';
const BUNDLE_KEY_PREFIX = 'remote-bundle:';

function bundleKey(bundleId) {
  return `${BUNDLE_KEY_PREFIX}${bundleId}`;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid cached Earth-state ${name}`);
  }
}

function validateEntry(entry) {
  requireNonEmptyString(entry?.url, 'entry URL');
  requireNonEmptyString(entry?.mediaType, 'entry media type');
  if (!(entry?.bytes instanceof Uint8Array) || entry.bytes.byteLength === 0) {
    throw new Error('Invalid cached Earth-state entry bytes');
  }
}

function copyEntry(entry) {
  validateEntry(entry);
  return {
    url: entry.url,
    mediaType: entry.mediaType,
    bytes: new Uint8Array(entry.bytes),
  };
}

function validateBundle(bundle) {
  requireNonEmptyString(bundle?.bundleId, 'bundleId');
  requireNonEmptyString(bundle?.latestUrl, 'latest URL');
  requireNonEmptyString(bundle?.validAt, 'validAt');
  if (Number.isNaN(Date.parse(bundle.validAt))) throw new Error('Invalid cached Earth-state validAt');
  if (!Array.isArray(bundle.entries) || bundle.entries.length === 0) {
    throw new Error('Invalid cached Earth-state entries');
  }
  bundle.entries.forEach(validateEntry);
  const urls = new Set(bundle.entries.map(entry => entry.url));
  if (urls.size !== bundle.entries.length) throw new Error('Duplicate cached Earth-state entry URL');
  if (!urls.has(bundle.latestUrl)) throw new Error('Cached Earth-state bundle is missing its latest pointer');
}

function copyBundle(bundle) {
  validateBundle(bundle);
  return {
    schemaVersion: 1,
    bundleId: bundle.bundleId,
    validAt: bundle.validAt,
    latestUrl: bundle.latestUrl,
    entries: bundle.entries.map(copyEntry),
  };
}

function isIndex(value) {
  return value?.schemaVersion === 1
    && Array.isArray(value.bundleIds)
    && value.bundleIds.every(bundleId => typeof bundleId === 'string' && bundleId.length > 0);
}

function isBundle(value) {
  try {
    validateBundle(value);
    return value?.schemaVersion === 1;
  } catch {
    return false;
  }
}

function candidateFrom(record) {
  const entries = new Map(record.entries.map(entry => [entry.url, entry]));
  return {
    bundleId: record.bundleId,
    validAt: record.validAt,
    latestUrl: record.latestUrl,
    read(url) {
      const entry = entries.get(url);
      if (!entry) throw new Error(`Cached Earth-state entry is unavailable: ${url}`);
      return {
        url: entry.url,
        mediaType: entry.mediaType,
        bytes: entry.bytes,
      };
    },
  };
}

async function isVerifiedBundle(record) {
  if (!isBundle(record)) return false;
  const candidate = candidateFrom(record);
  const activator = createEarthStateActivator({
    async loadDocument(url) {
      const entry = candidate.read(url);
      if (entry.mediaType !== 'application/json') throw new Error('Cached Earth-state document media type mismatch');
      return {
        ...entry,
        value: parseEarthStateJson(entry.bytes, 'Cached Earth-state document is malformed JSON'),
      };
    },
    async loadAsset({ descriptor, url }) {
      const entry = candidate.read(url);
      if (entry.mediaType !== descriptor.asset.mediaType) throw new Error('Cached Earth-state asset media type mismatch');
      return { value: undefined, bytes: entry.bytes };
    },
  });
  try {
    const active = await activator.activateLatest(candidate.latestUrl);
    return active.manifest.bundleId === candidate.bundleId;
  } catch {
    return false;
  }
}

export function createEarthStateBundleCache({ storage, maxRemoteBundles = 2 }) {
  if (!storage || !Number.isSafeInteger(maxRemoteBundles) || maxRemoteBundles < 1) {
    throw new Error('Invalid Earth-state bundle cache configuration');
  }

  const readIndexIds = async () => {
    const index = await storage.get(INDEX_KEY);
    return isIndex(index) ? [...new Set(index.bundleIds)] : [];
  };

  return {
    async remember(bundle) {
      const record = copyBundle(bundle);
      const previousIds = await readIndexIds();
      const readablePredecessors = [];
      for (const bundleId of previousIds) {
        if (bundleId === record.bundleId) continue;
        const previous = await storage.get(bundleKey(bundleId));
        if (await isVerifiedBundle(previous)) readablePredecessors.push(bundleId);
        if (readablePredecessors.length === maxRemoteBundles - 1) break;
      }
      const retainedIds = [record.bundleId, ...readablePredecessors];
      const evictedIds = previousIds.filter(bundleId => !retainedIds.includes(bundleId));
      await storage.commit({
        writes: [
          { key: bundleKey(record.bundleId), value: record },
          { key: INDEX_KEY, value: { schemaVersion: 1, bundleIds: retainedIds } },
        ],
        deletes: evictedIds.map(bundleKey),
      });
    },

    async bundleIds() {
      return readIndexIds();
    },

    async restoreNewest(activate) {
      for (const bundleId of await readIndexIds()) {
        const record = await storage.get(bundleKey(bundleId));
        if (!isBundle(record)) continue;
        try {
          return await activate(candidateFrom(record));
        } catch {
          // A missing, corrupt, or no-longer-decodable bundle is not an active state.
        }
      }
      return undefined;
    },
  };
}

export async function activateEarthStateAtStartup({ cache, activateCached, activateBundled }) {
  let cached;
  try {
    cached = cache ? await cache.restoreNewest(activateCached) : undefined;
  } catch {
    // Desktop storage may be unavailable or evicted; the packaged Earth remains authoritative fallback.
  }
  return cached ?? activateBundled();
}
