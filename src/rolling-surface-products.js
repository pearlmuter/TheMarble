export const ROLLING_SURFACE_PRODUCTS = Object.freeze({
  'mcd43a4-nbar': Object.freeze({ label: 'MCD43A4', sourceCode: 1, priority: 2 }),
  'viirs-surface-reflectance': Object.freeze({ label: 'VIIRS', sourceCode: 2, priority: 1 }),
});

export function rollingSurfaceProduct(product) {
  return ROLLING_SURFACE_PRODUCTS[product];
}
