import type { EarthStateAssetReference, EarthStateManifest } from './earth-state.js';
import type { CloudGapSelection, CloudGapThresholds } from './cloud-gap-selection.js';

export interface CompletedCloudGapFrame {
  validAt: string;
  selection: CloudGapSelection;
  metadata: {
    coverage: {
      observedFraction: number;
      primaryObservedFraction: number;
      polarObservedFraction: number;
      modelAssistedFraction: number;
      fallbackFraction: number;
      latitudeRange: [number, number];
    };
    staticFallback?: string;
  };
  assets: Record<'cloudOpacity' | 'cloudDensity' | 'cloudProvenance', EarthStateAssetReference>;
}

export function addCloudGapCompletion(
  baseManifest: EarthStateManifest,
  options: { thresholds: CloudGapThresholds; completedFrames: [CompletedCloudGapFrame, CompletedCloudGapFrame] },
): EarthStateManifest;
