export interface EarthStateTransport {
  fetch(url: string, options: { signal?: AbortSignal }): Promise<Response>;
  sleep(milliseconds: number): Promise<void>;
  signal?: AbortSignal;
  attempts?: number;
}

export function isRetryableEarthStateStatus(status: number): boolean;

export function earthStateRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number;

export function fetchEarthStateAsset(url: string, transport: EarthStateTransport): Promise<Response>;
