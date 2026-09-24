/**
 * A month's surface, which may not have been fetched yet. The controller only
 * ever decodes the bracketing pair, so months it has not reached arrive with a
 * `load` the rollover calls instead of a `value`.
 */
export type SeasonalFrame<Source> =
  | { month: number; value: Source; load?: undefined }
  | { month: number; value?: undefined; load: (options?: { signal?: AbortSignal }) => Promise<Source> };
export type SeasonalPair<Texture, Source> = {
  fromMonth: number;
  toMonth: number;
  mix: number;
  from: Texture;
  to: Texture;
  frames: Array<SeasonalFrame<Source>>;
};

export function createSeasonalSurfaceController<Texture, Source>(options: {
  decodeFrame(frame: SeasonalFrame<Source>): Promise<Texture>;
  installPair(pair: SeasonalPair<Texture, Source>): void;
  disposeTexture(texture: Texture): void;
  initialTextures?: Texture[];
  retryDelayMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}): {
  prepare(options: { frames: Array<SeasonalFrame<Source>>; date: Date; fallbackTexture?: Texture }): Promise<SeasonalPair<Texture, Source>>;
  activate(pair: SeasonalPair<Texture, Source>): void;
  update(date: Date): void;
};
