import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { celestialSceneFrameAt } from '../src/astronomical-state.js';
import { createEarthFixedCamera } from '../src/earth-fixed-camera.js';

const rotation = hour => {
  const values = celestialSceneFrameAt(new Date(Date.UTC(2026,8,5,hour))).earth.bodyToSceneMatrix;
  const matrix = new Matrix4().set(values[0],values[1],values[2],0, values[3],values[4],values[5],0, values[6],values[7],values[8],0, 0,0,0,1);
  return new Quaternion().setFromRotationMatrix(matrix);
};
const near = (a,b) => assert.ok(a.distanceTo(b)<1e-9, `${a.toArray()} != ${b.toArray()}`);
function setup() {
  const camera = new PerspectiveCamera(22,1,.01,30000);
  camera.position.set(4,2,5); camera.lookAt(0,0,0); camera.updateMatrixWorld();
  return {camera,target:new Vector3(),follow:createEarthFixedCamera()};
}

test('default camera stays in space through a day of Earth rotation', () => {
  const {camera,target,follow}=setup();
  const initial=camera.position.clone();
  for(let h=0;h<=24;h++) follow(camera,target,rotation(h),false);
  near(camera.position,initial);
});

test('follow mode holds the same location AND screen orientation through a day', () => {
  const {camera,target,follow}=setup();
  follow(camera,target,rotation(0),false);
  const point=camera.position.clone().normalize().applyQuaternion(rotation(0).invert());
  const nearby=point.clone().add(new Vector3(.01,.02,.01)).normalize();
  const project=(point,h)=>point.clone().applyQuaternion(rotation(h)).project(camera);
  const initial=project(point,0),initialNearby=project(nearby,0);
  for(let h=1;h<=24;h++) {
    follow(camera,target,rotation(h),true);
    near(project(point,h),initial); near(project(nearby,h),initialNearby);
  }
});

test('toggling does not jump and drag/zoom establishes the new followed place', () => {
  const {camera,target,follow}=setup();
  follow(camera,target,rotation(0),false);
  follow(camera,target,rotation(6),false);
  const before=camera.position.clone();
  follow(camera,target,rotation(6),true); near(camera.position,before);
  camera.position.set(-2,1,3); camera.lookAt(0,0,0);
  const local=camera.position.clone().applyQuaternion(rotation(6).invert());
  follow(camera,target,rotation(12),true);
  near(camera.position.clone().applyQuaternion(rotation(12).invert()),local);
  const released=camera.position.clone();
  follow(camera,target,rotation(18),false); near(camera.position,released);
  follow(camera,target,rotation(18),true); near(camera.position,released);
});
