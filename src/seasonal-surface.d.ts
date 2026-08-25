export interface SeasonalSurfaceSelection {
  fromMonth: number;
  toMonth: number;
  mix: number;
}

export function selectSeasonalSurfaceFrames(date: Date): SeasonalSurfaceSelection;
