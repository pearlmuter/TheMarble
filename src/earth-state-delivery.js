const POINTER_FILES = new Set(['latest.json', 'latest-presentations.json']);
const MAXIMUM_POINTER_MAX_AGE_SECONDS = 600;
const MINIMUM_IMMUTABLE_MAX_AGE_SECONDS = 86_400;
const POINTER_MAX_AGE_SECONDS = 30;
const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;
const JSON_MEDIA_TYPE = 'application/json';

export function classifyEarthStateDeliveryPath(path) {
  const normalized = path.replace(/^\.?\//, '').split(/[?#]/, 1)[0];
  return POINTER_FILES.has(normalized) ? 'pointer' : 'immutable';
}

/**
 * The headers an origin must send for a published path. The verifier below
 * checks these same rules, so a server built on this cannot fail its own check.
 */
export function earthStateDeliveryHeaders(path, mediaType) {
  return {
    'access-control-allow-origin': '*',
    'cache-control': classifyEarthStateDeliveryPath(path) === 'pointer'
      ? `public, max-age=${POINTER_MAX_AGE_SECONDS}, must-revalidate`
      : `public, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`,
    ...(mediaType ? { 'content-type': mediaType } : {}),
  };
}

function cacheDirectives(value) {
  const directives = new Map();
  for (const part of (value ?? '').split(',')) {
    const [name, directiveValue] = part.trim().toLowerCase().split('=', 2);
    if (name) directives.set(name, directiveValue);
  }
  return directives;
}

function pathOf(origin, url) {
  const originPath = new URL(origin).pathname;
  const probePath = new URL(url).pathname;
  return probePath.startsWith(originPath) ? probePath.slice(originPath.length) : probePath.replace(/^\//, '');
}

function corsProblem(headers, clientOrigins) {
  const allowed = headers['access-control-allow-origin'];
  if (allowed === undefined) return 'is served without an access-control-allow-origin header, so a cross-origin client cannot read it';
  if (headers['access-control-allow-credentials'] === 'true') {
    return 'allows credentialed cross-origin requests, but the Earth-state feed is public read-only data';
  }
  if (allowed === '*') return undefined;
  const rejected = clientOrigins.filter(origin => origin !== allowed);
  if (rejected.length > 0) return `allows only ${allowed}, which locks out ${rejected.join(' and ')}`;
  return undefined;
}

function cacheProblem(classification, headers) {
  const directives = cacheDirectives(headers['cache-control']);
  const maxAge = Number.parseInt(directives.get('max-age') ?? '', 10);
  if (classification === 'pointer') {
    if (!directives.has('no-cache') && !directives.has('no-store') && !directives.has('must-revalidate')) {
      return 'is cached without no-cache or must-revalidate, so a client can be stranded on a superseded Earth state';
    }
    if (Number.isFinite(maxAge) && maxAge > MAXIMUM_POINTER_MAX_AGE_SECONDS) {
      return `is cached with max-age=${maxAge}, which exceeds the ${MAXIMUM_POINTER_MAX_AGE_SECONDS} second pointer limit`;
    }
    return undefined;
  }
  if (!directives.has('immutable') || !Number.isFinite(maxAge) || maxAge < MINIMUM_IMMUTABLE_MAX_AGE_SECONDS) {
    return `is not cached as immutable for at least ${MINIMUM_IMMUTABLE_MAX_AGE_SECONDS} seconds, so content-addressed bytes are re-fetched on every activation`;
  }
  return undefined;
}

function contentTypeProblem(path, headers) {
  if (!path.endsWith('.json')) return undefined;
  const contentType = (headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== JSON_MEDIA_TYPE) {
    return `is served with content-type ${headers['content-type'] ?? 'none'} instead of ${JSON_MEDIA_TYPE}`;
  }
  return undefined;
}

export function evaluateEarthStateDelivery({ origin, clientOrigins, probes, checkedAt }) {
  if (typeof origin !== 'string' || origin.trim() === '') throw new Error('Earth-state delivery requires the served origin');
  if (!Array.isArray(clientOrigins) || clientOrigins.length === 0) throw new Error('Earth-state delivery requires the client origins it must serve');
  if (!Array.isArray(probes) || probes.length === 0) throw new Error('Earth-state delivery requires at least one probed response');

  const problems = [];
  const evaluated = [];
  const insecure = new URL(origin).protocol !== 'https:';
  if (insecure) problems.push({ reason: `The Earth-state origin ${origin} is not served over https` });

  for (const probe of probes) {
    const path = pathOf(origin, probe.url);
    const classification = classifyEarthStateDeliveryPath(path);
    evaluated.push({ path, classification, status: probe.status });
    if (insecure) continue;
    if (probe.status !== 200) {
      problems.push({ path, reason: `${path} answered ${probe.status} instead of 200` });
      continue;
    }
    const headers = Object.fromEntries(Object.entries(probe.headers ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name.toLowerCase(), value]));
    for (const reason of [
      corsProblem(headers, clientOrigins),
      cacheProblem(classification, headers),
      contentTypeProblem(path, headers),
    ]) {
      if (reason) problems.push({ path, reason: `${path} ${reason}` });
    }
  }

  for (const classification of ['pointer', 'immutable']) {
    if (!evaluated.some(entry => entry.classification === classification)) {
      problems.push({ reason: `No ${classification} path was probed, so the origin is not proven ready for either client` });
    }
  }

  return { checkedAt, origin, clientOrigins, ok: problems.length === 0, probes: evaluated, problems };
}
