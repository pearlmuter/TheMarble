import type { RollingSurfaceProduct } from './rolling-surface-selection.js';

export const ROLLING_SURFACE_PRODUCTS: Readonly<Record<RollingSurfaceProduct, Readonly<{
  label: string;
  sourceCode: 1 | 2;
  priority: number;
}>>>;

export function rollingSurfaceProduct(product: string): typeof ROLLING_SURFACE_PRODUCTS[RollingSurfaceProduct] | undefined;
