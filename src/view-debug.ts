import type { OrbitMapScale } from './map-view-scale.js';

interface ViewReading {
  scale?: OrbitMapScale;
  latitude?: number;
  longitude?: number;
  viewportWidth: number;
  viewportHeight: number;
  fov: number;
  time: string;
  bundleId: string;
  aurora?: string;
  lightning?: string;
}

export function createViewDebug({ root, defaultRelief, onRelief, readView }: {
  root: HTMLDetailsElement;
  defaultRelief: number;
  onRelief(value: number): void;
  readView(): ViewReading;
}) {
  const slider = root.querySelector<HTMLInputElement>('#debug-relief')!;
  const reliefOutput = root.querySelector<HTMLOutputElement>('#debug-relief-value')!;
  const zoom = root.querySelector<HTMLOutputElement>('#debug-zoom')!;
  const scale = root.querySelector<HTMLOutputElement>('#debug-scale')!;
  const altitude = root.querySelector<HTMLOutputElement>('#debug-altitude')!;
  const location = root.querySelector<HTMLOutputElement>('#debug-location')!;
  const viewport = root.querySelector<HTMLOutputElement>('#debug-viewport')!;
  const copy = root.querySelector<HTMLButtonElement>('#debug-copy')!;
  const captured = root.querySelector<HTMLTextAreaElement>('#debug-capture')!;
  const status = root.querySelector<HTMLElement>('#debug-status')!;
  let relief = defaultRelief;
  let updatedAt = -Infinity;

  const setRelief = (value: number) => {
    if (!Number.isFinite(value)) return;
    relief = Math.min(Number(slider.max), Math.max(Number(slider.min), value));
    slider.value = String(relief);
    reliefOutput.value = `${Number(relief.toFixed(2))}×`;
    slider.setAttribute('aria-valuetext', `${relief} times cloud-top slope`);
    onRelief(relief);
  };
  slider.addEventListener('input', () => setRelief(slider.valueAsNumber));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-relief]')) {
    button.addEventListener('click', () => setRelief(Number(button.dataset.relief)));
  }
  setRelief(defaultRelief);

  const render = (view: ViewReading) => {
    zoom.value = view.scale ? `z ${view.scale.zoom.toFixed(2)}` : 'Unavailable';
    scale.value = view.scale ? `${view.scale.metersPerPixel.toFixed(1)} m / px` : 'Unavailable';
    altitude.value = view.scale ? `${view.scale.altitudeKm.toFixed(0)} km` : 'Unavailable';
    location.value = view.latitude !== undefined && view.longitude !== undefined
      ? `${view.latitude.toFixed(3)}°, ${view.longitude.toFixed(3)}°` : 'Unavailable';
    viewport.value = `${view.viewportWidth} × ${view.viewportHeight} px · ${view.fov.toFixed(1)}° FOV`;
  };
  const update = (now: number) => {
    if (!root.open || root.closest<HTMLElement>('[hidden]') || now - updatedAt < 150) return;
    updatedAt = now;
    render(readView());
  };
  root.addEventListener('toggle', () => { updatedAt = -Infinity; update(performance.now()); });
  copy.addEventListener('click', async () => {
    const view = readView();
    render(view);
    captured.value = [
      `TheMarble view — ${view.time}`,
      `Cloud relief: ${relief}×`,
      `Map zoom: ${view.scale?.zoom.toFixed(3) ?? 'unavailable'} (256 px tiles, equator equivalent)`,
      `Centre ground scale: ${view.scale?.metersPerPixel.toFixed(2) ?? 'unavailable'} metres per CSS pixel`,
      `Altitude: ${view.scale?.altitudeKm.toFixed(2) ?? 'unavailable'} km`,
      `Centre latitude/longitude: ${view.latitude?.toFixed(5) ?? 'unavailable'}, ${view.longitude?.toFixed(5) ?? 'unavailable'}`,
      `Viewport: ${view.viewportWidth} × ${view.viewportHeight} CSS px; vertical FOV: ${view.fov.toFixed(2)}°`,
      `Earth state: ${view.bundleId || 'loading'}`,
      `Aurora: ${view.aurora || 'unavailable'}`,
      `Lightning: ${view.lightning || 'unavailable'}`,
    ].join('\n');
    captured.hidden = false;
    try {
      await navigator.clipboard.writeText(captured.value);
      status.textContent = 'Readings copied. You can paste them into your feedback.';
    } catch {
      captured.focus();
      captured.select();
      status.textContent = 'Select and copy the readings below.';
    }
  });
  return { update };
}
