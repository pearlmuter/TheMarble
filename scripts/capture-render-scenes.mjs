// Deterministic render captures for the Earth render upgrade (docs/earth-render-upgrade.md).
//
// Drives the `?golden=<scene>` camera poses from src/orbital-golden-scenes.js against a local
// vite server, screenshots each one, and measures the regions that the upgrade is supposed to
// move: deep ocean brightness, land saturation at disc centre versus limb, halo width, and the
// space background. "The ocean is no longer black" is a number, not an opinion.
//
//   node scripts/capture-render-scenes.mjs --out artifacts/render-baseline
//   node scripts/capture-render-scenes.mjs --out artifacts/render-stage2 --scenes daylight,terminator
//   node scripts/capture-render-scenes.mjs --out artifacts/x --url http://localhost:5173
//
// Compare two runs:
//   node scripts/capture-render-scenes.mjs --compare artifacts/render-baseline artifacts/render-stage2

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ORBITAL_GOLDEN_SCENES } from '../src/orbital-golden-scenes.js';

const WIDTH = 1600;
const HEIGHT = 1000;
const DEFAULT_SCENES = ['daylight', 'terminator', 'sunrise-limb', 'crescent-earth'];
// A local vite server is quick. Production is not: the Milky Way alone is 47 MB, so a cold
// fetch of the deployed site needs far longer than a dev build ever does.
const DEFAULT_READY_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------- PNG decoding

/** Decode an 8-bit RGB/RGBA PNG to { width, height, channels, data }. No dependencies. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error('Interlaced PNG is not supported');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(height * stride);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x];
      const left = x >= channels ? data[row + x - channels] : 0;
      const up = y > 0 ? data[previous + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[previous + x - channels] : 0;
      let result;
      if (filter === 0) result = value;
      else if (filter === 1) result = value + left;
      else if (filter === 2) result = value + up;
      else if (filter === 3) result = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const dLeft = Math.abs(p - left);
        const dUp = Math.abs(p - up);
        const dUpLeft = Math.abs(p - upLeft);
        result = value + (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft);
      } else throw new Error(`Unsupported PNG filter ${filter}`);
      data[row + x] = result & 0xff;
    }
    source += stride;
  }
  return { width, height, channels, data };
}

// ---------------------------------------------------------------- measurement

/**
 * Angular radius of the Earth disc in pixels, from the scene's own camera geometry.
 * A point at angle theta from the view axis lands at (H/2) * tan(theta) / tan(fov/2).
 */
function discRadiusPixels(scene, height) {
  const silhouette = Math.asin(1 / scene.cameraDistanceEarthRadii);
  return (height / 2) * (Math.tan(silhouette) / Math.tan((scene.fovDegrees * Math.PI) / 360));
}

const toLinear = value => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function accumulator() {
  return { n: 0, r: 0, g: 0, b: 0, saturation: 0 };
}

function add(into, r, g, b) {
  into.n += 1;
  into.r += r;
  into.g += g;
  into.b += b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  into.saturation += max > 0 ? (max - min) / max : 0;
}

function summarise(into) {
  if (into.n === 0) return null;
  const srgb = [into.r / into.n, into.g / into.n, into.b / into.n].map(v => Math.round(v));
  return {
    pixels: into.n,
    srgb,
    linear: srgb.map(v => Number(toLinear(v).toFixed(5))),
    saturation: Number((into.saturation / into.n).toFixed(4)),
  };
}

