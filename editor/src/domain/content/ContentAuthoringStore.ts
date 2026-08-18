import {
  ANIMATION_AUTHORING_FORMAT,
  createAnimationAuthoringDocument,
  parseAnimationAuthoringDocument,
  type AnimationAuthoringDocument,
} from './AnimationAuthoring';
import type { MaterialGraphDocumentV1 } from './MaterialGraphAuthoring';

export const CONTENT_AUTHORING_BUNDLE_FORMAT = 'haiyue-editor-content@1' as const;
export const HYA_AUTHORING_ASSET_FORMAT = 'haiyue-editor-hya@1' as const;

export interface HyaAnimationAssetMetadata {
  readonly source: 'json' | 'binary';
  readonly duration: number;
  readonly frameRate?: number;
  readonly endBehavior: 'hold' | 'loop' | 'destroy';
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly nodeCount: number;
  readonly trackCount: number;
  readonly resourceCount: number;
  readonly extensionsUsed: readonly string[];
  readonly hasStateMachine: boolean;
}

/** Editor-owned HYA source. Original bytes are retained so save/open is lossless. */
export interface HyaAnimationAsset {
  readonly format: typeof HYA_AUTHORING_ASSET_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly mimeType: 'application/vnd.haiyue.animation';
  readonly byteLength: number;
  readonly encoding: 'base64';
  readonly data: string;
  readonly metadata: HyaAnimationAssetMetadata;
}

export interface MaterialGraphAuthoringAsset {
  readonly id: string;
  readonly name: string;
  readonly graph: MaterialGraphDocumentV1;
}

export interface ContentAuthoringBundle {
  readonly format: typeof CONTENT_AUTHORING_BUNDLE_FORMAT;
  readonly animations: readonly AnimationAuthoringDocument[];
  readonly materialGraphs: readonly MaterialGraphAuthoringAsset[];
  /** Optional for backward compatibility with editor scenes written before HYA import support. */
  readonly hyaAnimations?: readonly HyaAnimationAsset[];
}

export function parseContentAuthoringBundle(value: unknown): ContentAuthoringBundle {
  if (!value || typeof value !== 'object') throw new TypeError('Editor content bundle must be an object.');
  const bundle = value as ContentAuthoringBundle;
  if (bundle.format !== CONTENT_AUTHORING_BUNDLE_FORMAT) throw new TypeError(`Unsupported editor content bundle ${String(bundle.format)}.`);
  if (!Array.isArray(bundle.animations) || !Array.isArray(bundle.materialGraphs)) throw new TypeError('Editor content bundle lists must be arrays.');
  const animationIds = new Set<string>();
  const materialIds = new Set<string>();
  const hyaIds = new Set<string>();
  if (bundle.hyaAnimations !== undefined && !Array.isArray(bundle.hyaAnimations)) {
    throw new TypeError('Editor content bundle hyaAnimations must be an array.');
  }
  const hyaAnimations = (bundle.hyaAnimations ?? []).map(asset => {
    const parsed = parseHyaAnimationAsset(asset);
    if (hyaIds.has(parsed.id)) throw new TypeError(`Duplicate HYA animation id ${parsed.id}.`);
    hyaIds.add(parsed.id);
    return parsed;
  });
  const animations = bundle.animations.map(animation => {
    const parsed = parseAnimationAuthoringDocument(animation);
    if (parsed.format !== ANIMATION_AUTHORING_FORMAT || animationIds.has(parsed.id)) throw new TypeError(`Duplicate animation authoring id ${parsed.id}.`);
    for (const source of parsed.sources) {
      if (source.assetId !== undefined && !hyaIds.has(source.assetId)) {
        throw new TypeError(`Animation ${parsed.id} references missing HYA asset ${source.assetId}.`);
      }
    }
    animationIds.add(parsed.id);
    return parsed;
  });
  const materialGraphs = bundle.materialGraphs.map(asset => {
    const parsed = parseMaterialGraphAsset(asset);
    if (materialIds.has(parsed.id)) throw new TypeError(`Duplicate Material Graph id ${parsed.id}.`);
    materialIds.add(parsed.id);
    return parsed;
  });
  return Object.freeze({
    format: CONTENT_AUTHORING_BUNDLE_FORMAT,
    animations: Object.freeze(animations),
    materialGraphs: Object.freeze(materialGraphs),
    hyaAnimations: Object.freeze(hyaAnimations),
  });
}

export class ContentAuthoringStore {
  private readonly _animations = new Map<string, AnimationAuthoringDocument>();
  private readonly _materialGraphs = new Map<string, MaterialGraphAuthoringAsset>();
  private readonly _hyaAnimations = new Map<string, HyaAnimationAsset>();
  private readonly _listeners = new Set<() => void>();

  get animations(): readonly AnimationAuthoringDocument[] { return Object.freeze([...this._animations.values()]); }
  get materialGraphs(): readonly MaterialGraphAuthoringAsset[] { return Object.freeze([...this._materialGraphs.values()]); }
  get hyaAnimations(): readonly HyaAnimationAsset[] { return Object.freeze([...this._hyaAnimations.values()]); }

  setAnimation(asset: AnimationAuthoringDocument): void {
    const parsed = parseAnimationAuthoringDocument(asset);
    this._animations.set(parsed.id, parsed);
    this._notify();
  }

