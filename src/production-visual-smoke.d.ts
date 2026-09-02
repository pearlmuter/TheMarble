export interface EarthVisualSmokeCapture {
  screenshot: Uint8Array;
  bundleId?: string;
  runtimeSource?: string;
  refresh?: string;
  refreshReason?: string;
  consoleErrors?: string[];
  pageErrors?: string[];
}

export interface EarthVisualSmokeReport {
  schemaVersion: 1;
  checkedAt: string;
  ok: boolean;
  bundleId?: string;
  artifacts: string[];
  failures: string[];
  views: Array<{
    name: string; bundleId?: string; runtimeSource?: string; refresh?: string; refreshReason?: string;
    consoleErrors: string[]; pageErrors: string[];
  }>;
}

export function runEarthProductionVisualSmoke(options: {
  appUrl: string;
  checkedAt: string;
  captureView(request: { name: string; url: string }): Promise<EarthVisualSmokeCapture>;
  retainArtifact(path: string, bytes: Uint8Array): Promise<void>;
}): Promise<EarthVisualSmokeReport>;
