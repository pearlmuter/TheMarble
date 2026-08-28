import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(projectRoot, 'node_modules/three/examples/jsm/libs/basis');
const destination = resolve(projectRoot, 'public/basis');
await mkdir(destination, { recursive: true });
await Promise.all([
  copyFile(resolve(source, 'basis_transcoder.js'), resolve(destination, 'basis_transcoder.js')),
  copyFile(resolve(source, 'basis_transcoder.wasm'), resolve(destination, 'basis_transcoder.wasm')),
]);
