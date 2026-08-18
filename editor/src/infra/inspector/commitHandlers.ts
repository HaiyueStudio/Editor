import { AmbientLight, LightComponent, PointLight } from '@haiyue/engine/lighting';
import { Camera2D, Camera3D, CartesianTransform3D, ColorSRGB, DirectionalLight, BasicMaterial, Geometry3D, Material2D, Mesh2D, Mesh3D, SphericalTransform3D, Transform2D, type Component, type Entity, type World } from '@haiyue/engine';
import { toColorSRGB, type ColorValue } from '@haiyue/engine/color';
import { DataComponent, ScriptComponent, ScriptResource } from '@haiyue/engine/components';
import { Material } from '@haiyue/engine/material';
import { CanvasTextComponent } from '@haiyue/extensions/canvas-text';
import { Tilemap2DComponent } from '@haiyue/extensions/tilemap';
import type { GECheckbox } from '@haiyue/ui';
import type { CommandBus } from '../../commands/CommandBus';
import {
  addComponentCommand,
  changeMaterialTextureCommand,
  changeMesh2DMaterialCommand,
  changeMeshGeometryCommand,
  changeMeshMaterialCommand,
  changeScriptResourceCommand,
  editCanvasTextCommand,
  editCamera2DCommand,
  editCamera3DCommand,
  editDataComponentCommand,
  editMesh2DCommand,
  editSphericalTransformCommand,
  editTilemap2DCommand,
  editTransform2DCommand,
  editTransformCommand,
  removeComponentCommand,
} from '../../commands/componentCommands';
import { renameEntityCommand } from '../../commands/entityCommands';
import type { SerializedGlobalSettings } from '../../export/runtimeScene';
import type {
  Command,
  EditorComponentDescriptor,
  GenericComponentEditorSchema,
  InspectorContext,
  SphericalTransformSnapshot,
  TextureSource,
  Transform2DSnapshot,
  TransformSnapshot,
} from '../../types';
import type { ResourcePool } from '../../resources/ResourcePool';
import {
  applyCamera2DSnapshot,
  applyCamera3DSnapshot,
  readCamera2DInputs,
  readCamera3DInputs,
  snapshotCamera2D,
  snapshotCamera3D,
} from '../../ui/inspector/cameraEditor';
import {
  applyCanvasTextSnapshot,
  applyDataComponentSnapshot,
  applyMesh2DSnapshot,
  applyTilemap2DSnapshot,
  readCanvasTextInputs,
  readDataComponentInput,
  readMesh2DInputs,
  readTilemap2DInputs,
  snapshotCanvasText,
  snapshotDataComponent,
  snapshotMesh2D,
  snapshotTilemap2D,
} from '../../ui/inspector/componentForms';
import {
  applyGenericComponentSnapshot,
  getGenericEditorSchema,
  readGenericComponentInputs,
  snapshotGenericComponent,
} from '../../ui/inspector/genericComponentEditor';
import {
  applySphericalTransformSnapshot,
  applyTransform2DSnapshot,
  applyTransformSnapshot,
  snapshotSphericalTransform,
  snapshotTransform,
  snapshotTransform2D,
} from '../../ui/inspector/transformEditor';
import { readNumber } from '../../utils/formValues';
import type { InspectorRegistry } from './InspectorRegistry';
import type { InspectorMultiTransformEditRecord } from '../../domain/store/InspectorState';

export interface InspectorCommitState {
  nameEditStartValue: string | null;
  transformEditStartValue: TransformSnapshot | null;
  multiTransformEditStartValue: InspectorMultiTransformEditRecord[] | null;
  sphericalTransformEditStartValue: SphericalTransformSnapshot | null;
  transform2DEditStartValue: Transform2DSnapshot | null;
}

export interface GlobalSettingsInputs {
  gameNameInput: HTMLInputElement | null;
  designWidthInput: HTMLInputElement | null;
  designHeightInput: HTMLInputElement | null;
  viewportModeSelect: HTMLSelectElement | null;
  clearColorInput: HTMLInputElement | null;
  clearAlphaInput: HTMLInputElement | null;
  reverseZInput: GECheckbox | null;
  render2DLoadOpSelect: HTMLSelectElement | null;
  guiLoadOpSelect: HTMLSelectElement | null;
  parametersInput: HTMLTextAreaElement | null;
}

