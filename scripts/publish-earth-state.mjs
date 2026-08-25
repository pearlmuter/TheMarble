import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEarthStatePublisher } from '../src/earth-state-publication.js';

const MEDIA_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
]);

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error('Arguments must be --name value pairs');
    options[flag.slice(2)] = value;
  }
  for (const required of ['source', 'target-time', 'output']) {
    if (!options[required]) throw new Error(`Missing required --${required}`);
  }
  return options;
}

function mediaTypeFor(url, header) {
  const declared = header?.split(';', 1)[0];
  if (declared && declared !== 'application/octet-stream') return declared;
  const pathname = new URL(url).pathname;
  const mediaType = MEDIA_TYPES.get(extname(pathname).toLowerCase());
  if (!mediaType) throw new Error(`Cannot determine media type for ${url}`);
  return mediaType;
}

function createFilePublicationStore(rootDirectory) {
  const root = resolve(rootDirectory);
  const pathInRoot = publicationPath => {
    if (isAbsolute(publicationPath)) throw new Error(`Publication path must be relative: ${publicationPath}`);
    const path = resolve(root, publicationPath);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Publication path escapes output root: ${publicationPath}`);
    return path;
  };

  return {
    async writeImmutable(publicationPath, bytes) {
      const destination = pathInRoot(publicationPath);
      await mkdir(dirname(destination), { recursive: true });
      const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temporary, bytes, { flag: 'wx' });
      try {
        try {
          await link(temporary, destination);
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          const existing = await readFile(destination);
          if (!existing.equals(bytes)) throw new Error(`Immutable publication conflict: ${publicationPath}`);
        }
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    },

    async read(publicationPath) {
      return readFile(pathInRoot(publicationPath));
    },

    async replaceLatest(publicationPath, bytes) {
      const destination = pathInRoot(publicationPath);
      await mkdir(dirname(destination), { recursive: true });
      const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temporary, bytes, { flag: 'wx' });
      try {
        await rename(temporary, destination);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    },
  };
}

const options = parseArguments(process.argv.slice(2));
const sourceManifestPath = resolve(options.source);
const sourceManifestUrl = pathToFileURL(sourceManifestPath).href;
const sourceRoot = resolve(options['source-root'] ?? dirname(sourceManifestPath));
const sourceRootPrefix = `${sourceRoot}${sep}`;

const publisher = createEarthStatePublisher({
  async loadSource(url) {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      let path = fileURLToPath(parsed);
      if (path !== sourceManifestPath && path !== sourceRoot && !path.startsWith(sourceRootPrefix)) {
        path = resolve(sourceRoot, parsed.pathname.replace(/^\/+/, ''));
      }
      const bytes = await readFile(path);
      return { bytes, mediaType: mediaTypeFor(pathToFileURL(path).href) };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported source protocol: ${parsed.protocol}`);
    const response = await fetch(parsed, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Source unavailable (${response.status}): ${url}`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mediaType: mediaTypeFor(url, response.headers.get('content-type')),
    };
  },
  store: createFilePublicationStore(resolve(options.output)),
});

const publication = await publisher.publish({
  targetTime: options['target-time'],
  sourceManifestUrl,
});
process.stdout.write(`${JSON.stringify({
  bundleId: publication.manifest.bundleId,
  latest: resolve(options.output, 'latest.json'),
  manifest: resolve(options.output, publication.manifestPath),
}, null, 2)}\n`);
