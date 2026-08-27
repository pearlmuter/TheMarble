import type { EarthStateAssetReference, EarthStateManifest } from './earth-state.js';
import type { CloudProviderFrame } from './cloud-provider-selection.js';

type ComposedSatcorpsFrame = {
  metadata: {
    observedFrom: string;
    observedTo: string;
    producedAt: string;
    version: string;
    dimensions: { width: number; height: number };
    coverage: { observedFraction: number; latitudeRange: [number, number] };
  };
  assets: Record<'cloudOpacity' | 'cloudDensity' | 'cloudPhysics' | 'cloudAge', EarthStateAssetReference>;
};

export function addSatcorpsCloudSequence(
  baseManifest: EarthStateManifest,
  options: {
    selection: { provider: 'satcorps'; retrievedAt: string; frames: [CloudProviderFrame, CloudProviderFrame] };
    composedFrames: [ComposedSatcorpsFrame, ComposedSatcorpsFrame];
  },
): EarthStateManifest;
