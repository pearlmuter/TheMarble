import type { AuroraForecast } from './aurora-model.js';
export interface AuroraState { mode: string; enabled: boolean; error: string; forecast: AuroraForecast | undefined; gain: number }
export function createAuroraController(options: { loadForecast(): Promise<AuroraForecast>; demo: AuroraForecast; now?: () => number }): {
 setMode(value: string): void;
 refresh(): Promise<void>;
 state(sceneTime?: number): AuroraState;
};
