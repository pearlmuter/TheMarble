function directoryUrl(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

/**
 * Makes every inherited asset independent of the location of a derived manifest.
 * Public-root references retain browser semantics; relative references remain
 * anchored to the manifest that originally declared them.
 */
export function rebaseEarthStateSourceAssets(manifest, { sourceManifestUrl, publicRootUrl }) {
  const publicRoot = directoryUrl(publicRootUrl);
  const sourceUrls = new Set();

  function resolveHref(href) {
    const resolved = href.startsWith('/')
      ? new URL(href.slice(1), publicRoot).href
      : new URL(href, sourceManifestUrl).href;
    sourceUrls.add(resolved);
    return resolved;
  }

  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key === 'asset' && child && typeof child === 'object' && typeof child.href === 'string') {
        return [key, { ...child, href: resolveHref(child.href) }];
      }
      return [key, visit(child)];
    }));
  }

  return { manifest: visit(manifest), sourceUrls };
}
