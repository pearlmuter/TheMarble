import { Quaternion } from 'three';

/** Carry the current view with Earth's rotation, including any intervening drag/zoom. */
export function createEarthFixedCamera() {
  const previous = new Quaternion();
  const delta = new Quaternion();
  let initialized = false;
  return (camera, target, earthRotation, following) => {
    if (initialized && following) {
      delta.copy(previous).invert().premultiply(earthRotation);
      camera.position.applyQuaternion(delta);
      target.applyQuaternion(delta);
      camera.up.applyQuaternion(delta);
      camera.quaternion.premultiply(delta);
      camera.updateMatrixWorld();
    }
    previous.copy(earthRotation);
    initialized = true;
  };
}
