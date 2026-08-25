const decoder = new TextDecoder();

export async function earthStateSha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseEarthStateJson(bytes, malformedMessage) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error(malformedMessage);
  }
}