export interface CameraCommitInputs {
  projectionSelect: HTMLSelectElement | null;
  fovInput: HTMLInputElement | null;
  nearInput: HTMLInputElement | null;
  farInput: HTMLInputElement | null;
  reverseZInput: HTMLInputElement | null;
  orthoLeftInput: HTMLInputElement | null;
  orthoRightInput: HTMLInputElement | null;
  orthoTopInput: HTMLInputElement | null;
  orthoBottomInput: HTMLInputElement | null;
  camera2DWidthInput: HTMLInputElement | null;
  camera2DHeightInput: HTMLInputElement | null;
  camera2DZoomInput: HTMLInputElement | null;
  camera2DNearInput: HTMLInputElement | null;
  camera2DFarInput: HTMLInputElement | null;
}

export interface ComponentCommitInputs {
  mesh2DColorInput: HTMLInputElement | null;
  mesh2DAlphaInput: HTMLInputElement | null;
  mesh2DBlendingSelect: HTMLSelectElement | null;
  canvasTextTextInput: HTMLTextAreaElement | null;
  canvasTextStyleInput: HTMLTextAreaElement | null;
  dataComponentInput: HTMLTextAreaElement | null;
  tilemapColumnsInput: HTMLInputElement | null;
  tilemapRowsInput: HTMLInputElement | null;
  tilemapCellWidthInput: HTMLInputElement | null;
  tilemapCellHeightInput: HTMLInputElement | null;
  tilemapGapInput: HTMLInputElement | null;
  tilemapOriginXInput: HTMLInputElement | null;
  tilemapOriginYInput: HTMLInputElement | null;
  tilemapPaletteInput: HTMLTextAreaElement | null;
  tilemapCellsInput: HTMLTextAreaElement | null;
  genericComponentFields: HTMLElement | null;
}

export interface InspectorCommitHandlersDeps {
  state: InspectorCommitState;
  getInspectorContext: () => InspectorContext | null;
  getCommandBus: () => CommandBus | null;
  getSuppressInspectorInput: () => boolean;
  getSelectedComponentName: () => string;
  setSelectedComponentName: (componentName: string) => void;
  getComponentDescriptors: () => EditorComponentDescriptor[];
  inspectorRegistry?: InspectorRegistry;
  resourcePool: ResourcePool;
  getGlobalSettings: () => SerializedGlobalSettings;
  setGlobalSettings: (settings: SerializedGlobalSettings) => void;
  cloneGlobalSettings: (settings: SerializedGlobalSettings) => SerializedGlobalSettings;
  normalizeGlobalSettings: (settings: Partial<SerializedGlobalSettings>) => SerializedGlobalSettings;
  applyGlobalSettingsToWorld: (world: World) => void;
  syncViewportClearColor: () => void;
  renderGlobalSettingsPanel: (world: World | null) => void;
  renderInspector: (entity: Entity | null, selectionCount?: number) => void;
  refreshEditorView: (entity?: Entity | null) => void;
  refreshResourcePool: (world: World) => void;
  refreshSceneTree: () => void;
  renderResourcePool: () => void;
  ensureCanvasTextMesh: (entity: Entity, component: CanvasTextComponent) => void;
  syncCanvasTextGeometry: (entity: Entity, component: CanvasTextComponent) => void;
  entityNameInput: HTMLInputElement | null;
  globalInputs: GlobalSettingsInputs;
  cameraInputs: CameraCommitInputs;
  componentInputs: ComponentCommitInputs;
}

function sameTransformSnapshot(left: TransformSnapshot, right: TransformSnapshot): boolean {
  return left.position.every((value, index) => value === right.position[index])
    && left.rotation.every((value, index) => value === right.rotation[index])
    && left.scale.every((value, index) => value === right.scale[index]);
}

