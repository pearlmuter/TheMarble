export const ORBITAL_GOLDEN_SCENES = Object.freeze([
  {
    id: 'daylight',
    time: '2025-06-21T12:00:00.000Z',
    description: 'Northern-solstice daylight with a clean blue limb and physically shared surface, cloud, and ocean illumination.',
    observerPhaseDegrees: 0,
    cameraDistanceEarthRadii: 7,
    fovDegrees: 22,
    target: 'earth',
  },
  {
    id: 'crescent-earth',
    time: '2025-06-21T12:00:00.000Z',
    description: 'A substantially dark Earth with a narrow sunlit crescent and restrained city lights beneath the clouds.',
    observerPhaseDegrees: 145,
    cameraDistanceEarthRadii: 7,
    fovDegrees: 22,
    target: 'earth',
  },
  {
    id: 'terminator',
    time: '2025-06-21T12:00:00.000Z',
    description: 'A half-lit Earth demonstrating the thin day-night transition, warm low Sun, and dark night hemisphere.',
    observerPhaseDegrees: 90,
    cameraDistanceEarthRadii: 7,
    fovDegrees: 22,
    target: 'earth',
  },
  {
    id: 'sunrise-limb',
    time: '2025-06-21T12:00:00.000Z',
    description: 'The Sun grazing Earth’s atmosphere to reveal the compact aerosol aureole and warm-to-blue tangent layers.',
    observerPhaseDegrees: 171.35,
    cameraDistanceEarthRadii: 7,
    fovDegrees: 22,
    target: 'earth',
  },
  {
    id: 'visible-sun',
    time: '2025-06-21T12:00:00.000Z',
    description: 'The physical solar disc in direct view as saturated HDR radiance, modest bloom, and restrained diffraction.',
    observerPhaseDegrees: 164.5,
    cameraDistanceEarthRadii: 7,
    fovDegrees: 25,
    target: 'earth',
  },
  {
    id: 'solar-occultation',
    time: '2024-04-08T18:00:00.000Z',
    description: 'The geometric Sun fully behind Earth so bloom, diffraction, and flare vanish while the faint sky recovers.',
    observerPhaseDegrees: 180,
    cameraDistanceEarthRadii: 7,
    fovDegrees: 22,
    target: 'earth',
  },
  {
    id: 'moon',
    time: '2025-06-21T12:00:00.000Z',
    description: 'A narrow astronomical field centered on the physically sized, oriented, librating, and Sun-lit Moon.',
    observerPhaseDegrees: 30,
    cameraDistanceEarthRadii: 7,
    fovDegrees: 2.2,
    target: 'moon',
  },
  {
    id: 'milky-way',
    time: '2025-06-21T12:00:00.000Z',
    description: 'A wide field looking away from direct sunlight so the high-resolution Gaia Milky Way and Hipparcos stars emerge.',
    observerPhaseDegrees: 180,
    cameraDistanceEarthRadii: 12,
    fovDegrees: 50,
    target: 'earth',
  },
]);

function normalize(vector) {
  const magnitude = Math.hypot(...vector);
  return vector.map(value => value / magnitude);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function orbitalGoldenScene(id) {
  return ORBITAL_GOLDEN_SCENES.find(scene => scene.id === id) ?? null;
}

export function orbitalGoldenCameraPose(scene, frame) {
  const sun = normalize(frame.sun.inertialDirection);
  const east = normalize(cross([0, 1, 0], sun));
  const north = normalize(cross(sun, east));
  const clockAngle = 38 * Math.PI / 180;
  const tangent = normalize(east.map((value, index) => (
    value * Math.cos(clockAngle) + north[index] * Math.sin(clockAngle)
  )));
  const phase = scene.observerPhaseDegrees * Math.PI / 180;
  const observerDirection = normalize(sun.map((value, index) => (
    value * Math.cos(phase) + tangent[index] * Math.sin(phase)
  )));
  const position = observerDirection.map(value => value * scene.cameraDistanceEarthRadii);
  const target = scene.target === 'moon'
    ? frame.moon.inertialDirection.map(value => value * frame.moon.distanceEarthRadii)
    : [0, 0, 0];
  return { position, target };
}

export function createOneTimeOrbitalGoldenCameraPlacement(scene) {
  let placed = false;
  return frame => {
    if (placed) return null;
    placed = true;
    return orbitalGoldenCameraPose(scene, frame);
  };
}
