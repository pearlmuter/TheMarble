function monthMidpoint(year, monthIndex) {
  const start = Date.UTC(year, monthIndex, 1);
  const end = Date.UTC(year, monthIndex + 1, 1);
  return start + (end - start) / 2;
}

export function selectSeasonalSurfaceFrames(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Seasonal surface selection requires a valid Date');
  }

  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const currentMidpoint = monthMidpoint(year, monthIndex);
  const isBeforeCurrentMidpoint = date.getTime() < currentMidpoint;
  const fromMidpoint = isBeforeCurrentMidpoint
    ? monthMidpoint(year, monthIndex - 1)
    : currentMidpoint;
  const toMidpoint = isBeforeCurrentMidpoint
    ? currentMidpoint
    : monthMidpoint(year, monthIndex + 1);
  const fromMonth = new Date(fromMidpoint).getUTCMonth() + 1;
  const toMonth = new Date(toMidpoint).getUTCMonth() + 1;

  return {
    fromMonth,
    toMonth,
    mix: (date.getTime() - fromMidpoint) / (toMidpoint - fromMidpoint),
  };
}