/** Everything the upgrade is supposed to move, measured off one capture. */
function measure(image, scene) {
  const { width, height, channels, data } = image;
  const radius = discRadiusPixels(scene, height);
  const centreX = width / 2;
  const centreY = height / 2;

  const regions = {
    deepOcean: accumulator(),
    land: accumulator(),
    centreLand: accumulator(),
    limbLand: accumulator(),
    space: accumulator(),
  };
  const spaceSamples = [];
  // Radial brightness just outside the silhouette, in 1px rings, for halo width.
  const haloBins = new Array(120).fill(null).map(() => ({ sum: 0, n: 0 }));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const dx = x - centreX;
      const dy = y - centreY;
      const distance = Math.hypot(dx, dy) / radius;

      if (distance > 1.0) {
        const ring = Math.floor((distance - 1.0) * radius);
        if (ring >= 0 && ring < haloBins.length) {
          haloBins[ring].sum += (r + g + b) / 3;
          haloBins[ring].n += 1;
        }
      }

      if (distance >= 1.6 && distance <= 2.0) {
        add(regions.space, r, g, b);
        spaceSamples.push((r + g + b) / 3);
        continue;
      }
      if (distance >= 0.97) continue;

      // Sunlit only: an unlit pixel carries no information about aerial perspective.
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance < 6) continue;

      const isOcean = b > r + 6 && luminance < 105;
      if (isOcean) {
        if (distance < 0.62) add(regions.deepOcean, r, g, b);
      } else {
        add(regions.land, r, g, b);
        if (distance < 0.42) add(regions.centreLand, r, g, b);
        else if (distance > 0.76) add(regions.limbLand, r, g, b);
      }
    }
  }

  // Halo width: rings outside the silhouette until brightness decays to a tenth of the
  // first ring. A hard rim decays within a few pixels; real airlight takes tens.
  const profile = haloBins.map(bin => (bin.n > 0 ? bin.sum / bin.n : 0));
  const spaceFloor = spaceSamples.length
    ? spaceSamples.slice().sort((a, b) => a - b)[Math.floor(spaceSamples.length / 2)]
    : 0;
  const peak = Math.max(...profile.slice(0, 6));
  let haloWidth = 0;
  const threshold = spaceFloor + (peak - spaceFloor) * 0.1;
  for (let ring = 0; ring < profile.length; ring += 1) {
    if (profile[ring] > threshold) haloWidth = ring + 1;
  }

  const centreLand = summarise(regions.centreLand);
  const limbLand = summarise(regions.limbLand);
  return {
    discRadiusPixels: Number(radius.toFixed(1)),
    deepOcean: summarise(regions.deepOcean),
    land: summarise(regions.land),
    centreLand,
    limbLand,
    space: summarise(regions.space),
    spaceMedian: Number(spaceFloor.toFixed(2)),
    halo: {
      peak: Number(peak.toFixed(1)),
      widthPixels: haloWidth,
      profile: profile.slice(0, 40).map(v => Number(v.toFixed(1))),
    },
    // Negative means land desaturates toward the limb, which is what aerial perspective does.
    aerialPerspective:
      centreLand && limbLand ? Number((limbLand.saturation - centreLand.saturation).toFixed(4)) : null,
  };
}

// ---------------------------------------------------------------- capture

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith('--')) continue;
    const next = argv[index + 1];
    if (flag === '--compare') {
      options.compare = [next, argv[index + 2]];
      index += 2;
      continue;
    }
    options[flag.slice(2)] = next?.startsWith('--') ? 'true' : next;
    if (next && !next.startsWith('--')) index += 1;
  }
  return options;
}

async function startViteServer(port) {
  await new Promise((fulfil, reject) => {
    const prepare = spawn('node', ['scripts/prepare-basis-transcoder.mjs'], { stdio: 'inherit' });
    prepare.on('exit', code => (code === 0 ? fulfil() : reject(new Error('basis transcoder prep failed'))));
    prepare.on('error', reject);
  });
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((fulfil, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not start within 60s')), 60_000);
    const onData = chunk => {
      const text = String(chunk);
      const match = text.match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        fulfil(match[0]);
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('error', reject);
  });
  return { server, url };
}

async function captureScene({ browser, baseUrl, sceneId, outputDirectory, readyTimeoutMs }) {
  const scene = ORBITAL_GOLDEN_SCENES.find(entry => entry.id === sceneId);
  if (!scene) throw new Error(`Unknown golden scene ${sceneId}`);
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('golden', sceneId);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForSelector('#loading[aria-hidden="true"]', { timeout: readyTimeoutMs });
    // The loading marker clears once the *first* state is activated, which against a deployment
    // is the packaged fallback -- the remote state is still tens of megabytes away. Screenshotting
    // there photographs the fallback and calls it live, which is exactly the mistake this harness
    // made until a live capture came back within one sRGB level of a local one. Wait for the
    // refresh to settle, as scripts/smoke-earth-production.mjs already does.
    await page.waitForFunction(() => {
      const refresh = document.querySelector('#earth-state-summary')?.getAttribute('data-refresh');
      return refresh === 'current' || refresh === 'failed';
    }, undefined, { timeout: readyTimeoutMs });
    const runtime = await page.locator('#earth-state-summary').evaluate(element => ({
      bundleId: element.getAttribute('data-bundle-id') ?? '',
      source: element.getAttribute('data-runtime-source') ?? '',
      refresh: element.getAttribute('data-refresh') ?? '',
    })).catch(() => ({ bundleId: '', source: '', refresh: '' }));
    // Textures stream in after the state settles, and the camera damps into pose.
    await page.waitForTimeout(3_000);
    const screenshot = await page.screenshot({ type: 'png' });
    await writeFile(join(outputDirectory, `${sceneId}.png`), screenshot);
    const image = decodePng(screenshot);
    return { scene: sceneId, runtime, consoleErrors, measurements: measure(image, scene) };
  } finally {
    await page.close();
  }
}

