export function resolveEarthStatePublishedManifestPath(outputDirectory: string): Promise<string | undefined>;

export function resolveEarthStateBaseManifest(options: {
  explicitPath?: string;
  outputDirectory: string;
  fallbackPath: string;
}): Promise<string>;
