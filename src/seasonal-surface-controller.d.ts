export type SeasonalFrame<Source> = { month: number; value: Source };
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