function formatScene(report) {
  const m = report.measurements;
  const rgb = region => (region ? `${String(region.srgb[0]).padStart(3)},${String(region.srgb[1]).padStart(3)},${String(region.srgb[2]).padStart(3)}` : '   —');
  return [
    `  ${report.scene}${report.runtime?.bundleId ? `   [${report.runtime.source} · ${report.runtime.refresh} · ${report.runtime.bundleId}]` : ''}`,
    `    deep ocean sRGB   ${rgb(m.deepOcean)}   (${m.deepOcean?.pixels ?? 0} px)`,
    `    land sRGB         ${rgb(m.land)}   saturation ${m.land?.saturation ?? '—'}`,
    `    centre vs limb    ${m.centreLand?.saturation ?? '—'} -> ${m.limbLand?.saturation ?? '—'}  (aerial ${m.aerialPerspective})`,
    `    space sRGB        ${rgb(m.space)}   median ${m.spaceMedian}`,
    `    halo              peak ${m.halo.peak}  width ${m.halo.widthPixels}px  disc r=${m.discRadiusPixels}px`,
    report.consoleErrors.length
      ? `    CONSOLE ERRORS    ${report.consoleErrors.length}\n${report.consoleErrors.map(line => `      ${line.split('\n')[0]}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function compare(left, right) {
  const [a, b] = await Promise.all(
    [left, right].map(async directory => JSON.parse(await readFile(join(resolve(directory), 'measurements.json'), 'utf8'))),
  );
  console.log(`\n${left}  ->  ${right}\n`);
  for (const scene of a.scenes) {
    const other = b.scenes.find(entry => entry.scene === scene.scene);
    if (!other) continue;
    console.log(`  ${scene.scene}`);
    const rows = [
      ['deep ocean', scene.measurements.deepOcean?.srgb, other.measurements.deepOcean?.srgb],
      ['land', scene.measurements.land?.srgb, other.measurements.land?.srgb],
      ['space', scene.measurements.space?.srgb, other.measurements.space?.srgb],
    ];
    for (const [label, from, to] of rows) {
      if (!from || !to) continue;
      console.log(`    ${label.padEnd(12)} ${from.join(',').padEnd(14)} -> ${to.join(',')}`);
    }
    console.log(`    ${'halo width'.padEnd(12)} ${String(scene.measurements.halo.widthPixels).padEnd(14)} -> ${other.measurements.halo.widthPixels}`);
    console.log(`    ${'aerial'.padEnd(12)} ${String(scene.measurements.aerialPerspective).padEnd(14)} -> ${other.measurements.aerialPerspective}`);
  }
  console.log('');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.compare) return compare(options.compare[0], options.compare[1]);

  const outputDirectory = resolve(options.out ?? 'artifacts/render-capture');
  await mkdir(outputDirectory, { recursive: true });
  const sceneIds = (options.scenes ?? DEFAULT_SCENES.join(',')).split(',').filter(Boolean);
  const readyTimeoutMs = Number(options['ready-timeout'] ?? DEFAULT_READY_TIMEOUT_MS);

  let vite = null;
  let baseUrl = options.url;
  if (!baseUrl) {
    vite = await startViteServer(Number(options.port ?? 5183));
    baseUrl = vite.url;
  }
  console.log(`capturing ${sceneIds.length} scene(s) from ${baseUrl} into ${outputDirectory}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=default', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const scenes = [];
  try {
    for (const sceneId of sceneIds) {
      const report = await captureScene({ browser, baseUrl, sceneId, outputDirectory, readyTimeoutMs });
      scenes.push(report);
      console.log(formatScene(report));
    }
  } finally {
    await browser.close();
    vite?.server.kill('SIGTERM');
  }

  const report = { capturedAt: new Date().toISOString(), width: WIDTH, height: HEIGHT, scenes };
  await writeFile(join(outputDirectory, 'measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${join(outputDirectory, 'measurements.json')}`);

  // A shader that fails to compile still renders a picture -- just one missing whatever that
  // shader contributed. Measurements alone will not say so, so this has to be fatal.
  const broken = scenes.filter(scene => scene.consoleErrors.length > 0);
  if (broken.length > 0) {
    console.error(`\nFAILED: ${broken.map(scene => scene.scene).join(', ')} emitted console errors`);
    process.exitCode = 1;
  }
}

await main();
