import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudObservationController } from '../src/cloud-observation-controller.js';

const frame = (validAt, suffix) => ({
  validAt,
  observedFrom: validAt,
  observedTo: validAt.replace(':00:00Z', ':09:59Z'),
  layers: { cloudOpacity: `opacity-${suffix}`, cloudDensity: `density-${suffix}` },
});

test('a complete hourly pair crossfades over the declared transition without inventing an observation time', () => {
  const installed = [];
  const controller = createCloudObservationController({
    initialLayers: { cloudOpacity: 'bundled-opacity', cloudDensity: 'bundled-density' },
    install(state) { installed.push(state); },
    disposeTexture() {},
  });
  const sequence = {
    transitionSeconds: 300,
    frames: [
      frame('2026-08-25T11:00:00Z', '11'),
      frame('2026-08-25T12:00:00Z', '12'),
    ],
  };

  controller.activate(sequence, new Date('2026-08-25T12:48:00Z'));
  controller.update(new Date('2026-08-25T12:50:30Z'));

  assert.deepEqual(installed.at(-1), {
    from: sequence.frames[0].layers,
    to: sequence.frames[1].layers,
    mix: 0.5,
  });
  assert.deepEqual(controller.provenance, {
    from: {
      validAt: '2026-08-25T11:00:00Z',
      observedFrom: '2026-08-25T11:00:00Z',
      observedTo: '2026-08-25T11:09:59Z',
    },
    to: {
      validAt: '2026-08-25T12:00:00Z',
      observedFrom: '2026-08-25T12:00:00Z',
      observedTo: '2026-08-25T12:09:59Z',
    },
  });
});

test('hourly replacement reuses the shared observation and disposes superseded GPU textures once', () => {
  const texture = name => ({ name });
  const layers = suffix => ({ cloudOpacity: texture(`opacity-${suffix}`), cloudDensity: texture(`density-${suffix}`) });
  const initial = layers('bundled');
  const eleven = { ...frame('2026-08-25T11:00:00Z', '11'), layers: layers('11') };
  const twelve = { ...frame('2026-08-25T12:00:00Z', '12'), layers: layers('12') };
  const duplicateTwelve = { ...frame('2026-08-25T12:00:00Z', '12-copy'), layers: layers('12-copy') };
  const thirteen = { ...frame('2026-08-25T13:00:00Z', '13'), layers: layers('13') };
  const installed = [];
  const disposed = [];
  const controller = createCloudObservationController({
    initialLayers: initial,
    install(state) { installed.push(state); },
    disposeTexture(value) { disposed.push(value.name); },
  });

  controller.activate({ transitionSeconds: 300, frames: [eleven, twelve] }, new Date('2026-08-25T12:48:00Z'));
  controller.update(new Date('2026-08-25T12:53:00Z'));
  controller.activate({ transitionSeconds: 300, frames: [duplicateTwelve, thirteen] }, new Date('2026-08-25T13:48:00Z'));

  assert.equal(installed.at(-1).from, twelve.layers);
  assert.equal(installed.at(-1).to, thirteen.layers);
  assert.deepEqual(disposed.sort(), [
    'density-11', 'density-12-copy', 'density-bundled',
    'opacity-11', 'opacity-12-copy', 'opacity-bundled',
  ]);

  controller.update(new Date('2026-08-25T13:53:00Z'));
  assert.deepEqual(disposed.filter(name => name.endsWith('-12')).sort(), ['density-12', 'opacity-12']);
  assert.equal(disposed.includes('density-13'), false);
  assert.equal(disposed.includes('opacity-13'), false);
});
