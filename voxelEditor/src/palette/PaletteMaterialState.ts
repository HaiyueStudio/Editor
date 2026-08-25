import {
  DEFAULT_PALETTE,
  DEFAULT_PBR_METALLIC,
  DEFAULT_PBR_ROUGHNESS,
  normalizeColor,
  type PbrPaletteMaterial,
  type Voxel,
} from '../document/VoxelDocumentContract';
import { numericIdSuffix } from '../document/VoxelDocumentUtilities';
import {
  cloneVoxMaterialExtension,
  isVoxelRecord,
  normalizeVoxelUnit,
  parseVoxMaterialExtension,
} from '../document/VoxelDocumentNormalization';

/** Palette/material aggregate independent from selection, transactions and renderer state. */
export class PaletteMaterialState {
  readonly materials = new Map<string, PbrPaletteMaterial>();
  currentColor = '#69d2e7';
  currentMaterialId = 'material-5';
  nextMaterialId = 13;

  constructor() {
    this.reset();
  }

  reset(rawPalette?: readonly Partial<PbrPaletteMaterial>[]): void {
    this.materials.clear();
    this.nextMaterialId = 1;
    if (rawPalette && rawPalette.length > 0) {
      for (const rawMaterial of rawPalette) {
        const color = normalizeColor(String(rawMaterial.color));
        const id = String(rawMaterial.id || `material-${this.nextMaterialId++}`);
        this.materials.set(id, {
          id,
          color,
          name: String(rawMaterial.name || color.toUpperCase()),
          metallic: normalizeVoxelUnit(Number(rawMaterial.metallic), DEFAULT_PBR_METALLIC),
          roughness: normalizeVoxelUnit(Number(rawMaterial.roughness), DEFAULT_PBR_ROUGHNESS, 0.04),
          ...(isVoxelRecord(rawMaterial.vox) ? { vox: parseVoxMaterialExtension(rawMaterial.vox) } : {}),
        });
        this.nextMaterialId = Math.max(this.nextMaterialId, numericIdSuffix(id, 'material-') + 1);
      }
      return;
    }
    for (const material of DEFAULT_PALETTE) this.materials.set(material.id, { ...material });
    this.nextMaterialId = 13;
  }

  selectColor(value: string): boolean {
    const color = normalizeColor(value);
    const current = this.materials.get(this.currentMaterialId);
    if (current?.color === color) return false;
    const material = this.findByColor(color) ?? this.create(color);
    this.currentMaterialId = material.id;
    this.currentColor = material.color;
    return true;
  }

  select(materialId: string): boolean {
    const material = this.materials.get(materialId);
    if (!material || material.id === this.currentMaterialId) return false;
    this.currentMaterialId = material.id;
    this.currentColor = material.color;
    return true;
  }

  get(materialIdOrColor: string): PbrPaletteMaterial {
    const direct = this.materials.get(materialIdOrColor);
    if (direct) return { ...direct };
    const normalized = normalizeColor(materialIdOrColor);
    const material = this.findByColor(normalized);
    return material ? { ...material } : {
      id: '',
      color: normalized,
      name: normalized.toUpperCase(),
      metallic: DEFAULT_PBR_METALLIC,
      roughness: DEFAULT_PBR_ROUGHNESS,
    };
  }

  resolve(voxel: Pick<Voxel, 'color' | 'materialId'>): PbrPaletteMaterial {
    const byId = voxel.materialId ? this.materials.get(voxel.materialId) : null;
    return byId ? { ...byId } : this.get(voxel.color);
  }

  /** Read-only renderer hot-path view. Callers must never mutate the returned material. */
  resolveView(voxel: Pick<Voxel, 'color' | 'materialId'>): Readonly<PbrPaletteMaterial> {
    return (voxel.materialId ? this.materials.get(voxel.materialId) : null)
      ?? this.findByColor(voxel.color)
      ?? {
        id: '', color: voxel.color, name: voxel.color.toUpperCase(),
        metallic: DEFAULT_PBR_METALLIC, roughness: DEFAULT_PBR_ROUGHNESS,
      };
  }

  create(value: string, name = ''): PbrPaletteMaterial {
    const color = normalizeColor(value);
    let id = `material-${this.nextMaterialId++}`;
    while (this.materials.has(id)) id = `material-${this.nextMaterialId++}`;
    const material = {
      id,
      color,
      name: name.trim() || color.toUpperCase(),
      metallic: DEFAULT_PBR_METALLIC,
      roughness: DEFAULT_PBR_ROUGHNESS,
    };
    this.materials.set(id, material);
    return material;
  }

  update(
    materialId: string,
    patch: Partial<Pick<PbrPaletteMaterial, 'name' | 'metallic' | 'roughness'>>,
  ): boolean {
    const material = this.materials.get(materialId);
    if (!material) throw new Error('调色板材质不存在。');
    const next = {
      ...material,
      name: patch.name === undefined ? material.name : patch.name.trim() || material.name,
      metallic: patch.metallic === undefined
        ? material.metallic
        : normalizeVoxelUnit(patch.metallic, material.metallic),
      roughness: patch.roughness === undefined
        ? material.roughness
        : normalizeVoxelUnit(patch.roughness, material.roughness, 0.04),
    };
    if (next.name === material.name && next.metallic === material.metallic
      && next.roughness === material.roughness) return false;
    this.materials.set(materialId, next);
    return true;
  }

  remove(materialId: string): boolean {
    if (!this.materials.has(materialId)) return false;
    if (this.materials.size <= 1) throw new Error('调色板至少需要保留一个材质。');
    this.materials.delete(materialId);
    if (this.currentMaterialId === materialId) {
      const next = this.materials.values().next().value as PbrPaletteMaterial | undefined;
      this.currentMaterialId = next?.id ?? 'material-5';
      this.currentColor = next?.color ?? '#69d2e7';
    }
    return true;
  }

  restore(material: Readonly<PbrPaletteMaterial>): boolean {
    const color = normalizeColor(material.color);
    const restored: PbrPaletteMaterial = {
      id: String(material.id),
      color,
      name: String(material.name).trim() || color.toUpperCase(),
      metallic: normalizeVoxelUnit(material.metallic, DEFAULT_PBR_METALLIC),
      roughness: normalizeVoxelUnit(material.roughness, DEFAULT_PBR_ROUGHNESS, 0.04),
      ...(material.vox ? { vox: cloneVoxMaterialExtension(material.vox) } : {}),
    };
    const existed = this.materials.has(restored.id);
    this.materials.set(restored.id, restored);
    this.nextMaterialId = Math.max(this.nextMaterialId, numericIdSuffix(restored.id, 'material-') + 1);
    if (this.currentMaterialId === restored.id) this.currentColor = restored.color;
    return existed;
  }

  findByColor(color: string): PbrPaletteMaterial | null {
    for (const material of this.materials.values()) if (material.color === color) return material;
    return null;
  }

  resolveForWrite(color: string, preferredId?: string): PbrPaletteMaterial {
    const preferred = preferredId ? this.materials.get(preferredId) : null;
    if (preferred) return preferred;
    const normalized = normalizeColor(color);
    const current = this.materials.get(this.currentMaterialId);
    if (current?.color === normalized) return current;
    return this.findByColor(normalized) ?? this.create(normalized);
  }
}
