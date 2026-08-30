import type { EarthStateManifest } from './earth-state.js';

export type EarthStateRuntimeProvenance = {
  source: 'remote' | 'offline-cache' | 'bundled-fallback';
  refresh: 'checking' | 'current' | 'failed';
};

export type EarthStateProvenancePresentation = {
  stateLabel: string;
  accessibleSummary: string;
  sections: Array<{ id: string; title: string; items: string[] }>;
};

export function buildEarthStateProvenancePresentation(options: {
  manifest: EarthStateManifest;
  now: Date;
  runtime: EarthStateRuntimeProvenance;
}): EarthStateProvenancePresentation;
