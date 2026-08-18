export const MATERIAL_GRAPH_WORKER_PROTOCOL = 'haiyue-material-graph-worker@1' as const;

export interface MaterialGraphDocumentV1 {
  readonly format: 'haiyue-shader-graph';
  readonly version: 1;
  readonly kind: 'material';
  readonly profile: 'webgpu-portable' | 'webgpu-enhanced' | 'webgl2-compatible';
  readonly resources: readonly unknown[];
  readonly nodes: readonly Readonly<{
    id: string;
    type: string;
    typeVersion: number;
    inputs: Readonly<Record<string, unknown>>;
    metadata?: Readonly<Record<string, unknown>>;
  }>[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly sceneFeatures?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MaterialGraphNodeDescriptorV1 {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly category: string;
  readonly ports: readonly Readonly<{
    id: string;
    direction: 'input' | 'output';
  }>[];
}

export interface MaterialGraphCompileDiagnostic {
  readonly severity: 'error';
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface MaterialGraphDeploymentArtifactV1 {
  readonly format: 'haiyue-material-graph-artifact@1';
  readonly canonicalHash: string;
  readonly variantKey: string;
  readonly source: Readonly<{ target: 'wgsl'; code: string; bytes: number }>;
  readonly cost: Readonly<{
    nodeCount: number;
    resourceCount: number;
    sourceBytes: number;
    reachableVariants: number;
    maximumVariants: number;
  }>;
  readonly runtimeAdapter: 'renderer-adapter-required';
}

export type MaterialGraphCompileResult =
  | Readonly<{ ok: true; artifact: MaterialGraphDeploymentArtifactV1 }>
  | Readonly<{ ok: false; diagnostics: readonly MaterialGraphCompileDiagnostic[] }>;

export interface MaterialGraphAuthoringDescription {
  readonly catalog: readonly MaterialGraphNodeDescriptorV1[];
  readonly surfaceSlots: readonly string[];
}

export interface MaterialGraphCompilerPort {
  describe(): Promise<MaterialGraphAuthoringDescription>;
  compile(graph: MaterialGraphDocumentV1, signal?: AbortSignal): Promise<MaterialGraphCompileResult>;
  dispose(): void;
}

export type MaterialGraphWorkerRequest =
  | Readonly<{ protocol: typeof MATERIAL_GRAPH_WORKER_PROTOCOL; requestId: number; type: 'describe' }>
  | Readonly<{ protocol: typeof MATERIAL_GRAPH_WORKER_PROTOCOL; requestId: number; type: 'compile'; graph: MaterialGraphDocumentV1 }>;

export type MaterialGraphWorkerResponse =
  | Readonly<{ protocol: typeof MATERIAL_GRAPH_WORKER_PROTOCOL; requestId: number; ok: true; value: MaterialGraphAuthoringDescription | MaterialGraphCompileResult }>
  | Readonly<{ protocol: typeof MATERIAL_GRAPH_WORKER_PROTOCOL; requestId: number; ok: false; message: string }>;
