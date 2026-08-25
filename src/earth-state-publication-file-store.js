import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

export function createFilePublicationStore(rootDirectory) {
  const root = resolve(rootDirectory);
  const pathInRoot = publicationPath => {
    if (isAbsolute(publicationPath)) throw new Error(`Publication path must be relative: ${publicationPath}`);
    const path = resolve(root, publicationPath);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Publication path escapes output root: ${publicationPath}`);
    return path;
  };
  const withStagedFile = async (publicationPath, bytes, publish) => {
    const destination = pathInRoot(publicationPath);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    try {
      await publish({ destination, temporary });
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  };

  return {
    async writeImmutable(publicationPath, bytes) {
      await withStagedFile(publicationPath, bytes, async ({ destination, temporary }) => {
        try {
          await link(temporary, destination);
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          const existing = await readFile(destination);
          if (!existing.equals(bytes)) throw new Error(`Immutable publication conflict: ${publicationPath}`);
        }
      });
    },

    async read(publicationPath) {
      return readFile(pathInRoot(publicationPath));
    },

    async replaceLatest(publicationPath, bytes) {
      await withStagedFile(publicationPath, bytes, ({ destination, temporary }) => rename(temporary, destination));
    },
  };
}
