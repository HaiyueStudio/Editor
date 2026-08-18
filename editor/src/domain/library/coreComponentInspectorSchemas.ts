import { ClippingPlanes, type ClippingPlane } from '@haiyue/engine/components';
import type { InspectorSchema } from '../../types';

export const clippingPlanesInspectorSchema: InspectorSchema = {
  fields: {
    planes: {
      type: 'array',
      label: 'World-space Planes',
      group: 'Clipping',
      rows: 12,
      get: component => {
        const clipping = component as ClippingPlanes;
        return Array.from({ length: clipping.count }, (_, index) => clipping.getPlane(index));
      },
      set: (component, value) => {
        (component as ClippingPlanes).setPlanes(value as ClippingPlane[]);
      },
      validate: validateClippingPlanesEditorValue,
    },
  },
};

export function validateClippingPlanesEditorValue(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Clipping planes must be an array.';
  try {
    new ClippingPlanes(value as readonly ClippingPlane[]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid clipping planes.';
  }
}
