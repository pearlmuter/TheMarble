export type CloudLayerPair<Texture> = {
  cloudOpacity: Texture;
  cloudDensity: Texture;
  cloudPhysics?: Texture;
  cloudAge?: Texture;
};

export type CloudObservationFrame<Texture> = {
  validAt: string;
  observedFrom: string;
  observedTo: string;
  layers: CloudLayerPair<Texture>;
};

export type CloudObservationSequence<Texture> = {
  transitionSeconds: number;
  frames: [CloudObservationFrame<Texture>, CloudObservationFrame<Texture>];
};

export function createCloudObservationController<Texture>(adapters: {
  initialLayers: CloudLayerPair<Texture>;
  install(state: { from: CloudLayerPair<Texture>; to: CloudLayerPair<Texture>; mix: number }): void;
  disposeTexture(texture: Texture): void;
}): {
  readonly provenance: {
    from: Omit<CloudObservationFrame<Texture>, 'layers'>;
    to: Omit<CloudObservationFrame<Texture>, 'layers'>;
  } | undefined;
  activate(sequence: CloudObservationSequence<Texture>, now: Date): void;
  activateStatic(layers: CloudLayerPair<Texture>): void;
  update(now: Date): void;
};
