import type { Camera, Quaternion, Vector3 } from 'three';
export function createEarthFixedCamera(): (camera: Camera, target: Vector3, earthRotation: Quaternion, following: boolean) => void;
