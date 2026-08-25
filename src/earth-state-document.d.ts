import type { EarthStateLoadedDocument } from './earth-state.js';

export function loadEarthStateJsonDocument(
  url: string,
  options: { signal: AbortSignal },
  fetchDocument?: typeof fetch,
): Promise<EarthStateLoadedDocument>;
