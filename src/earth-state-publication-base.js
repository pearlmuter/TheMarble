import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export async function resolveEarthStateBaseManifest({ explicitPath, outputDirectory, fallbackPath }) {
  if (explicitPath) return resolve(explicitPath);
  const outputRoot = resolve(outputDirectory);
  try {
    const latest = JSON.parse(await readFile(resolve(outputRoot, 'latest.json'), 'utf8'));
    if (typeof latest?.manifest?.href !== 'string' || latest.manifest.href.trim() === '') {
      throw new Error('Earth-state latest pointer is missing its manifest href');
    }
    const manifestPath = resolve(outputRoot, latest.manifest.href.replace(/^\.\//, ''));
    if (!manifestPath.startsWith(`${outputRoot}${sep}`)) {
      throw new Error('Earth-state latest manifest escapes output directory');
    }
    return manifestPath;
  } catch (error) {
    if (error?.code === 'ENOENT') return resolve(fallbackPath);
    throw error;
  }
}