function readGlobalSettingsInputs(deps: InspectorCommitHandlersDeps): SerializedGlobalSettings | null {
  const { globalInputs } = deps;
  const globalSettings = deps.getGlobalSettings();
  let parameters: Record<string, unknown> = {};
  if (globalInputs.parametersInput) {
    try {
      const value = JSON.parse(globalInputs.parametersInput.value || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Parameters must be a JSON object.');
      }
      parameters = value as Record<string, unknown>;
      globalInputs.parametersInput.setCustomValidity('');
    } catch (error) {
      globalInputs.parametersInput.setCustomValidity(error instanceof Error ? error.message : 'Invalid JSON');
      globalInputs.parametersInput.reportValidity();
      return null;
    }
  }

  const color = globalInputs.clearColorInput
    ? ColorSRGB.fromHex(globalInputs.clearColorInput.value)
    : new ColorSRGB(...globalSettings.clearColor);
  const alpha = Math.max(0, Math.min(1, readNumber(globalInputs.clearAlphaInput, globalSettings.clearColor[3])));
  return deps.normalizeGlobalSettings({
    designWidth: readNumber(globalInputs.designWidthInput, globalSettings.designWidth),
    designHeight: readNumber(globalInputs.designHeightInput, globalSettings.designHeight),
    ...(globalInputs.viewportModeSelect
      ? { viewportMode: globalInputs.viewportModeSelect.value as NonNullable<SerializedGlobalSettings['viewportMode']> }
      : {}),
    clearColor: [color.r, color.g, color.b, Number.isFinite(alpha) ? alpha : 1],
    reverseZ: globalInputs.reverseZInput?.checked ?? globalSettings.reverseZ === true,
    render2DLoadOp: globalInputs.render2DLoadOpSelect?.value === 'clear' ? 'clear' : 'load',
    guiLoadOp: globalInputs.guiLoadOpSelect?.value === 'clear' ? 'clear' : 'load',
    parameters,
    inputMap: globalSettings.inputMap,
  });
}

function restoreEntityComponents(entity: Entity, components: Component[]): void {
  for (const component of [...entity.components.values()]) {
    entity.removeComponent(component);
  }
  for (const component of components) {
    entity.addComponent(component);
  }
}

function snapshotsEqual<T>(before: T, after: T): boolean {
  return deepEqualSnapshot(before, after);
}

function deepEqualSnapshot(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (typeof before !== typeof after) return false;
  if (before === null || after === null) return false;
  if (typeof before !== 'object' || typeof after !== 'object') return false;

  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return false;
    if (before.length !== after.length) return false;
    for (let i = 0; i < before.length; i++) {
      if (!deepEqualSnapshot(before[i], after[i])) return false;
    }
    return true;
  }

  const beforeObject = before as Record<string, unknown>;
  const afterObject = after as Record<string, unknown>;
  const beforeKeys = Object.keys(beforeObject);
  const afterKeys = Object.keys(afterObject);
  if (beforeKeys.length !== afterKeys.length) return false;
  for (const key of beforeKeys) {
    if (!Object.prototype.hasOwnProperty.call(afterObject, key)) return false;
    if (!deepEqualSnapshot(beforeObject[key], afterObject[key])) return false;
  }
  return true;
}

function executeIfChanged<T>(
  deps: InspectorCommitHandlersDeps,
  before: T,
  after: T,
  command: Command,
  equals: (before: T, after: T) => boolean = snapshotsEqual,
): boolean {
  if (equals(before, after)) return false;
  deps.getCommandBus()?.execute(command);
  return true;
}

function resolveGenericAssetRefValue(
  deps: InspectorCommitHandlersDeps,
  assetType: string | undefined,
  value: unknown,
): unknown {
  if (!assetType || (value && typeof value === 'object')) return value;
  const text = String(value ?? '').trim();
  const id = Number(text);
  switch (assetType.toLowerCase()) {
  case 'geometry':
  case 'geometry3d':
    return Number.isFinite(id) ? deps.resourcePool.geometries.get(id)?.resource ?? value : value;
  case 'geometry2d':
    return Number.isFinite(id) ? deps.resourcePool.geometries2D.get(id)?.resource ?? value : value;
  case 'material':
  case 'material3d':
    return Number.isFinite(id) ? deps.resourcePool.materials.get(id)?.resource ?? value : value;
  case 'material2d':
    return Number.isFinite(id) ? deps.resourcePool.materials2D.get(id)?.resource ?? value : value;
  case 'texture':
    return Number.isFinite(id) ? deps.resourcePool.textures.get(id)?.resource ?? value : value;
  case 'script':
    if (!text) return null;
    return Number.isFinite(id) ? deps.resourcePool.scripts.get(id)?.resource ?? null : value;
  case 'model':
  case 'gltf':
    return Number.isFinite(id) ? deps.resourcePool.models.get(id)?.src ?? value : value;
  default:
    return value;
  }
}

