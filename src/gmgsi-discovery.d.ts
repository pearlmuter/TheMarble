export interface GmgsiDiscoveredFrame {
  validAt: string;
  observedFrom: string;
  observedTo: string;
  producedAt: string;
  retrievedAt: string;
  visibleKey: string;
  longwaveKey: string;
}

export function selectGmgsiCloudSequence(options: {
  keys: string[];
  retrievedAt: string;
  lastPublishedValidAt?: string;
}): { frames: [GmgsiDiscoveredFrame, GmgsiDiscoveredFrame]; publish: boolean };
