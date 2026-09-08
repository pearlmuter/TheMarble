import { auroraForecastUsable } from './aurora-model.js';

export function createAuroraController({ loadForecast, demo, now = Date.now }) {
  let mode = 'forecast';
  let forecast;
  let inFlight;
  let error = '';
  return {
    setMode(value) {
      if (!['forecast', 'demo', 'off'].includes(value)) throw new Error('Invalid aurora mode');
      mode = value;
    },
    refresh() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const next = await Promise.resolve().then(loadForecast);
          if (!auroraForecastUsable(next, now())) throw new Error('NOAA forecast is stale or future-dated');
          if (forecast && next.observationTime < forecast.observationTime) throw new Error('NOAA returned an older forecast');
          forecast = next;
          error = '';
        } catch (failure) {
          error = failure instanceof Error ? failure.message : 'Forecast download failed';
        } finally { inFlight = undefined; }
      })();
      return inFlight;
    },
    state(sceneTime = now()) {
      if (mode === 'off') return { mode, enabled: false, error: '', forecast: undefined, gain: 0 };
      if (mode === 'demo') return { mode, enabled: true, error: '', forecast: demo, gain: 8 };
      const enabled = auroraForecastUsable(forecast, now(), sceneTime);
      return { mode, enabled, error, forecast, gain: enabled ? 1 : 0 };
    },
  };
}
