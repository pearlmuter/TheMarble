import type { EarthStateManifest } from './earth-state.js';

export interface EarthStateFeedCloudLayer {
  provider?: 'gmgsi' | 'satcorps';
  validAt: string;
  observedFrom: string;
  observedTo: string;
  hours: string[];
}

export interface EarthStateFeedLayers {
  bundleId: string;
  clouds?: EarthStateFeedCloudLayer;
  snowCover?: { validAt: string };
  seaIce?: { validAt: string };
}

export type EarthStateFeedStageName = 'clouds' | 'cryosphere';

export interface EarthStateFeedStage {
  name: EarthStateFeedStageName;
  status: 'published' | 'unchanged' | 'failed';
  validAt?: string;
  reason?: string;
}

export interface EarthStateFeedProblem {
  layer?: 'clouds' | 'snowCover' | 'seaIce';
  stage?: EarthStateFeedStageName;
  reason: string;
}

export interface EarthStateFeedRunReport {
  checkedAt: string;
  coherent: boolean;
  severity: 'ok' | 'degraded' | 'broken';
  advanced: string[];
  retained: string[];
  stages: EarthStateFeedStage[];
  problems: EarthStateFeedProblem[];
}

export function readPublicationOutcome(stdout: string): { status: string; validAt?: string } | undefined;

export function adjacentCloudHoursProblem(hours: string[]): string | undefined;

export function representativeEarthStateAssetHref(manifest: EarthStateManifest): string | undefined;

export function readEarthStateFeedLayers(manifest: EarthStateManifest): EarthStateFeedLayers;

export function evaluateEarthStateFeedRun(options: {
  before: EarthStateFeedLayers;
  after: EarthStateFeedLayers;
  stages: EarthStateFeedStage[];
  checkedAt?: string;
}): EarthStateFeedRunReport;
