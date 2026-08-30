export type EarthStateMediaType = 'application/json' | 'image/jpeg' | 'image/png' | 'image/ktx2';

export function earthStateExtensionForMediaType(mediaType: string): string | undefined;
export function earthStateMediaTypeForPath(path: string): EarthStateMediaType | undefined;
