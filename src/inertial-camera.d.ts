import type { CelestialSceneFrame } from './astronomical-state.js';

export type FixedSceneView = 'day' | 'terminator' | 'night';
export type ScenePosition = [number, number, number];

export declare const ISS_ORBIT_RADII: number;

export function cameraClippingForAltitude(distanceFromCentre: number): {
  altitude: number;
  near: number;
  zoomSpeed: number;
};

export function initialInertialCameraPosition(
  frame: CelestialSceneFrame,
  view?: FixedSceneView,
): ScenePosition;

export function createOneTimeInertialCameraPlacement(
  view?: FixedSceneView,
): (frame: CelestialSceneFrame) => ScenePosition | null;
