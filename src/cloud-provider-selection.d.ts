export type CloudProvider = 'satcorps' | 'gmgsi';

export function cloudProviderMaxAgeSeconds(provider: CloudProvider): number;

export interface CloudProviderFrame {
  provider: CloudProvider;
  validAt: string;
  observedFrom: string;
  observedTo: string;
  producedAt: string;
  version: string;
  coverage: { observedFraction: number };
  quality: { usableFraction: number };
  assets: { manifest: string };
}

export interface CloudProviderSequence {
  provider: CloudProvider;
  frames: [CloudProviderFrame, CloudProviderFrame];
}

export function selectCloudProviderSequence(options: {
  sequences: CloudProviderSequence[];
  retrievedAt: string;
  lastPublishedValidAt?: string;
  satcorpsPromoted?: boolean;
}): {
  provider: CloudProvider;
  frames: [CloudProviderFrame, CloudProviderFrame];
  retrievedAt: string;
  fallback?: { from: 'satcorps'; reason: string };
  publish: boolean;
};
