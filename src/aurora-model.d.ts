export interface AuroraForecast { observationTime: number; forecastTime: number; grid: Uint8Array }
export const AURORA_SOURCE_URL: string;
export const AURORA_WIDTH: number;
export const AURORA_HEIGHT: number;
export const AURORA_REFRESH_MS: number;
export const AURORA_MAX_AGE_MS: number;
export function parseAuroraForecast(document: unknown): AuroraForecast;
export function auroraForecastUsable(forecast: AuroraForecast | undefined, now: number, sceneTime?: number): boolean;
export function auroraGridUv(direction: number[]): number[];
export function auroraViewDirection(forecast: AuroraForecast | undefined, hemisphere: number, sun: number[]): number[];
export function auroraEmissionGrid(forecast: AuroraForecast): Uint8Array;

export function auroraLatitudeFloor(previous:number|undefined,grid:Uint8Array):number;
