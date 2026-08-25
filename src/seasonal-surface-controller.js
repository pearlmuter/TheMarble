import { selectSeasonalSurfaceFrames } from './seasonal-surface.js';

function frameForMonth(frames, month) {
  const frame = frames.find(candidate => candidate.month === month);
  if (!frame) throw new Error(`Seasonal surface is missing calendar month ${month}`);
  return frame;
}

export function createSeasonalSurfaceController({
  decodeFrame,
  installPair,
  disposeTexture,
  initialTextures = [],
  retryDelayMs = 60_000,
  now = () => Date.now(),
  onError = () => undefined,
}) {
  let activeFrames = [];
  let activePair = '';
  let installedTextures = new Set(initialTextures);
  let textureCache = new Map();
  let generation = 0;
  let pendingPair;
  let lastFailure;

  const selectionFor = date => ({ ...selectSeasonalSurfaceFrames(date) });

  const loadSelection = async (frames, selection, { useActiveCache = true } = {}) => {
    const fromFrame = frameForMonth(frames, selection.fromMonth);
    const toFrame = frameForMonth(frames, selection.toMonth);
    const cachedFrom = useActiveCache ? textureCache.get(selection.fromMonth) : undefined;
    const cachedTo = useActiveCache ? textureCache.get(selection.toMonth) : undefined;
    const [fromResult, toResult] = await Promise.allSettled([
      cachedFrom ?? decodeFrame(fromFrame),
      cachedTo ?? decodeFrame(toFrame),
    ]);
    if (fromResult.status === 'rejected' || toResult.status === 'rejected') {
      if (!cachedFrom && fromResult.status === 'fulfilled') disposeTexture(fromResult.value);
      if (!cachedTo && toResult.status === 'fulfilled') disposeTexture(toResult.value);
      throw fromResult.status === 'rejected' ? fromResult.reason : toResult.reason;
    }
    const from = fromResult.value;
    const to = toResult.value;
    return { ...selection, from, to, frames };
  };

  const commit = prepared => {
    const replacements = new Set([prepared.from, prepared.to]);
    for (const texture of installedTextures) {
      if (!replacements.has(texture)) disposeTexture(texture);
    }
    textureCache = new Map([
      [prepared.fromMonth, prepared.from],
      [prepared.toMonth, prepared.to],
    ]);
    installedTextures = replacements;
    activePair = `${prepared.fromMonth}-${prepared.toMonth}`;
    lastFailure = undefined;
    installPair(prepared);
  };

  return {
    async prepare({ frames, date, fallbackTexture }) {
      if (frames.length === 0) {
        if (!fallbackTexture) throw new Error('Seasonal surface fallback texture is unavailable');
        return { fromMonth: 1, toMonth: 1, mix: 0, from: fallbackTexture, to: fallbackTexture, frames };
      }
      return loadSelection(frames, selectionFor(date), { useActiveCache: false });
    },

    activate(prepared) {
      generation += 1;
      pendingPair = undefined;
      activeFrames = prepared.frames;
      commit(prepared);
    },

    update(date) {
      if (activeFrames.length === 0) return;
      const selection = selectionFor(date);
      const pair = `${selection.fromMonth}-${selection.toMonth}`;
      if (pair === activePair) {
        installPair({
          ...selection,
          from: textureCache.get(selection.fromMonth),
          to: textureCache.get(selection.toMonth),
          frames: activeFrames,
        });
        return;
      }
      if (pendingPair === pair) return;
      if (lastFailure?.pair === pair && now() - lastFailure.at < retryDelayMs) return;

      const requestGeneration = ++generation;
      pendingPair = pair;
      void loadSelection(activeFrames, selection).then(prepared => {
        if (requestGeneration !== generation) {
          for (const texture of new Set([prepared.from, prepared.to])) {
            if (!installedTextures.has(texture)) disposeTexture(texture);
          }
          return;
        }
        commit(prepared);
      }).catch(error => {
        if (requestGeneration !== generation) return;
        lastFailure = { pair, at: now() };
        onError(error);
      }).finally(() => {
        if (requestGeneration === generation) pendingPair = undefined;
      });
    },
  };
}
