const MEDIA_TYPE_EXTENSIONS = Object.freeze({
  'application/json': 'json',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/ktx2': 'ktx2',
});

export function earthStateExtensionForMediaType(mediaType) {
  return MEDIA_TYPE_EXTENSIONS[mediaType];
}

export function earthStateMediaTypeForPath(path) {
  const extension = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === 'jpeg') return 'image/jpeg';
  return Object.entries(MEDIA_TYPE_EXTENSIONS).find(([, candidate]) => candidate === extension)?.[0];
}