function resolveGenericAssetRefs(
  deps: InspectorCommitHandlersDeps,
  schema: GenericComponentEditorSchema,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  let resolved: Record<string, unknown> | null = null;
  for (const [fieldName, field] of Object.entries(schema.fields)) {
    if (field.type !== 'asset-ref') continue;
    const value = resolveGenericAssetRefValue(deps, field.assetType, snapshot[fieldName]);
    if (value === snapshot[fieldName]) continue;
    resolved ??= { ...snapshot };
    resolved[fieldName] = value;
  }
  return resolved ?? snapshot;
}

function isLightType(value: unknown): value is 'ambient' | 'directional' | 'point' {
  return value === 'ambient' || value === 'directional' || value === 'point';
}

function colorFromSnapshot(value: unknown, fallback: ColorValue): ColorSRGB {
  if (value instanceof ColorSRGB) return value.clone();
  if (Array.isArray(value)) return new ColorSRGB(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0, Number(value[3] ?? 1));
  return toColorSRGB(fallback);
}

function vector3FromSnapshot(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value)) return [...fallback];
  return [
    Number.isFinite(Number(value[0])) ? Number(value[0]) : fallback[0],
    Number.isFinite(Number(value[1])) ? Number(value[1]) : fallback[1],
    Number.isFinite(Number(value[2])) ? Number(value[2]) : fallback[2],
  ];
}

function createLightFromGenericSnapshot(
  type: 'ambient' | 'directional' | 'point',
  snapshot: Record<string, unknown>,
  fallback: LightComponent,
): LightComponent {
  const color = colorFromSnapshot(snapshot.color, fallback.color);
  const intensity = Number.isFinite(Number(snapshot.intensity)) ? Number(snapshot.intensity) : fallback.intensity;
  if (type === 'ambient') return new AmbientLight({ color, intensity });
  if (type === 'directional') {
    const fallbackDirection = fallback instanceof DirectionalLight ? fallback.direction : [0, -1, 0] as [number, number, number];
    return new DirectionalLight({
      color,
      intensity,
      direction: vector3FromSnapshot(snapshot.direction, fallbackDirection),
    });
  }
  return new PointLight({
    color,
    intensity,
    range: Number.isFinite(Number(snapshot.range)) ? Number(snapshot.range) : fallback instanceof PointLight ? fallback.range : 10,
  });
}

function replaceLightComponent(entity: Entity, next: LightComponent): void {
  const current = entity.getComponent(LightComponent);
  if (current) entity.removeComponent(current);
  entity.addComponent(next);
}

