import { BasicMaterial, ColorSRGB, PbrMaterial, type Material2D } from "@haiyue/engine";
import { CssMaterial, RadialShadowMaterial, type MaterialTextureSource, type CssMaterialStyle } from "@haiyue/engine/material";
import { toColorSRGB } from "@haiyue/engine/color";
import type { Material2DResourceItem, MaterialResourceItem } from "../../types";
import { t } from "../options/editorOptions";
import {
  addDetailControl,
  addDetailRow,
  createDetailSelect,
  createNameInput,
  prepareDetailPanel,
  selectResource,
  setDetailTitle,
  type ResourceDetailDeps,
} from './ResourceDetailView';

export function showMaterialDetails(deps: ResourceDetailDeps, item: MaterialResourceItem): void {
  selectResource(deps, { selectedMaterialId: item.resource.id });
  prepareDetailPanel(deps, item.name);

  const material = item.resource;
  addDetailRow(deps, t('detail.type'), material.constructor.name);
  addDetailRow(deps, t('field.id'), material.id);
  addDetailRow(deps, t('field.name'), item.name);
  addDetailRow(deps, t('detail.materialType'), material.type);
  addDetailRow(deps, t('detail.references'), item.refs);

  if (material instanceof CssMaterial) {
    const textInput = document.createElement('textarea');
    textInput.className = 'detail-input';
    textInput.rows = 3;
    textInput.value = material.text;
    textInput.addEventListener('change', () => {
      material.setText(textInput.value);
      deps.renderResourcePool();
    });
    addDetailControl(deps, t('detail.text'), textInput);

    const styleInput = document.createElement('textarea');
    styleInput.className = 'detail-input';
    styleInput.rows = 10;
    styleInput.value = JSON.stringify(material.style, null, 2);
    styleInput.addEventListener('change', () => {
      try {
        const value = JSON.parse(styleInput.value || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        styleInput.setCustomValidity('');
        material.setStyle(value as CssMaterialStyle);
        deps.renderResourcePool();
      } catch (error) {
        styleInput.setCustomValidity(error instanceof Error ? error.message : 'Invalid JSON');
        styleInput.reportValidity();
      }
    });
    addDetailControl(deps, t('detail.styleJson'), styleInput);
  }

  if (material instanceof RadialShadowMaterial) {
    const colorInput = document.createElement('input');
    colorInput.className = 'detail-input';
    colorInput.type = 'color';
    colorInput.value = toColorSRGB(material.color).toHex();
    colorInput.addEventListener('change', () => {
      const color = ColorSRGB.fromHex(colorInput.value);
      material.color = [color.r, color.g, color.b];
      deps.renderResourcePool();
    });
    addDetailControl(deps, t('detail.color'), colorInput);

    const opacityInput = document.createElement('input');
    opacityInput.className = 'detail-input';
    opacityInput.type = 'number';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.01';
    opacityInput.value = deps.formatNumber(material.opacity);
    opacityInput.addEventListener('change', () => {
      const value = Math.max(0, Math.min(1, Number(opacityInput.value)));
      material.opacity = Number.isFinite(value) ? value : 0.28;
      deps.renderResourcePool();
    });
    addDetailControl(deps, t('detail.opacity'), opacityInput);

    const innerRadiusInput = document.createElement('input');
    innerRadiusInput.className = 'detail-input';
    innerRadiusInput.type = 'number';
    innerRadiusInput.min = '0';
    innerRadiusInput.max = '1';
    innerRadiusInput.step = '0.01';
    innerRadiusInput.value = deps.formatNumber(material.innerRadius);
    innerRadiusInput.addEventListener('change', () => {
      const value = Math.max(0, Math.min(1, Number(innerRadiusInput.value)));
      material.innerRadius = Number.isFinite(value) ? value : 0.18;
      deps.renderResourcePool();
    });
    addDetailControl(deps, t('detail.innerRadius'), innerRadiusInput);
    return;
  }

  if (material instanceof PbrMaterial) {
    const addNumber = (
      label: string,
      current: number,
      apply: (value: number) => void,
      min = 0,
      max = 1,
    ) => {
      const input = document.createElement('input');
      input.className = 'detail-input';
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = '0.01';
      input.value = deps.formatNumber(current);
      input.addEventListener('change', () => {
        const parsed = Number(input.value);
        const next = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : current;
        deps.editPbrMaterial(
          material,
          `Change PBR ${label}`,
          () => { apply(next); },
          () => { apply(current); },
        );
      });
      addDetailControl(deps, label, input);
    };
    const addTexture = (
      label: string,
      current: MaterialTextureSource,
      apply: (texture: MaterialTextureSource) => void,
    ) => {
      const currentId = current ? deps.resourcePool.findTextureByResource(current)?.id ?? null : null;
      const select = createDetailSelect(
        currentId === null ? '' : String(currentId),
        [
          { label: t('detail.noTexture'), value: '' },
          ...[...deps.resourcePool.textures.values()].map(texture => ({
            label: texture.name,
            value: String(texture.id),
          })),
        ],
        value => {
          const next = value === '' ? null : deps.resourcePool.textures.get(Number(value))?.resource ?? null;
          deps.editPbrMaterial(
            material,
            `Change PBR ${label}`,
            () => { apply(next); },
            () => { apply(current); },
          );
        },
      );
      addDetailControl(deps, label, select);
    };

    addNumber(t('detail.clearcoatFactor'), material.clearcoatFactor, value => { material.clearcoatFactor = value; });
    addNumber(t('detail.clearcoatRoughness'), material.clearcoatRoughnessFactor, value => { material.clearcoatRoughnessFactor = value; });
    addNumber(t('detail.clearcoatNormalScale'), material.clearcoatNormalScale, value => { material.clearcoatNormalScale = value; }, 0, 2);
    addTexture(t('detail.clearcoatTexture'), material.clearcoatTexture, value => { material.clearcoatTexture = value; });
    addTexture(t('detail.clearcoatRoughnessTexture'), material.clearcoatRoughnessTexture, value => { material.clearcoatRoughnessTexture = value; });
    addTexture(t('detail.clearcoatNormalTexture'), material.clearcoatNormalTexture, value => { material.clearcoatNormalTexture = value; });
    addNumber(t('detail.ior'), material.ior, value => { material.ior = value; }, 0, 10);
    addNumber(t('detail.specularFactor'), material.specularFactor, value => { material.specularFactor = value; });
    addNumber(t('detail.specularColorR'), material.specularColorFactor[0], value => {
      material.specularColorFactor = [value, material.specularColorFactor[1], material.specularColorFactor[2]];
    }, 0, 10);
    addNumber(t('detail.specularColorG'), material.specularColorFactor[1], value => {
      material.specularColorFactor = [material.specularColorFactor[0], value, material.specularColorFactor[2]];
    }, 0, 10);
    addNumber(t('detail.specularColorB'), material.specularColorFactor[2], value => {
      material.specularColorFactor = [material.specularColorFactor[0], material.specularColorFactor[1], value];
    }, 0, 10);
    addTexture(t('detail.specularTexture'), material.specularTexture, value => { material.specularTexture = value; });
    addTexture(t('detail.specularColorTexture'), material.specularColorTexture, value => { material.specularColorTexture = value; });
    addNumber(t('detail.sheenColorR'), material.sheenColorFactor[0], value => {
      material.sheenColorFactor = [value, material.sheenColorFactor[1], material.sheenColorFactor[2]];
    });
    addNumber(t('detail.sheenColorG'), material.sheenColorFactor[1], value => {
      material.sheenColorFactor = [material.sheenColorFactor[0], value, material.sheenColorFactor[2]];
    });
    addNumber(t('detail.sheenColorB'), material.sheenColorFactor[2], value => {
      material.sheenColorFactor = [material.sheenColorFactor[0], material.sheenColorFactor[1], value];
    });
    addNumber(t('detail.sheenRoughness'), material.sheenRoughnessFactor, value => { material.sheenRoughnessFactor = value; });
    addTexture(t('detail.sheenColorTexture'), material.sheenColorTexture, value => { material.sheenColorTexture = value; });
    addTexture(t('detail.sheenRoughnessTexture'), material.sheenRoughnessTexture, value => { material.sheenRoughnessTexture = value; });
    addNumber(t('detail.transmissionFactor'), material.transmissionFactor, value => { material.transmissionFactor = value; });
    addTexture(t('detail.transmissionTexture'), material.transmissionTexture, value => { material.transmissionTexture = value; });
    addNumber(t('detail.thicknessFactor'), material.thicknessFactor, value => { material.thicknessFactor = value; }, 0, 1000);
    addTexture(t('detail.thicknessTexture'), material.thicknessTexture, value => { material.thicknessTexture = value; });
    addNumber(
      t('detail.attenuationDistance'),
      Number.isFinite(material.attenuationDistance) ? material.attenuationDistance : 1_000_000,
      value => { material.attenuationDistance = value; },
      0.0001,
      1_000_000,
    );
    addNumber(t('detail.attenuationColorR'), material.attenuationColor[0], value => {
      material.attenuationColor = [value, material.attenuationColor[1], material.attenuationColor[2]];
    });
    addNumber(t('detail.attenuationColorG'), material.attenuationColor[1], value => {
      material.attenuationColor = [material.attenuationColor[0], value, material.attenuationColor[2]];
    });
    addNumber(t('detail.attenuationColorB'), material.attenuationColor[2], value => {
      material.attenuationColor = [material.attenuationColor[0], material.attenuationColor[1], value];
    });
    return;
  }

  if (!(material instanceof BasicMaterial)) {
    addDetailRow(deps, t('detail.editable'), t('detail.noMaterialEditor'));
    return;
  }

  const colorInput = document.createElement('input');
  colorInput.className = 'detail-input';
  colorInput.type = 'color';
  colorInput.value = toColorSRGB(material.color).toHex();
  colorInput.addEventListener('change', () => {
    const color = ColorSRGB.fromHex(colorInput.value);
    material.color.setFromSRGB(color.r, color.g, color.b, material.color.a);
    material.markDirty();
    deps.renderResourcePool();
  });
  addDetailControl(deps, t('detail.color'), colorInput);

  const alphaInput = document.createElement('input');
  alphaInput.className = 'detail-input';
  alphaInput.type = 'number';
  alphaInput.min = '0';
  alphaInput.max = '1';
  alphaInput.step = '0.01';
  alphaInput.value = deps.formatNumber(material.color.a);
  alphaInput.addEventListener('change', () => {
    const alpha = Math.max(0, Math.min(1, Number(alphaInput.value)));
    material.color.a = Number.isFinite(alpha) ? alpha : 1;
    deps.renderResourcePool();
  });
  addDetailControl(deps, t('detail.alpha'), alphaInput);

  const blendingSelect = document.createElement('select');
  blendingSelect.className = 'detail-select';
  for (const mode of ['none', 'normal', 'additive']) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    blendingSelect.append(option);
  }
  blendingSelect.value = material.blending;
  blendingSelect.addEventListener('change', () => {
    material.blending = blendingSelect.value as BasicMaterial['blending'];
    deps.renderResourcePool();
  });
  addDetailControl(deps, t('detail.blending'), blendingSelect);

  const currentTextureId = material.texture ? deps.resourcePool.findTextureByResource(material.texture)?.id ?? null : null;
  const textureSelect = createDetailSelect(
    currentTextureId === null ? '' : String(currentTextureId),
    [
      { label: t('detail.noTexture'), value: '' },
      ...[...deps.resourcePool.textures.values()].map(texture => ({
        label: texture.name,
        value: String(texture.id),
      })),
    ],
    value => {
      const texture = value === '' ? null : deps.resourcePool.textures.get(Number(value))?.resource ?? null;
      deps.editMaterialTexture(material, texture);
    },
  );
  addDetailControl(deps, t('detail.texture'), textureSelect);
}

