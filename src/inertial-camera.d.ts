import type { CelestialSceneFrame } from './astronomical-state.js';

export type FixedSceneView = 'day' | 'terminator' | 'night';
export type ScenePosition = [number, number, number];

export function initialInertialCameraPosition(
  frame: CelestialSceneFrame,
  view?: FixedSceneView,
): ScenePosition;

export function createOneTimeInertialCameraPlacement(
  view?: FixedSceneView,
): (frame: CelestialSceneFrame) => ScenePosition | null;
