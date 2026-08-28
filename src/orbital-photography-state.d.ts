export type SceneVector = [number, number, number];

export type OrbitalPhotographyInput = {
  cameraPosition: SceneVector;
  sunPosition: SceneVector;
  sunRadius: number;
  moonPosition: SceneVector;
  moonRadius: number;
  sunNdc: SceneVector;
};

export type OrbitalPhotographyState = {
  earth: { illuminatedFraction: number };
  sun: {
    geometricRadius: number;
    earthOcclusionFraction: number;
    moonOcclusionFraction: number;
    combinedOcclusionFraction: number;
    visibleFraction: number;
    inFrame: boolean;
  };
  optics: {
    bloomStrength: number;
    diffractionStrength: number;
    flareStrength: number;
  };
  exposure: {
    milkyWay: number;
    stars: number;
  };
};

export function orbitalPhotographyState(input: OrbitalPhotographyInput): OrbitalPhotographyState;
