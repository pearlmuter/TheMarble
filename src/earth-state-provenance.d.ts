import type { EarthStateManifest } from './earth-state.js';

export type EarthStateRuntimeProvenance = {
  source: 'remote' | 'offline-cache' | 'bundled-fallback';
  refresh: 'checking' | 'current' | 'failed';
  /** Short, URL-free explanation of a failed refresh; absent unless refresh is 'failed'. */
  reason?: string;
};

export function summarizeEarthStateRefreshFailure(error: unknown): string;

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
