import { Camera2D, Entity, Mesh3D, System, type HaiyueEngine, type World } from '@haiyue/engine';
import { Mesh2DRenderSystem, RadialShadowRenderFeature } from '@haiyue/engine/systems';
import { RadialShadowMaterial } from '@haiyue/engine/material';
import { RenderView } from '@haiyue/engine/core';
import {
  RenderIntegration,
  type RenderPipelineEntryOptions,
  type RenderPipelineSystem,
} from './EditorRenderProtocol';
import { loadConfiguredSystemRuntime } from '../infra/app/lazyContributionLoader';
import type { SerializedSystem } from '../export/runtimeScene';
import {
  bindWorldRender3DSettings,
  bindWorldRenderView,
} from '../domain/settings/globalSettings';

export interface EditorViewportAdapterOptions {
  engine: HaiyueEngine;
  world: World;
  cameraEntity: Entity;
  render3D: RenderPipelineSystem & { reverseZ: boolean };
  getSystemConfigs: () => SerializedSystem[];
}

export class EditorViewportAdapter {
  readonly renderIntegration: RenderIntegration;
  readonly renderView: RenderView;
  private readonly _configuredRenderSystems: RenderPipelineSystem[] = [];
  private _configuredSystemRevision = 0;

  constructor(private readonly _options: EditorViewportAdapterOptions) {
    this.renderView = new RenderView({
      camera: _options.cameraEntity,
      target: _options.engine.renderTarget,
      clearColor: _options.engine.clearColor,
      depthConvention: _options.engine.reverseZ ? 'reverse' : 'standard',
      sampleCount: _options.engine.msaaSamples,
    });
    this.renderIntegration = new RenderIntegration(_options.engine, {
      label: 'EditorViewportRenderPipeline',
      view: this.renderView,
    });
    _options.world.addRuntimeIntegration(this.renderIntegration);
    bindWorldRenderView(_options.world, this.renderView);
    bindWorldRender3DSettings(_options.world, _options.render3D);
    this.registerRenderSystem(_options.render3D);
  }

  registerRenderSystem(system: RenderPipelineSystem, options?: RenderPipelineEntryOptions): void {
    this.renderIntegration.register(system, options);
  }

  syncConfiguredSystems(): void {
    const revision = ++this._configuredSystemRevision;
    const { world, engine, cameraEntity } = this._options;
    for (const system of this._configuredRenderSystems) {
      this.renderIntegration.unregister(system);
      if (system instanceof System && world.hasSystem(system)) system.destroy();
    }
    this._configuredRenderSystems.length = 0;
    const systemConfigs = this._options.getSystemConfigs();
    const runtimePromise = loadConfiguredSystemRuntime(systemConfigs.length > 0);
    if (runtimePromise) {
      void runtimePromise.then(runtime => {
        if (!runtime || revision !== this._configuredSystemRevision) return;
        runtime.installConfiguredEditorSystems(world, engine, cameraEntity, systemConfigs, {
          registerRenderSystem: (system, options) => {
            if (revision !== this._configuredSystemRevision) {
              if (system instanceof System && world.hasSystem(system)) system.destroy();
              return;
            }
            this._configuredRenderSystems.push(system);
            this.registerRenderSystem(system, options);
          },
        });
      }).catch(error => {
        console.error('Failed to load configured editor system contribution.', error);
      });
    }
    if (hasRadialShadowMesh(world) && !hasConfiguredRadialShadowSystem(systemConfigs)) {
      const radialShadowFeature = new RadialShadowRenderFeature(engine, cameraEntity, { loadOp: 'load', priority: 20 });
      radialShadowFeature.autoUpdate = false;
      this._configuredRenderSystems.push(radialShadowFeature);
      world.addSystem(radialShadowFeature);
      this.registerRenderSystem(radialShadowFeature, { pass: 'shared', loadOp: 'load' });
    }
  }

  dispose(): void {
    this._configuredSystemRevision++;
    for (const system of this._configuredRenderSystems) {
      this.renderIntegration.unregister(system);
      if (system instanceof System && this._options.world.hasSystem(system)) system.destroy();
    }
    this._configuredRenderSystems.length = 0;
    bindWorldRenderView(this._options.world, null);
    bindWorldRender3DSettings(this._options.world, null);
    this._options.world.removeRuntimeIntegration(this.renderIntegration);
  }

  createMesh2DRenderSystem(cameraEntity: Entity): Mesh2DRenderSystem {
    return new Mesh2DRenderSystem(this._options.engine, cameraEntity, { priority: 2, loadOp: 'load' });
  }

  findCamera2D(entity: Entity): Camera2D | null {
    return entity.getComponent(Camera2D);
  }
}

function hasRadialShadowMesh(world: World): boolean {
  for (const entity of world.entities.values()) {
    const mesh = entity.getComponent(Mesh3D);
    if (mesh?.material instanceof RadialShadowMaterial || mesh?.material.type === 'radial-shadow') return true;
  }
  return false;
}

function hasConfiguredRadialShadowSystem(configs: SerializedSystem[]): boolean {
  return configs.some(config => !config.disabled && config.type === 'RadialShadowRenderFeature');
}
