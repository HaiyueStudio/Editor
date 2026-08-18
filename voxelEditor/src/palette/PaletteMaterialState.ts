import type { PbrPaletteMaterial } from '../model';

/** Palette/material state independent from selection and renderer state. */
export class PaletteMaterialState {
  readonly materials = new Map<string, PbrPaletteMaterial>();
  currentColor = '#69d2e7';
  currentMaterialId = 'material-5';
  nextMaterialId = 13;
}
