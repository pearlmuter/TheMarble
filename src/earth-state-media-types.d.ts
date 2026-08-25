export type EarthStateMediaType = 'application/json' | 'image/jpeg' | 'image/png';

export function earthStateExtensionForMediaType(mediaType: string): string | undefined;
export function earthStateMediaTypeForPath(path: string): EarthStateMediaType | undefined;
