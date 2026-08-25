import { parseEarthStateJson } from './earth-state-codec.js';

export async function loadEarthStateJsonDocument(url, { signal }, fetchDocument = globalThis.fetch) {
  const response = await fetchDocument(url, { signal });
  if (!response.ok) throw new Error(`Earth-state document unavailable (${response.status}): ${url}`);
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream';
  if (mediaType !== 'application/json') throw new Error(`Earth-state document media type mismatch: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const value = parseEarthStateJson(bytes, `Earth-state document is malformed JSON: ${url}`);
  return { value, bytes, mediaType };
}
