const smoothstep = (value, edge0, edge1) => {
  const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
};

export function cloudAlpha(red, green, blue) {
  const high = Math.max(red, green, blue) / 255;
  const low = Math.min(red, green, blue) / 255;
  const chroma = high - low;
  const bright = smoothstep(high, .48, .92);
  const neutral = 1 - smoothstep(chroma, .08, .28);
  // Satellite gaps are black. They must stay completely transparent, never darken Earth.
  const observed = smoothstep(high, .018, .06);
  return Math.round(255 * bright * neutral * observed);
}

export function createCloudAlphaMask(rgba) {
  const mask = new Uint8Array(rgba.length);
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = cloudAlpha(rgba[index], rgba[index + 1], rgba[index + 2]);
    // Three.js alpha maps read the green channel. Write the mask into all channels
    // to keep it portable across WebGL implementations.
    mask[index] = alpha;
    mask[index + 1] = alpha;
    mask[index + 2] = alpha;
    mask[index + 3] = 255;
  }
  return mask;
}
