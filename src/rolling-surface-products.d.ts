export type RollingSurfaceProduct = 'mcd43a4-nbar' | 'viirs-surface-reflectance';

export const ROLLING_SURFACE_PRODUCTS: Readonly<Record<RollingSurfaceProduct, Readonly<{
  label: string;
  sourceCode: 1 | 2;
  priority: number;
}>>>;

export function rollingSurfaceProduct(product: string): typeof ROLLING_SURFACE_PRODUCTS[RollingSurfaceProduct] | undefined;
export function isRollingSurfaceProduct(product: string): product is RollingSurfaceProduct;
