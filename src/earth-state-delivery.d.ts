export type EarthStateDeliveryClass = 'pointer' | 'immutable';

export interface EarthStateDeliveryProbe {
  url: string;
  status: number;
  headers: Record<string, string | undefined>;
}

export interface EarthStateDeliveryReport {
  checkedAt?: string;
  origin: string;
  clientOrigins: string[];
  ok: boolean;
  probes: { path: string; classification: EarthStateDeliveryClass; status: number }[];
  problems: { path?: string; reason: string }[];
}

export function earthStateDeliveryHeaders(path: string, mediaType?: string): Record<string, string>;

export function classifyEarthStateDeliveryPath(path: string): EarthStateDeliveryClass;

export function evaluateEarthStateDelivery(options: {
  origin: string;
  clientOrigins: string[];
  probes: EarthStateDeliveryProbe[];
  checkedAt?: string;
}): EarthStateDeliveryReport;
