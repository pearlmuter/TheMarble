import test from 'node:test';
import assert from 'node:assert/strict';
import { limbCase,referenceRadiance,transmission } from '../scripts/sunrise-reference.mjs';

test('independent integration produces blue upper air while Earth hides the solar center',()=>{
  const p=limbCase(20,-.6);
  assert.deepEqual(transmission(p.origin,p.sun),[0,0,0]);
  const light=referenceRadiance({...p,viewSteps:512,lightSteps:128});
  assert.ok(light[2]>.07 && light[2]>light[0]);
});

test('independent integration produces warmer low air in the same pre-sunrise geometry',()=>{
  const p=limbCase(5,-.6);
  const light=referenceRadiance({...p,viewSteps:512,lightSteps:128});
  assert.ok(light[0]>light[1]*5 && light[1]>light[2]*50);
});

test('independent integral converges as both path resolutions increase',()=>{
  const p=limbCase(20,-.3);
  const a=referenceRadiance({...p,viewSteps:512,lightSteps:128});
  const b=referenceRadiance({...p,viewSteps:1024,lightSteps:256});
  a.forEach((v,c)=>assert.ok(Math.abs(v-b[c])/b[c]<.001));
});

test('a vacuum ray has unit transmission while tangent air preferentially attenuates blue',()=>{
  assert.deepEqual(transmission([0,0,7],[0,0,1]),[1,1,1]);
  const p=limbCase(5,0),t=transmission(p.origin,p.ray,2048);
  assert.ok(t[0]>t[1] && t[1]>t[2]);
  assert.ok(t.every(v=>v>=0&&v<=1));
});
