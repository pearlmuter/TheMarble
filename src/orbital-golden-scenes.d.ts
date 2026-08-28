import type { CelestialSceneFrame } from './astronomical-state.js';
import type { ScenePosition } from './inertial-camera.js';

export type OrbitalGoldenScene = {
  id: string;
  time: string;
  description: string;
  observerPhaseDegrees: number;
  cameraDistanceEarthRadii: number;
  fovDegrees: number;
  target: 'earth' | 'moon';
};

export const ORBITAL_GOLDEN_SCENES: readonly OrbitalGoldenScene[];
export function orbitalGoldenScene(id: string | null): OrbitalGoldenScene | null;
export function orbitalGoldenCameraPose(
  scene: OrbitalGoldenScene,
  frame: CelestialSceneFrame,
): { position: ScenePosition; target: ScenePosition };
export function createOneTimeOrbitalGoldenCameraPlacement(
  scene: OrbitalGoldenScene,
): (frame: CelestialSceneFrame) => { position: ScenePosition; target: ScenePosition } | null;
