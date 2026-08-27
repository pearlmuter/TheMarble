export const ASTRONOMICAL_UNIT_KM: 149597870.7;
export const EARTH_EQUATORIAL_RADIUS_KM: 6378.137;
export const MOON_EQUATORIAL_RADIUS_KM: 1737.4;
export const SUN_EQUATORIAL_RADIUS_KM: 695700;

export type InertialDirectionEqj = [number, number, number];

export interface AstronomicalState {
  time: string;
  earth: {
    greenwichApparentSiderealDegrees: number;
    northPoleInertialEqj: InertialDirectionEqj;
    primeMeridianAngleDegrees: number;
  };
  sun: {
    inertialDirectionEqj: InertialDirectionEqj;
    rightAscensionHours: number;
    declinationDegrees: number;
    distanceAu: number;
    angularDiameterDegrees: number;
    subsolarLatitudeDegrees: number;
    subsolarLongitudeDegrees: number;
  };
  moon: {
    inertialDirectionEqj: InertialDirectionEqj;
    rightAscensionHours: number;
    declinationDegrees: number;
    distanceAu: number;
    angularDiameterDegrees: number;
    phaseAngleDegrees: number;
    illuminatedFraction: number;
    librationLongitudeDegrees: number;
    librationLatitudeDegrees: number;
    northPoleRightAscensionHours: number;
    northPoleDeclinationDegrees: number;
    northPolePositionAngleDegrees: number;
    primeMeridianAngleDegrees: number;
  };
}

export function astronomicalStateAt(date: Date): AstronomicalState;

export type RotationMatrix3 = [number, number, number, number, number, number, number, number, number];

export interface CelestialSceneFrame {
  time: string;
  astronomy: AstronomicalState;
  sky: { inertialEqjToSceneMatrix: RotationMatrix3 };
  earth: { bodyToSceneMatrix: RotationMatrix3 };
  sun: {
    inertialDirection: InertialDirectionEqj;
    earthFixedDirection: InertialDirectionEqj;
    distanceEarthRadii: number;
    angularDiameterDegrees: number;
  };
  moon: {
    inertialDirection: InertialDirectionEqj;
    distanceEarthRadii: number;
    angularDiameterDegrees: number;
    bodyToSceneMatrix: RotationMatrix3;
  };
}

export function celestialSceneFrameAt(date: Date): CelestialSceneFrame;
