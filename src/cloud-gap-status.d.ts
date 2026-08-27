export function formatCloudGapStatus(options: {
  gapCompletion?: { maxObservationAgeSeconds: number; minObservationQuality: number; seamBlendPixels: number };
  frame: {
    coverage?: { observedFraction: number; modelAssistedFraction?: number; fallbackFraction?: number };
    assistance?: {
      polarObservation?: { product: 'viirs-cloud' | 'modis-cloud' };
      model?: { forecastHour: number; runAt: string };
    };
  };
}): string | undefined;
