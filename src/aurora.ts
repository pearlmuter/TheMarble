import * as THREE from 'three';
import demoDocument from './aurora-demo.json';
import { AURORA_SOURCE_URL, AURORA_REFRESH_MS, parseAuroraForecast, auroraViewDirection } from './aurora-model.js';
import { createAuroraController } from './aurora-controller.js';
import { auroraMagneticField } from './aurora-physics.js';
import { createAuroraLayer } from './aurora-render.js';

export function createAurora({ planet, renderer, transmittance, onView }: {
  planet: THREE.Group; renderer: THREE.WebGLRenderer; transmittance: THREE.Texture;
  onView(direction: number[]): void;
}) {
  const demo = parseAuroraForecast({
    'Observation Time': demoDocument.observationTime,
    'Forecast Time': demoDocument.forecastTime,
    coordinates: demoDocument.grid.map((probability, index) => [index % 360, Math.floor(index / 360) - 90, probability]),
  });
  const controller = createAuroraController({
    demo,
    async loadForecast() {
      const response = await fetch(AURORA_SOURCE_URL, { signal: AbortSignal.timeout(15_000), credentials: 'omit' });
      if (!response.ok) throw new Error(`NOAA download returned ${response.status}`);
      return parseAuroraForecast(await response.json());
    },
  });
  const layer = createAuroraLayer(planet, transmittance);
  const select = document.querySelector<HTMLSelectElement>('#aurora-mode')!;
  const speed = document.querySelector<HTMLSelectElement>('#aurora-speed')!;
  let simulationTime=0,previousSeconds: number | undefined;
  const status = document.querySelector<HTMLElement>('#aurora-status')!;
  const badge = document.querySelector<HTMLElement>('#aurora-demo-badge')!;
  const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-aurora-view]')];
  const sun = new THREE.Vector3(1, 0, 0);
  let lastSceneTime = Date.now();
  let lastStatusUpdate = -Infinity;
  const utc = (time: number) => new Date(time).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  select.addEventListener('change', () => {
    controller.setMode(select.value);
    lastStatusUpdate = -Infinity;
    if (select.value === 'forecast') void controller.refresh();
  });
  speed.addEventListener('change',()=>{lastStatusUpdate=-Infinity;});
  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      const state = controller.state(lastSceneTime);
      if (state.enabled) onView(auroraViewDirection(state.forecast, Number(button.dataset.auroraView), sun.toArray()));
    });
  }
  void controller.refresh();
  window.setInterval(() => { if (select.value === 'forecast') void controller.refresh(); }, AURORA_REFRESH_MS);
  return {
    update(sceneTime: number, sunLocal: THREE.Vector3, seconds: number) {
      lastSceneTime = sceneTime;
      sun.copy(sunLocal);
      const state = controller.state(sceneTime);
      const rate=speed.value==='20'?20:1;
      if(previousSeconds!==undefined)simulationTime+=Math.max(0,seconds-previousSeconds)*rate;
      previousSeconds=seconds;
      layer.update(renderer, sun, simulationTime, sceneTime, state.enabled ? state.forecast : undefined, state.gain);
      if (seconds - lastStatusUpdate < 1) return;
      lastStatusUpdate = seconds;
      badge.hidden = state.mode !== 'demo' && !(state.enabled && rate>1);
      badge.textContent = state.mode==='demo' ? `Aurora demonstration · amplified${rate>1?' · 20× time-lapse':''}` : 'Aurora simulation · 20× time-lapse';
      for (const button of viewButtons) button.disabled = !state.enabled;
      const timing = state.forecast
        ? `Forecast for ${utc(state.forecast.forecastTime)}; solar wind observed ${utc(state.forecast.observationTime)}.` : '';
      const message = state.mode === 'off' ? 'Aurora is off.'
        : state.mode === 'demo' ? `Demonstration — recorded NOAA forecast, activity amplified 8×. ${timing} Not current conditions or a historical storm reconstruction.`
        : state.enabled ? `Latest NOAA forecast overlay. ${timing} ${state.error ? 'Refresh failed; using the last fresh forecast.' : 'Field-aligned curtains and light output are estimated; night-view exposure is used.'}`
        : state.forecast ? `Aurora hidden: forecast is stale or does not match this scene time. ${timing}`
        : state.error ? `Aurora unavailable: ${state.error}. Retrying automatically.` : 'Checking NOAA aurora forecast…';
      const epoch=auroraMagneticField(sceneTime).epochClamped?' Magnetic field date is outside 2025–2030; the nearest model epoch is used.':'';
      const description=message+epoch;
      if (status.textContent !== description) status.textContent = description;
      status.dataset.mode = state.mode;
      status.dataset.available = String(state.enabled);
    },
  };
}
