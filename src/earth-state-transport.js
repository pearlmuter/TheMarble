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
  let lastTransportFailure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw new Error(`Earth-state asset fetch aborted: ${url}`);
    let response;
    try {
      response = await fetchImpl(url, { signal });
    } catch (error) {
      // A reset or dropped connection is not a fact about the bundle either. It
      // is the clearest case of an answer that differs next time, and leaving it
      // unretried meant one dropped connection part-way through a hundred
      // megabytes refused the entire Earth state.
      if (signal?.aborted) throw error;
      lastTransportFailure = error?.message ?? String(error);
      if (attempt === attempts) break;
      await sleep(earthStateRetryDelayMs(attempt));
      continue;
    }
    if (response.ok) return response;
    lastTransportFailure = undefined;
    lastStatus = response.status;
    if (!isRetryableEarthStateStatus(response.status) || attempt === attempts) break;
    await sleep(earthStateRetryDelayMs(attempt, response.headers?.get?.('retry-after')));
  }
  // The URL is deliberately absent from the transport message: a provider
  // template can carry a query-string credential and this reason is published.
  if (lastTransportFailure !== undefined) {
    throw new Error(`Earth-state asset unreachable after ${attempts} attempts (${lastTransportFailure})`);
  }
  throw new Error(`Earth-state asset unavailable (${lastStatus}) after ${attempts} attempts: ${url}`);
}
