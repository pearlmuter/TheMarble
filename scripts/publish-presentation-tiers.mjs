import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEarthStatePresentationPublisher } from '../src/earth-state-presentation-publication.js';
import { earthStateMediaTypeForPath } from '../src/earth-state-media-types.js';
import { createFilePublicationStore } from '../src/earth-state-publication-file-store.js';

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error(`Invalid option: ${name ?? ''}`);
    options[name.slice(2)] = value;
  }
  return options;
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

const options = parseOptions(process.argv.slice(2));
if (!options.source) throw new Error('Required option missing: --source');
const output = resolve(options.output ?? 'artifacts/earth-state');
const toktx = options.toktx ?? 'toktx';
const sourceUrl = options.source.includes('://') ? options.source : pathToFileURL(resolve(options.source)).href;

const publisher = createEarthStatePresentationPublisher({
  async loadSource(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') throw new Error(`Only local verified publication inputs are supported: ${url}`);
    const bytes = new Uint8Array(await readFile(parsed));
    const mediaType = earthStateMediaTypeForPath(parsed.pathname);
    if (!mediaType) throw new Error(`Unsupported presentation source media type: ${parsed.pathname}`);
    return { bytes, mediaType };
  },
  store: createFilePublicationStore(output),
  async transcodeTexture({ bytes, mediaType, width, height, colorSpace }) {
    const directory = await mkdtemp(join(tmpdir(), 'themarble-ktx2-'));
    const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/png' ? 'png' : 'ktx2';
    const input = join(directory, `source.${extension}`);
    const destination = join(directory, 'presentation.ktx2');
    try {
      await writeFile(input, bytes);
      await run(toktx, [
        '--t2', '--encode', 'uastc', '--uastc_quality', '4', '--zcmp', '18', '--genmipmap',
        '--assign_oetf', colorSpace === 'srgb' ? 'srgb' : 'linear',
        ...(width && height ? ['--resize', `${width}x${height}`] : []),
        destination, input,
      ]);
      return { bytes: new Uint8Array(await readFile(destination)), width, height };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
});

const publication = await publisher.publish({ sourceManifestUrl: sourceUrl });
console.log(`Published ${publication.index.tiers.map(tier => tier.id).join(' and ')} Earth presentation tiers to ${output}`);

