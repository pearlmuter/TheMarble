function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function smoothstep(minimum, maximum, value) {
  const amount = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(vector) {
  return Math.hypot(...vector);
}

function normalize(vector) {
  const magnitude = length(vector);
  return vector.map(value => value / magnitude);
}

function angularSeparation(left, right) {
  const leftDirection = normalize(left);
  const rightDirection = normalize(right);
  return Math.acos(clamp(dot(leftDirection, rightDirection), -1, 1));
}

function angularRadius(radius, distance) {
  return Math.asin(clamp(radius / distance, 0, 1));
}

function circleOverlapArea(firstRadius, secondRadius, separation) {
  if (separation >= firstRadius + secondRadius) return 0;
  if (separation <= Math.abs(firstRadius - secondRadius)) {
    return Math.PI * Math.min(firstRadius, secondRadius) ** 2;
  }
  const firstAngle = Math.acos(clamp(
    (separation ** 2 + firstRadius ** 2 - secondRadius ** 2) / (2 * separation * firstRadius),
    -1,
    1,
  ));
  const secondAngle = Math.acos(clamp(
    (separation ** 2 + secondRadius ** 2 - firstRadius ** 2) / (2 * separation * secondRadius),
    -1,
    1,
  ));
  const triangle = 0.5 * Math.sqrt(Math.max(
    0,
    (-separation + firstRadius + secondRadius)
      * (separation + firstRadius - secondRadius)
      * (separation - firstRadius + secondRadius)
      * (separation + firstRadius + secondRadius),
  ));
  return firstRadius ** 2 * firstAngle + secondRadius ** 2 * secondAngle - triangle;
}

function apparentOccultorDisc({ cameraPosition, sourcePosition, sourceRadius, occultorPosition, occultorRadius }) {
  const sourceVector = subtract(sourcePosition, cameraPosition);
  const occultorVector = subtract(occultorPosition, cameraPosition);
  const sourceDistance = length(sourceVector);
  const occultorDistance = length(occultorVector);
  if (occultorDistance >= sourceDistance) return null;
  const sourceDirection = normalize(sourceVector);
  const occultorDirection = normalize(occultorVector);
  const sourceAngularRadius = angularRadius(sourceRadius, sourceDistance);
  const occultorAngularRadius = angularRadius(occultorRadius, occultorDistance);
  const separation = angularSeparation(sourceDirection, occultorDirection);
  const reference = Math.abs(sourceDirection[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const horizontal = normalize(cross(reference, sourceDirection));
  const vertical = cross(sourceDirection, horizontal);
  const tangentDirection = subtract(occultorDirection, sourceDirection.map(value => value * dot(occultorDirection, sourceDirection)));
  const tangentLength = length(tangentDirection);
  const azimuth = tangentLength > 1e-12
    ? tangentDirection.map(value => value / tangentLength)
    : horizontal;
  const normalizedSeparation = separation / sourceAngularRadius;

  return {
    x: dot(azimuth, horizontal) * normalizedSeparation,
    y: dot(azimuth, vertical) * normalizedSeparation,
    radius: occultorAngularRadius / sourceAngularRadius,
  };
}

function discCoverageFraction(disc) {
  if (!disc) return 0;
  const separation = Math.hypot(disc.x, disc.y);
  return clamp(circleOverlapArea(1, disc.radius, separation) / Math.PI, 0, 1);
}

function coveredInterval(disc, horizontalPosition, sourceHalfHeight) {
  const horizontalOffset = horizontalPosition - disc.x;
  if (Math.abs(horizontalOffset) >= disc.radius) return null;
  const halfHeight = Math.sqrt(Math.max(0, disc.radius ** 2 - horizontalOffset ** 2));
  const lower = Math.max(-sourceHalfHeight, disc.y - halfHeight);
  const upper = Math.min(sourceHalfHeight, disc.y + halfHeight);
  return upper > lower ? [lower, upper] : null;
}

function combinedDiscCoverageFraction(discs) {
  const overlappingDiscs = discs.filter(disc => disc && discCoverageFraction(disc) > 0);
  if (overlappingDiscs.length === 0) return 0;
  if (overlappingDiscs.some(disc => disc.radius >= 1 + Math.hypot(disc.x, disc.y))) return 1;
  if (overlappingDiscs.length === 1) return discCoverageFraction(overlappingDiscs[0]);

  // Integrate the union of the occultor intervals across the normalized solar disc.
  // Simpson integration keeps partial ingress and egress continuous without a pixel grid.
  const segmentCount = 128;
  const step = 2 / segmentCount;
  let weightedArea = 0;
  for (let index = 0; index <= segmentCount; index += 1) {
    const horizontalPosition = -1 + index * step;
    const sourceHalfHeight = Math.sqrt(Math.max(0, 1 - horizontalPosition ** 2));
    const intervals = overlappingDiscs
      .map(disc => coveredInterval(disc, horizontalPosition, sourceHalfHeight))
      .filter(Boolean)
      .sort((left, right) => left[0] - right[0]);
    let coveredLength = 0;
    let current = intervals[0] ?? null;
    for (let intervalIndex = 1; intervalIndex < intervals.length; intervalIndex += 1) {
      const next = intervals[intervalIndex];
      if (next[0] <= current[1]) current[1] = Math.max(current[1], next[1]);
      else {
        coveredLength += current[1] - current[0];
        current = next;
      }
    }
    if (current) coveredLength += current[1] - current[0];
    const weight = index === 0 || index === segmentCount ? 1 : index % 2 === 0 ? 2 : 4;
    weightedArea += weight * coveredLength;
  }
  return clamp(weightedArea * step / 3 / Math.PI, 0, 1);
}

export function orbitalPhotographyState({
  cameraPosition,
  sunPosition,
  sunRadius,
  moonPosition,
  moonRadius,
  sunNdc,
}) {
  const earthDisc = apparentOccultorDisc({
    cameraPosition,
    sourcePosition: sunPosition,
    sourceRadius: sunRadius,
    occultorPosition: [0, 0, 0],
    occultorRadius: 1,
  });
  const moonDisc = apparentOccultorDisc({
    cameraPosition,
    sourcePosition: sunPosition,
    sourceRadius: sunRadius,
    occultorPosition: moonPosition,
    occultorRadius: moonRadius,
  });
  const earthOcclusionFraction = discCoverageFraction(earthDisc);
  const moonOcclusionFraction = discCoverageFraction(moonDisc);
  const combinedOcclusionFraction = combinedDiscCoverageFraction([earthDisc, moonDisc]);
  const visibleFraction = 1 - combinedOcclusionFraction;
  const frameDistance = Math.max(Math.abs(sunNdc[0]), Math.abs(sunNdc[1]));
  const inFront = sunNdc[2] > -1 && sunNdc[2] < 1;
  const inFrame = inFront && frameDistance < 1.3;
  const frameFalloff = inFrame ? 1 - smoothstep(0.72, 1.3, frameDistance) : 0;
  const directSolarSignal = visibleFraction * frameFalloff;
  const observerDirection = normalize(cameraPosition);
  const geocentricSunDirection = normalize(sunPosition);
  const earthIlluminatedFraction = clamp(
    (1 + observerDirection.reduce((sum, value, index) => sum + value * geocentricSunDirection[index], 0)) * 0.5,
    0,
    1,
  );
  const sceneBrightness = Math.max(directSolarSignal, earthIlluminatedFraction * 0.85);

  return {
    earth: { illuminatedFraction: earthIlluminatedFraction },
    sun: {
      geometricRadius: sunRadius,
      earthOcclusionFraction,
      moonOcclusionFraction,
      combinedOcclusionFraction,
      visibleFraction,
      inFrame,
    },
    optics: {
      bloomStrength: inFrame ? visibleFraction ** 0.35 : 0,
      diffractionStrength: inFrame ? visibleFraction ** 0.55 * 0.82 : 0,
      flareStrength: visibleFraction ** 0.7 * frameFalloff * 0.9,
    },
    exposure: {
      milkyWay: 0.72 - sceneBrightness * 0.65,
      stars: 0.95 - sceneBrightness * 0.75,
    },
  };
}