export function createInspectorCommitHandlers(deps: InspectorCommitHandlersDeps) {
  const getSelectionCount = (): number => deps.getInspectorContext()?.getSelection().size ?? 0;
  const refreshResourcesAndInspector = (entity: Entity): void => {
    const world = deps.getInspectorContext()?.world;
    if (world) deps.refreshResourcePool(world);
    deps.renderInspector(entity, getSelectionCount());
  };

  return {
    commitGlobalSettingsEdit(): void {
      const world = deps.getInspectorContext()?.world;
      if (!world) return;
      const nextName = deps.globalInputs.gameNameInput?.value.trim() || 'Scene';
      const nextSettings = readGlobalSettingsInputs(deps);
      if (!nextSettings) return;
      const previousName = world.name;
      const previousSettings = deps.cloneGlobalSettings(deps.getGlobalSettings());
      executeIfChanged(deps, { name: previousName, settings: previousSettings }, { name: nextName, settings: nextSettings }, {
        label: 'Edit Global Settings',
        execute: () => {
          world.name = nextName;
          deps.setGlobalSettings(deps.cloneGlobalSettings(nextSettings));
          deps.applyGlobalSettingsToWorld(world);
          deps.syncViewportClearColor();
          deps.renderGlobalSettingsPanel(world);
        },
        undo: () => {
          world.name = previousName;
          deps.setGlobalSettings(deps.cloneGlobalSettings(previousSettings));
          deps.applyGlobalSettingsToWorld(world);
          deps.syncViewportClearColor();
          deps.renderGlobalSettingsPanel(world);
        },
      });
    },

    commitTransform2DEdit(): void {
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const transform = entity?.getComponent(Transform2D);
      if (!entity || !transform || !deps.state.transform2DEditStartValue) return;
      const before = deps.state.transform2DEditStartValue;
      const after = snapshotTransform2D(transform);
      deps.state.transform2DEditStartValue = null;
      executeIfChanged(deps, before, after, editTransform2DCommand({
        entity,
        before,
        after,
        apply: snapshot => applyTransform2DSnapshot(transform, snapshot),
        onChange: deps.refreshEditorView,
      }));
    },

    commitNameEdit(): void {
      const entity = deps.getInspectorContext()?.getActiveEntity();
      if (!entity || !deps.entityNameInput) return;
      const oldName = deps.state.nameEditStartValue ?? entity.name;
      const nextName = deps.entityNameInput.value.trim();
      const newName = nextName || 'Untitled Entity';
      deps.state.nameEditStartValue = null;
      if (oldName === newName) {
        deps.entityNameInput.value = entity.name;
        return;
      }
      deps.getCommandBus()?.execute(renameEntityCommand(entity, oldName, newName, deps.refreshEditorView));
    },

    commitTransformEdit(): void {
      const multi = deps.state.multiTransformEditStartValue;
      if (multi) {
        deps.state.multiTransformEditStartValue = null;
        deps.state.transformEditStartValue = null;
        const records = multi.map(record => ({ ...record, after: snapshotTransform(record.transform) }));
        if (!records.some(record => !sameTransformSnapshot(record.before, record.after))) return;
        const active = deps.getInspectorContext()?.getActiveEntity() ?? records[0]?.entity ?? null;
        const apply = (side: 'before' | 'after') => {
          for (const record of records) applyTransformSnapshot(record.transform, record[side]);
          if (active) deps.refreshEditorView(active);
        };
        const command = {
          label: `Edit ${records.length} Transforms`,
          execute: () => apply('after'),
          undo: () => apply('before'),
        };
        const commandBus = deps.getCommandBus();
        if (commandBus) commandBus.execute(command);
        else command.execute();
        return;
      }
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const transform = entity?.getComponent(CartesianTransform3D);
      if (!entity || !transform || !deps.state.transformEditStartValue) return;

      const before = deps.state.transformEditStartValue;
      const after = snapshotTransform(transform);
      deps.state.transformEditStartValue = null;
      executeIfChanged(deps, before, after, editTransformCommand({
        entity,
        before,
        after,
        apply: snapshot => applyTransformSnapshot(transform, snapshot),
        onChange: deps.refreshEditorView,
      }), sameTransformSnapshot);
    },

    commitSphericalTransformEdit(): void {
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const transform = entity?.getComponent(SphericalTransform3D);
      if (!entity || !transform || !deps.state.sphericalTransformEditStartValue) return;

      const before = deps.state.sphericalTransformEditStartValue;
      const after = snapshotSphericalTransform(transform);
      deps.state.sphericalTransformEditStartValue = null;
      executeIfChanged(deps, before, after, editSphericalTransformCommand({
        entity,
        before,
        after,
        apply: snapshot => applySphericalTransformSnapshot(transform, snapshot),
        onChange: deps.refreshEditorView,
      }), (left, right) => (
        left.radius === right.radius &&
        left.theta === right.theta &&
        left.phi === right.phi &&
        left.target.every((value, index) => value === right.target[index])
      ));
    },

    commitCameraEdit(): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      if (!entity) return;

      const selectedComponentName = deps.getSelectedComponentName();
      const camera3D = entity.getComponent(Camera3D);
      if (camera3D && selectedComponentName === 'Camera3D') {
        const before = snapshotCamera3D(camera3D);
        const after = readCamera3DInputs(camera3D, {
          projectionSelect: deps.cameraInputs.projectionSelect,
          fovInput: deps.cameraInputs.fovInput,
          nearInput: deps.cameraInputs.nearInput,
          farInput: deps.cameraInputs.farInput,
          reverseZInput: deps.cameraInputs.reverseZInput,
          orthoLeftInput: deps.cameraInputs.orthoLeftInput,
          orthoRightInput: deps.cameraInputs.orthoRightInput,
          orthoTopInput: deps.cameraInputs.orthoTopInput,
          orthoBottomInput: deps.cameraInputs.orthoBottomInput,
        });
        executeIfChanged(deps, before, after, editCamera3DCommand({
          entity,
          before,
          after,
          apply: snapshot => applyCamera3DSnapshot(camera3D, snapshot),
          onChange: changedEntity => deps.renderInspector(changedEntity, getSelectionCount()),
        }));
        return;
      }

      const camera2D = entity.getComponent(Camera2D);
      if (camera2D && selectedComponentName === 'Camera2D') {
        const before = snapshotCamera2D(camera2D);
        const after = readCamera2DInputs(camera2D, {
          widthInput: deps.cameraInputs.camera2DWidthInput,
          heightInput: deps.cameraInputs.camera2DHeightInput,
          zoomInput: deps.cameraInputs.camera2DZoomInput,
          nearInput: deps.cameraInputs.camera2DNearInput,
          farInput: deps.cameraInputs.camera2DFarInput,
        });
        executeIfChanged(deps, before, after, editCamera2DCommand({
          entity,
          before,
          after,
          apply: snapshot => applyCamera2DSnapshot(camera2D, snapshot),
          onChange: changedEntity => deps.renderInspector(changedEntity, getSelectionCount()),
        }));
      }
    },

    addComponentToActiveEntity(componentName: string): void {
      const context = deps.getInspectorContext();
      const entity = context?.getActiveEntity();
      const descriptor = deps.getComponentDescriptors().find(item => item.name === componentName);
      if (!context || !entity || !descriptor) return;
      const component = descriptor.create();
      if (!component) return;
      const beforeComponents = [...entity.components.values()];

      deps.getCommandBus()?.execute(addComponentCommand({
        entity,
        component,
        beforeComponents,
        add: () => {
          entity.addComponent(component);
          if (component instanceof CanvasTextComponent) deps.ensureCanvasTextMesh(entity, component);
        },
        restore: components => restoreEntityComponents(entity, components),
        onExecute: (_entity, addedComponent) => {
          deps.setSelectedComponentName(addedComponent.constructor.name);
          deps.refreshResourcePool(context.world);
          deps.renderInspector(_entity, context.getSelection().size);
        },
        onUndo: (_entity, components) => {
          deps.setSelectedComponentName(components[0]?.constructor.name ?? '');
          deps.refreshResourcePool(context.world);
          deps.renderInspector(_entity, context.getSelection().size);
        },
      }));
    },

    removeSelectedComponentFromActiveEntity(): void {
      const context = deps.getInspectorContext();
      const entity = context?.getActiveEntity();
      const selectedComponentName = deps.getSelectedComponentName();
      if (!context || !entity || !selectedComponentName) return;
      const component = [...entity.components.values()]
        .find(item => item.constructor.name === selectedComponentName);
      if (!component) return;

      const beforeComponents = [...entity.components.values()];
      const nextComponentName = beforeComponents
        .filter(item => item !== component)[0]?.constructor.name ?? '';

      deps.getCommandBus()?.execute(removeComponentCommand({
        entity,
        component,
        beforeComponents,
        remove: () => entity.removeComponent(component),
        restore: components => restoreEntityComponents(entity, components),
        onExecute: (_entity) => {
          deps.setSelectedComponentName(nextComponentName);
          deps.refreshResourcePool(context.world);
          deps.refreshSceneTree();
          deps.renderInspector(_entity, context.getSelection().size);
        },
        onUndo: (_entity, removedComponent) => {
          deps.setSelectedComponentName(removedComponent.constructor.name);
          deps.refreshResourcePool(context.world);
          deps.refreshSceneTree();
          deps.renderInspector(_entity, context.getSelection().size);
        },
      }));
    },

    commitGenericComponentEdit(): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const selectedComponentName = deps.getSelectedComponentName();
      if (!entity || !selectedComponentName) return;
      const component = Array.from(entity.components.values()).find((item: Component) => item.constructor.name === selectedComponentName);
      if (!component) return;
      const schema = deps.inspectorRegistry?.resolveSchema(component) ?? getGenericEditorSchema(component);
      if (!schema) return;
      const before = snapshotGenericComponent(component, schema);
      const after = readGenericComponentInputs(component, schema, deps.componentInputs.genericComponentFields);
      if (!after) return;
      if (component instanceof LightComponent && isLightType(after.lightType) && after.lightType !== component.lightType) {
        const beforeComponents = [...entity.components.values()];
        const nextLight = createLightFromGenericSnapshot(after.lightType, after, component);
        executeIfChanged(deps, before, after, {
          label: `Change Light Type`,
          execute: () => {
            replaceLightComponent(entity, nextLight);
            deps.renderInspector(entity, getSelectionCount());
          },
          undo: () => {
            restoreEntityComponents(entity, beforeComponents);
            deps.renderInspector(entity, getSelectionCount());
          },
        });
        return;
      }
      executeIfChanged(deps, before, after, {
        label: `Edit ${component.constructor.name}`,
        execute: () => {
          applyGenericComponentSnapshot(component, resolveGenericAssetRefs(deps, schema, after), schema);
          deps.renderInspector(entity, getSelectionCount());
        },
        undo: () => {
          applyGenericComponentSnapshot(component, resolveGenericAssetRefs(deps, schema, before), schema);
          deps.renderInspector(entity, getSelectionCount());
        },
      });
    },

    commitMesh2DEdit(): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const mesh = entity?.getComponent(Mesh2D);
      if (!entity || !mesh) return;
      const before = snapshotMesh2D(mesh);
      const after = readMesh2DInputs(mesh, {
        colorInput: deps.componentInputs.mesh2DColorInput,
        alphaInput: deps.componentInputs.mesh2DAlphaInput,
        blendingSelect: deps.componentInputs.mesh2DBlendingSelect,
      });
      executeIfChanged(deps, before, after, editMesh2DCommand({
        entity,
        before,
        after,
        apply: snapshot => applyMesh2DSnapshot(mesh, snapshot),
        onChange: changedEntity => {
          deps.renderResourcePool();
          deps.renderInspector(changedEntity, getSelectionCount());
        },
      }), (left, right) => {
        const leftColor = toColorSRGB(left.color);
        const rightColor = toColorSRGB(right.color);
        return leftColor.r === rightColor.r &&
          leftColor.g === rightColor.g &&
          leftColor.b === rightColor.b &&
          leftColor.a === rightColor.a &&
          left.blending === right.blending;
      });
    },

    commitCanvasTextEdit(): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const component = entity?.getComponent(CanvasTextComponent);
      if (!entity || !component) return;
      const before = snapshotCanvasText(component);
      const after = readCanvasTextInputs(component, {
        textInput: deps.componentInputs.canvasTextTextInput,
        styleInput: deps.componentInputs.canvasTextStyleInput,
      });
      if (!after) return;
      executeIfChanged(deps, before, after, editCanvasTextCommand({
        entity,
        before,
        after,
        apply: snapshot => {
          applyCanvasTextSnapshot(component, snapshot);
          deps.syncCanvasTextGeometry(entity, component);
        },
        onChange: changedEntity => {
          const world = deps.getInspectorContext()?.world;
          if (world) deps.refreshResourcePool(world);
          deps.renderInspector(changedEntity, getSelectionCount());
          deps.renderResourcePool();
        },
      }), (left, right) => left.text === right.text && snapshotsEqual(left.style, right.style));
    },

    commitDataComponentEdit(): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const component = entity?.getComponent(DataComponent);
      if (!entity || !component) return;
      const before = snapshotDataComponent(component);
      const after = readDataComponentInput(component, { input: deps.componentInputs.dataComponentInput });
      if (!after) return;
      executeIfChanged(deps, before, after, editDataComponentCommand({
        entity,
        before,
        after,
        apply: snapshot => applyDataComponentSnapshot(component, snapshot),
        onChange: changedEntity => deps.renderInspector(changedEntity, getSelectionCount()),
      }));
    },

    commitTilemap2DEdit(): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const tilemap = entity?.getComponent(Tilemap2DComponent);
      if (!entity || !tilemap) return;
      const before = snapshotTilemap2D(tilemap);
      const after = readTilemap2DInputs(tilemap, {
        columnsInput: deps.componentInputs.tilemapColumnsInput,
        rowsInput: deps.componentInputs.tilemapRowsInput,
        cellWidthInput: deps.componentInputs.tilemapCellWidthInput,
        cellHeightInput: deps.componentInputs.tilemapCellHeightInput,
        gapInput: deps.componentInputs.tilemapGapInput,
        originXInput: deps.componentInputs.tilemapOriginXInput,
        originYInput: deps.componentInputs.tilemapOriginYInput,
        paletteInput: deps.componentInputs.tilemapPaletteInput,
        cellsInput: deps.componentInputs.tilemapCellsInput,
      });
      if (!after) return;
      executeIfChanged(deps, before, after, editTilemap2DCommand({
        entity,
        before,
        after,
        apply: snapshot => applyTilemap2DSnapshot(tilemap, snapshot),
        onChange: changedEntity => deps.renderInspector(changedEntity, getSelectionCount()),
      }));
    },

    changeMeshGeometry(entity: Entity, nextGeometry: Geometry3D): boolean {
      const mesh = entity.getComponent(Mesh3D);
      if (!mesh || mesh.geometry === nextGeometry) return false;
      const previousGeometry = mesh.geometry;
      deps.getCommandBus()?.execute(changeMeshGeometryCommand({
        entity,
        before: previousGeometry,
        after: nextGeometry,
        apply: geometry => { mesh.geometry = geometry; },
        onChange: refreshResourcesAndInspector,
      }));
      return true;
    },

    applyMeshGeometrySelection(nextGeometryId: string): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const nextGeometry = deps.resourcePool.geometries.get(Number(nextGeometryId))?.resource;
      if (!entity || !nextGeometry) return;
      this.changeMeshGeometry(entity, nextGeometry);
    },

    changeMeshMaterial(entity: Entity, nextMaterial: Material): boolean {
      const mesh = entity.getComponent(Mesh3D);
      if (!mesh || mesh.material === nextMaterial) return false;
      const previousMaterial = mesh.material;
      deps.getCommandBus()?.execute(changeMeshMaterialCommand({
        entity,
        before: previousMaterial,
        after: nextMaterial,
        apply: material => { mesh.material = material; },
        onChange: refreshResourcesAndInspector,
      }));
      return true;
    },

    applyMeshMaterialSelection(nextMaterialId: string): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const nextMaterial = deps.resourcePool.materials.get(Number(nextMaterialId))?.resource;
      if (!entity || !nextMaterial) return;
      this.changeMeshMaterial(entity, nextMaterial);
    },

    changeMesh2DMaterial(entity: Entity, nextMaterial: Material2D): boolean {
      const mesh = entity.getComponent(Mesh2D);
      if (!mesh || mesh.material === nextMaterial) return false;
      const previousMaterial = mesh.material;
      deps.getCommandBus()?.execute(changeMesh2DMaterialCommand({
        entity,
        before: previousMaterial,
        after: nextMaterial,
        apply: material => { mesh.material = material; },
        onChange: refreshResourcesAndInspector,
      }));
      return true;
    },

    applyMesh2DMaterialSelection(nextMaterialId: string): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      const nextMaterial = deps.resourcePool.materials2D.get(Number(nextMaterialId))?.resource;
      if (!entity || !nextMaterial) return;
      this.changeMesh2DMaterial(entity, nextMaterial);
    },

    changeMaterialTexture(entity: Entity, texture: TextureSource): boolean {
      const material = entity.getComponent(Mesh3D)?.material;
      if (!(material instanceof BasicMaterial) || material.texture === texture) return false;
      const previousTexture = material.texture;
      deps.getCommandBus()?.execute(changeMaterialTextureCommand({
        entity,
        before: previousTexture,
        after: texture,
        apply: value => { material.texture = value; },
        onChange: refreshResourcesAndInspector,
      }));
      return true;
    },

    changeScriptComponentResource(entity: Entity, nextResource: ScriptResource | null): boolean {
      const script = entity.getComponent(ScriptComponent);
      if (!script || script.resource === nextResource) return false;
      const previousResource = script.resource;
      deps.getCommandBus()?.execute(changeScriptResourceCommand({
        entity,
        before: previousResource,
        after: nextResource,
        apply: resource => { script.resource = resource; },
        onChange: refreshResourcesAndInspector,
      }));
      return true;
    },

    applyScriptResourceSelection(nextScriptId: string): void {
      if (deps.getSuppressInspectorInput()) return;
      const entity = deps.getInspectorContext()?.getActiveEntity();
      if (!entity) return;
      const nextResource = nextScriptId ? deps.resourcePool.scripts.get(Number(nextScriptId))?.resource ?? null : null;
      this.changeScriptComponentResource(entity, nextResource);
    },
  };
}
