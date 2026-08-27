function percent(value) {
  return Math.round(value * 100);
}

export function formatCloudGapStatus({ gapCompletion, frame }) {
  if (!gapCompletion) return undefined;
  const polar = frame.assistance?.polarObservation?.product;
  const model = frame.assistance?.model;
  const pieces = [
    `${percent(frame.coverage.observedFraction)}% observed${polar ? ` (${polar.startsWith('viirs') ? 'VIIRS' : 'MODIS'} polar)` : ''}`,
  ];
  if (frame.coverage.modelAssistedFraction > 0 && model) {
    pieces.push(`${percent(frame.coverage.modelAssistedFraction)}% GFS f${String(model.forecastHour).padStart(3, '0')} from ${model.runAt.slice(11, 13)}Z`);
  }
  if (frame.coverage.fallbackFraction > 0) pieces.push(`${percent(frame.coverage.fallbackFraction)}% static`);
  pieces.push(`accepted ≤${Math.round(gapCompletion.maxObservationAgeSeconds / 60)} min, q≥${percent(gapCompletion.minObservationQuality)}%`);
  return pieces.join(' · ');
}
