function observationWindow(frame) {
  return {
    validAt: frame.validAt,
    observedFrom: frame.observedFrom,
    observedTo: frame.observedTo,
  };
}

export function createCloudObservationController({ initialLayers, install, disposeTexture }) {
  let active = {
    from: { layers: initialLayers },
    to: { layers: initialLayers },
    startedAt: 0,
    durationMs: 0,
  };
  let provenance;

  const disposeUnretained = (layerSets, retainedLayerSets) => {
    const retained = new Set(retainedLayerSets.flatMap(layers => Object.values(layers)));
    const disposed = new Set();
    for (const layers of layerSets) {
      for (const texture of Object.values(layers)) {
        if (!retained.has(texture) && !disposed.has(texture)) {
          disposed.add(texture);
          disposeTexture(texture);
        }
      }
    }
  };

  return {
    get provenance() {
      return provenance;
    },

    activate(sequence, now) {
      const [incomingFrom, to] = sequence.frames;
      const from = active.to.validAt === incomingFrom.validAt
        ? { ...incomingFrom, layers: active.to.layers }
        : incomingFrom;
      const superseded = [active.from.layers, active.to.layers];
      if (from !== incomingFrom) superseded.push(incomingFrom.layers);
      active = {
        from,
        to,
        startedAt: now.valueOf(),
        durationMs: sequence.transitionSeconds * 1000,
      };
      provenance = { from: observationWindow(incomingFrom), to: observationWindow(to) };
      install({ from: from.layers, to: to.layers, mix: 0 });
      disposeUnretained(superseded, [from.layers, to.layers]);
    },

    activateStatic(layers) {
      const superseded = [active.from.layers, active.to.layers];
      active = { from: { layers }, to: { layers }, startedAt: 0, durationMs: 0 };
      provenance = undefined;
      install({ from: layers, to: layers, mix: 1 });
      disposeUnretained(superseded, [layers]);
    },

    update(now) {
      const elapsed = now.valueOf() - active.startedAt;
      const mix = active.durationMs === 0 ? 1 : Math.min(1, Math.max(0, elapsed / active.durationMs));
      install({ from: active.from.layers, to: active.to.layers, mix });
      if (mix === 1 && active.from.layers !== active.to.layers) {
        const previous = active.from.layers;
        active = { ...active, from: active.to };
        disposeUnretained([previous], [active.to.layers]);
      }
    },
  };
}
