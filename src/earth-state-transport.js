// An object store answers a burst of requests for one bundle with 429s and 5xxs
// even when every byte is present and correct. Activation is deliberately atomic,
// so one such answer refuses the whole Earth state and leaves a client on its
// fallback. Retrying the transient ones keeps that from happening.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_ATTEMPTS = 4;
const BASE_DELAY_MS = 400;
const MAXIMUM_DELAY_MS = 8000;

export function isRetryableEarthStateStatus(status) {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * How long to wait before another attempt. A server that states Retry-After is
 * telling us what it wants; otherwise back off exponentially so a throttled
 * store is given room rather than hammered.
 */
export function earthStateRetryDelayMs(attempt, retryAfterHeader) {
  const stated = Number.parseFloat(retryAfterHeader ?? '');
  if (Number.isFinite(stated) && stated >= 0) return Math.min(stated * 1000, MAXIMUM_DELAY_MS);
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAXIMUM_DELAY_MS);
}

/**
 * Fetch one Earth-state asset, retrying only answers that can differ next time.
 * A 404 is a fact about the bundle and is returned immediately.
 */
export async function fetchEarthStateAsset(url, { fetch: fetchImpl, signal, sleep, attempts = DEFAULT_ATTEMPTS } = {}) {
  let lastStatus;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw new Error(`Earth-state asset fetch aborted: ${url}`);
    const response = await fetchImpl(url, { signal });
    if (response.ok) return response;
    lastStatus = response.status;
    if (!isRetryableEarthStateStatus(response.status) || attempt === attempts) break;
    await sleep(earthStateRetryDelayMs(attempt, response.headers?.get?.('retry-after')));
  }
  throw new Error(`Earth-state asset unavailable (${lastStatus}) after ${attempts} attempts: ${url}`);
}
