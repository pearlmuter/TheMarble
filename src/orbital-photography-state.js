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
  return Math.acos(clamp(leftDirection.reduce((sum, value, index) => sum + value * rightDirection[index], 0), -1, 1));
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

function occultationFraction({ cameraPosition, sourcePosition, sourceRadius, occultorPosition, occultorRadius }) {
  const sourceVector = subtract(sourcePosition, cameraPosition);
  const occultorVector = subtract(occultorPosition, cameraPosition);
  const sourceDistance = length(sourceVector);
  const occultorDistance = length(occultorVector);
  if (occultorDistance >= sourceDistance) return 0;
  const sourceAngularRadius = angularRadius(sourceRadius, sourceDistance);
  const occultorAngularRadius = angularRadius(occultorRadius, occultorDistance);
  const separation = angularSeparation(sourceVector, occultorVector);
  const overlap = circleOverlapArea(sourceAngularRadius, occultorAngularRadius, separation);
  return clamp(overlap / (Math.PI * sourceAngularRadius ** 2), 0, 1);
}

export function orbitalPhotographyState({
  cameraPosition,
  sunPosition,
  sunRadius,
  moonPosition,
  moonRadius,
  sunNdc,
}) {
  const earthOcclusionFraction = occultationFraction({
    cameraPosition,
    sourcePosition: sunPosition,
    sourceRadius: sunRadius,
    occultorPosition: [0, 0, 0],
    occultorRadius: 1,
  });
  const moonOcclusionFraction = occultationFraction({
    cameraPosition,
    sourcePosition: sunPosition,
    sourceRadius: sunRadius,
    occultorPosition: moonPosition,
    occultorRadius: moonRadius,
  });
  const visibleFraction = 1 - Math.max(earthOcclusionFraction, moonOcclusionFraction);
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