  createAnimation(): AnimationAuthoringDocument {
    let index = this._animations.size + 1;
    while (this._animations.has(`animation-${index}`)) index++;
    const asset = createAnimationAuthoringDocument({ id: `animation-${index}`, name: `Animation ${index}` });
    this._animations.set(asset.id, asset);
    this._notify();
    return asset;
  }

  setMaterialGraph(asset: MaterialGraphAuthoringAsset): void {
    this._materialGraphs.set(asset.id, parseMaterialGraphAsset(asset));
    this._notify();
  }

  setHyaAnimation(asset: HyaAnimationAsset): void {
    const parsed = parseHyaAnimationAsset(asset);
    this._hyaAnimations.set(parsed.id, parsed);
    this._notify();
  }

  remove(kind: 'animation' | 'material-graph' | 'hya-animation', id: string): boolean {
    if (kind === 'hya-animation' && this.animations.some(animation => animation.sources.some(source => source.assetId === id))) return false;
    const removed = kind === 'animation'
      ? this._animations.delete(id)
      : kind === 'material-graph'
        ? this._materialGraphs.delete(id)
        : this._hyaAnimations.delete(id);
    if (removed) this._notify();
    return removed;
  }

  clear(): void {
    if (this._animations.size === 0 && this._materialGraphs.size === 0 && this._hyaAnimations.size === 0) return;
    this._animations.clear();
    this._materialGraphs.clear();
    this._hyaAnimations.clear();
    this._notify();
  }

  snapshot(): ContentAuthoringBundle {
    return Object.freeze({
      format: CONTENT_AUTHORING_BUNDLE_FORMAT,
      animations: Object.freeze(this.animations.map(asset => structuredClone(asset))),
      materialGraphs: Object.freeze(this.materialGraphs.map(asset => structuredClone(asset))),
      hyaAnimations: Object.freeze(this.hyaAnimations.map(asset => structuredClone(asset))),
    });
  }

  load(value: ContentAuthoringBundle | undefined): void {
    const parsed = value === undefined ? undefined : parseContentAuthoringBundle(value);
    this._animations.clear();
    this._materialGraphs.clear();
    this._hyaAnimations.clear();
    for (const asset of parsed?.animations ?? []) this._animations.set(asset.id, asset);
    for (const asset of parsed?.materialGraphs ?? []) this._materialGraphs.set(asset.id, asset);
    for (const asset of parsed?.hyaAnimations ?? []) this._hyaAnimations.set(asset.id, asset);
    this._notify();
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    for (const listener of this._listeners) listener();
  }
}

function parseHyaAnimationAsset(asset: HyaAnimationAsset): HyaAnimationAsset {
  if (!asset || typeof asset !== 'object' || asset.format !== HYA_AUTHORING_ASSET_FORMAT) {
    throw new TypeError('HYA editor asset must use haiyue-editor-hya@1.');
  }
  if (!asset.id?.trim() || !asset.name?.trim() || !asset.fileName?.trim()) {
    throw new TypeError('HYA editor asset id, name and fileName must not be empty.');
  }
  if (asset.mimeType !== 'application/vnd.haiyue.animation' || asset.encoding !== 'base64') {
    throw new TypeError(`HYA editor asset ${asset.id} has an unsupported payload encoding.`);
  }
  if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || decodedBase64Length(asset.data) !== asset.byteLength) {
    throw new TypeError(`HYA editor asset ${asset.id} byteLength does not match its base64 payload.`);
  }
  const metadata = asset.metadata;
  if (!metadata || !Number.isFinite(metadata.duration) || metadata.duration <= 0
    || (metadata.source !== 'json' && metadata.source !== 'binary')
    || !['hold', 'loop', 'destroy'].includes(metadata.endBehavior)
    || (metadata.frameRate !== undefined && (!Number.isFinite(metadata.frameRate) || metadata.frameRate <= 0))
    || !Number.isFinite(metadata.canvas?.width) || metadata.canvas.width <= 0
    || !Number.isFinite(metadata.canvas?.height) || metadata.canvas.height <= 0
    || ![metadata.nodeCount, metadata.trackCount, metadata.resourceCount].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Array.isArray(metadata.extensionsUsed) || !metadata.extensionsUsed.every(extension => typeof extension === 'string' && extension.length > 0)
    || typeof metadata.hasStateMachine !== 'boolean') {
    throw new TypeError(`HYA editor asset ${asset.id} metadata is invalid.`);
  }
  return Object.freeze(structuredClone(asset));
}

function decodedBase64Length(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return -1;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

function parseMaterialGraphAsset(asset: MaterialGraphAuthoringAsset): MaterialGraphAuthoringAsset {
  if (!asset || typeof asset !== 'object' || !asset.id?.trim() || !asset.name?.trim()) {
    throw new TypeError('Material Graph id and name must not be empty.');
  }
  const graph = asset.graph;
  if (!graph || graph.format !== 'haiyue-shader-graph' || graph.version !== 1 || graph.kind !== 'material') {
    throw new TypeError(`Material Graph ${asset.id} must use haiyue-shader-graph material version 1.`);
  }
  if (!Array.isArray(graph.resources) || !Array.isArray(graph.nodes) || !graph.outputs || typeof graph.outputs !== 'object') {
    throw new TypeError(`Material Graph ${asset.id} has an invalid authoring asset shape.`);
  }
  return Object.freeze(structuredClone(asset));
}
