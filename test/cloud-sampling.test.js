import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudCoverageWeight } from '../src/cloud-sampling.js';
test('coverage feather stays inside the observed band and leaves interior and complete coverage intact',()=>{
  for(const latitude of [-90,-74,74,90]) assert.equal(cloudCoverageWeight(latitude,[-73,73]),0);
  for(const latitude of [-70,0,70]) assert.equal(cloudCoverageWeight(latitude,[-73,73]),1);
  assert.equal(cloudCoverageWeight(72.25,[-73,73]),.5);
  for(const latitude of [-90,-89,0,89,90]) assert.equal(cloudCoverageWeight(latitude,[-90,90]),1);
});
