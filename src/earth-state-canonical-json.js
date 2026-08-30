const encoder = new TextEncoder();

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

export function encodeCanonicalEarthStateJson(value) {
  return encoder.encode(`${JSON.stringify(canonicalize(value), null, 2)}\n`);
}