export function showMaterial2DDetails(deps: ResourceDetailDeps, item: Material2DResourceItem): void {
  selectResource(deps, { selectedMaterial2DId: item.resource.id });
  prepareDetailPanel(deps, item.name);

  const material = item.resource;
  addDetailRow(deps, t('detail.type'), 'Material2D');
  addDetailRow(deps, t('field.id'), material.id);

  const nameInput = createNameInput(item.name, (name) => {
    item.name = name || `Material2D ${material.id}`;
    deps.resourceDisplayNames.set(material, item.name);
    setDetailTitle(deps, item.name);
    deps.renderResourcePool();
    return item.name;
  });
  addDetailControl(deps, t('field.name'), nameInput);

  addDetailRow(deps, t('detail.materialType'), material.type);

  const colorInput = document.createElement('input');
  colorInput.className = 'detail-input';
  colorInput.type = 'color';
  colorInput.value = toColorSRGB(material.color).toHex();
  colorInput.addEventListener('change', () => {
    const color = ColorSRGB.fromHex(colorInput.value);
    material.color.setFromSRGB(color.r, color.g, color.b, material.color.a);
    deps.renderResourcePool();
  });
  addDetailControl(deps, t('detail.color'), colorInput);

  const alphaInput = document.createElement('input');
  alphaInput.className = 'detail-input';
  alphaInput.type = 'number';
  alphaInput.min = '0';
  alphaInput.max = '1';
  alphaInput.step = '0.01';
  alphaInput.value = deps.formatNumber(material.color.a);
  alphaInput.addEventListener('change', () => {
    const alpha = Math.max(0, Math.min(1, Number(alphaInput.value)));
    material.color.a = Number.isFinite(alpha) ? alpha : 1;
    deps.renderResourcePool();
  });
  addDetailControl(deps, t('detail.alpha'), alphaInput);

  const blendingSelect = document.createElement('select');
  blendingSelect.className = 'detail-select';
  for (const mode of ['none', 'normal', 'additive']) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    blendingSelect.append(option);
  }
  blendingSelect.value = material.blending;
  blendingSelect.addEventListener('change', () => {
    material.blending = blendingSelect.value as Material2D['blending'];
    deps.renderResourcePool();
  });
  addDetailControl(deps, t('detail.blending'), blendingSelect);

  addDetailRow(deps, t('detail.references'), item.refs);
}
