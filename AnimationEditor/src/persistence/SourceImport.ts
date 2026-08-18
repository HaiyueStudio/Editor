import {
  parseAnimation,
  type AnimationDocument,
  type ParsedAnimation,
} from '@haiyue/animation-spec';
import {
  convertLottie,
  type LottieConversionDiagnostic,
} from '@haiyue/animation-spec/lottie';
import { mapAnimationDocumentToEditorProject } from '../domain/CompositionProjectMapping';
import type { AnimationEditorProject } from '../domain/AnimationEditorProject';
import type { Native3dProject } from '../domain/native3d/Native3dProject';
import type {
  CompositionDiagnostic,
  CompositionProvenance,
  ReusableCompositionSource,
} from '../domain/ReusableComposition';

export type SourceImportKind = 'lottie' | 'spritesheet' | 'gltf' | 'hya';

export type SourceImportInput =
  | Readonly<{ readonly kind: 'url'; readonly url: string }>
  | Readonly<{ readonly kind: 'text'; readonly text: string; readonly contentType?: string }>
  | Readonly<{ readonly kind: 'bytes'; readonly bytes: ArrayBuffer | Uint8Array; readonly contentType?: string }>
  | Readonly<{ readonly kind: 'json'; readonly value: Readonly<Record<string, unknown>> }>;

export interface SourceImportRequest {
  readonly kind: SourceImportKind;
  readonly input: SourceImportInput;
  readonly sourceId?: string;
  readonly sourceUri?: string;
  /** Resolves relative package assets and relative URL inputs without blob URLs. */
  readonly packageBaseUrl?: string;
  readonly name?: string;
  readonly strict?: boolean;
  readonly signal?: AbortSignal;
  readonly adapter?: SourceImportAdapter;
}

export interface SourceImportPayload {
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly json?: Readonly<Record<string, unknown>>;
  readonly contentType?: string;
  readonly sourceUri?: string;
  readonly packageBaseUrl?: string;
}

export interface SourceImportAdapterContext {
  readonly signal: AbortSignal;
  readonly sourceId: string;
  readonly provenance: CompositionProvenance;
  readonly strict: boolean;
  readonly defer: (cleanup: () => void | Promise<void>) => void;
  readonly trackObjectUrl: (url: string) => string;
  readonly trackWorker: <T extends { terminate(): void }>(worker: T) => T;
  readonly trackAssetHandle: <T extends { dispose(): void | Promise<void> }>(handle: T) => T;
}

export type SourceImportAdapterOutput =
  | Readonly<{
      readonly family: '2d';
      readonly project: AnimationEditorProject;
      readonly name?: string;
      readonly diagnostics?: readonly CompositionDiagnostic[];
      readonly authoring?: ReusableCompositionSource['authoring'];
      readonly missingAssetIds?: readonly string[];
    }>
  | Readonly<{
      readonly family: '3d';
      readonly project: Native3dProject;
      readonly name?: string;
      readonly diagnostics?: readonly CompositionDiagnostic[];
      readonly authoring?: ReusableCompositionSource['authoring'];
      readonly missingAssetIds?: readonly string[];
    }>;

export interface SourceImportAdapter {
  readonly kind: SourceImportKind;
  readonly sourceFormat: string;
  readonly importer: string;
  readonly import: (
    payload: SourceImportPayload,
    context: SourceImportAdapterContext,
  ) => SourceImportAdapterOutput | Promise<SourceImportAdapterOutput>;
}

export interface SourceImportResult {
  readonly generation: number;
  readonly source: ReusableCompositionSource;
  readonly provenance: CompositionProvenance;
  readonly diagnostics: readonly CompositionDiagnostic[];
  readonly missingAssetIds: readonly string[];
  readonly deliveryData?: Readonly<{
    readonly kind: 'hya';
    readonly authoringMetadataRecovered: false;
    readonly originalBytes: Uint8Array;
    readonly preview: ParsedAnimation;
  }>;
}

export class SourceImportError extends Error {
  readonly name = 'SourceImportError';

  constructor(
    readonly code: 'E_IMPORT_ABORTED' | 'E_IMPORT_FETCH' | 'E_IMPORT_INVALID_SOURCE' | 'E_IMPORT_STRICT_DIAGNOSTIC' | 'E_IMPORT_ADAPTER',
    message: string,
    readonly diagnostics: readonly CompositionDiagnostic[] = [],
  ) {
    super(message);
  }
}

/**
 * Latest-wins import owner. Commit happens only after a serializable project is
 * complete and the generation is still current. Every exit drains registered
 * workers, handles and object URLs, including cancel/close and adapter errors.
 */
export class SourceImportCoordinator {
  #generation = 0;
  #active: ActiveImport | null = null;
  #closed = false;

  get generation(): number { return this.#generation; }
  get active(): boolean { return this.#active !== null; }

  async import(
    request: SourceImportRequest,
    /** Synchronous atomic store swap; asynchronous work belongs in the adapter before commit. */
    commit?: (result: SourceImportResult) => void,
  ): Promise<SourceImportResult> {
    if (this.#closed) throw new SourceImportError('E_IMPORT_ABORTED', 'Import coordinator is closed.');
    await this.cancel();
    const generation = ++this.#generation;
    const controller = new AbortController();
    const cleanup = new CleanupStack();
    const active: ActiveImport = { generation, controller, cleanup };
    this.#active = active;
    const abortFromCaller = (): void => controller.abort(request.signal?.reason);
    if (request.signal) {
      if (request.signal.aborted) abortFromCaller();
      else request.signal.addEventListener('abort', abortFromCaller, { once: true });
      cleanup.defer(() => request.signal?.removeEventListener('abort', abortFromCaller));
    }
    try {
      const payload = await loadImportPayload(request, controller.signal);
      throwIfAborted(controller.signal);
      const adapter = request.adapter ?? builtInAdapter(request.kind);
      if (adapter.kind !== request.kind) throw new SourceImportError(
        'E_IMPORT_ADAPTER', `Adapter "${adapter.kind}" cannot import request kind "${request.kind}".`,
      );
      const hash = await sha256(payload.bytes);
      throwIfAborted(controller.signal);
      const sourceId = request.sourceId?.trim() || `source:${request.kind}:${hash.slice('sha256-'.length, 23)}`;
      const provenance: CompositionProvenance = Object.freeze({
        importer: adapter.importer,
        sourceFormat: adapter.sourceFormat,
        sourceHash: hash,
        ...(payload.sourceUri ? { sourceUri: payload.sourceUri } : {}),
      });
      const context: SourceImportAdapterContext = Object.freeze({
        signal: controller.signal,
        sourceId,
        provenance,
        strict: request.strict === true,
        defer: (callback: () => void | Promise<void>) => cleanup.defer(callback),
        trackObjectUrl: (url: string) => {
          if (!url.startsWith('blob:')) throw new SourceImportError('E_IMPORT_ADAPTER', 'Only blob: URLs can be tracked as object URLs.');
          cleanup.defer(() => URL.revokeObjectURL(url));
          return url;
        },
        trackWorker: <T extends { terminate(): void }>(worker: T): T => {
          cleanup.defer(() => worker.terminate());
          return worker;
        },
        trackAssetHandle: <T extends { dispose(): void | Promise<void> }>(handle: T): T => {
          cleanup.defer(() => handle.dispose());
          return handle;
        },
      });
      const imported = await adapter.import(payload, context);
      throwIfAborted(controller.signal);
      if (this.#active !== active || generation !== this.#generation) throw aborted('A newer import superseded this result.');
      const diagnostics = Object.freeze([...(imported.diagnostics ?? [])]);
      if (request.strict && diagnostics.length > 0) throw new SourceImportError(
        'E_IMPORT_STRICT_DIAGNOSTIC', 'Strict import rejected source diagnostics.', diagnostics,
      );
      const common = {
        id: sourceId,
        name: imported.name ?? request.name ?? imported.project.name,
        instances: Object.freeze([]),
        provenance,
        diagnostics,
        authoring: imported.authoring ?? 'converted-source' as const,
      };
      const source = imported.family === '2d'
        ? Object.freeze({ ...common, family: '2d' as const, project: imported.project })
        : Object.freeze({ ...common, family: '3d' as const, project: imported.project });
      const result: SourceImportResult = Object.freeze({
        generation,
        source,
        provenance,
        diagnostics,
        missingAssetIds: Object.freeze([...(imported.missingAssetIds ?? [])]),
        ...(request.kind === 'hya' && imported.family === '2d' ? {
          deliveryData: Object.freeze({
            kind: 'hya' as const,
            authoringMetadataRecovered: false as const,
            originalBytes: new Uint8Array(payload.bytes),
            preview: parseAnimation(importPayloadForParser(payload)),
          }),
        } : {}),
      });
      if (commit) {
        // No await boundary is permitted here: the current-generation check and
        // store swap are one JavaScript transaction, so a newer task cannot
        // interleave and leave a stale project commit behind.
        commit(result);
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted || error instanceof DOMException && error.name === 'AbortError') {
        throw aborted(controller.signal.reason instanceof Error ? controller.signal.reason.message : 'Import was cancelled.');
      }
      throw error;
    } finally {
      if (this.#active === active) this.#active = null;
      await cleanup.dispose();
    }
  }

  async cancel(): Promise<void> {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    active.controller.abort('cancelled');
    await active.cleanup.dispose();
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.cancel();
  }
}

export const lottieSourceImportAdapter: SourceImportAdapter = Object.freeze({
  kind: 'lottie',
  sourceFormat: 'lottie-json',
  importer: '@haiyue/animation-spec/lottie',
  import(payload: SourceImportPayload, context: SourceImportAdapterContext): SourceImportAdapterOutput {
    throwIfAborted(context.signal);
    let source: string | Readonly<Record<string, unknown>> = payload.json ?? payload.text;
    if (!payload.json && !payload.text.trim()) throw new SourceImportError('E_IMPORT_INVALID_SOURCE', 'Lottie source is empty.');
    const converted = convertLottie(source, {
      ...(payload.packageBaseUrl ? { imageBaseUrl: payload.packageBaseUrl } : {}),
      // Run non-strict first so strict callers retain the exact diagnostic list.
      strict: false,
    });
    const diagnostics = converted.diagnostics.map(diagnostic => lottieDiagnostic(diagnostic, context.sourceId));
    const project = mapAnimationDocumentToEditorProject(converted.document, {
      projectId: context.sourceId,
      ...(converted.document.name ? { name: converted.document.name } : {}),
    });
    return Object.freeze({
      family: '2d',
      project,
      diagnostics: Object.freeze(diagnostics),
      authoring: 'converted-source',
    });
  },
});

export const hyaDeliverySourceImportAdapter: SourceImportAdapter = Object.freeze({
  kind: 'hya',
  sourceFormat: 'hya-delivery',
  importer: '@haiyue/animation-spec',
  import(payload: SourceImportPayload, context: SourceImportAdapterContext): SourceImportAdapterOutput {
    throwIfAborted(context.signal);
    const parsed = parseAnimation(importPayloadForParser(payload));
    const diagnostic: CompositionDiagnostic = Object.freeze({
      code: 'W_HYA_DELIVERY_LIMITED_PROJECT',
      severity: 'warning',
      path: '$',
      message: 'HYA is delivery data. A limited editable project was generated; authoring metadata was not recovered.',
      risk: 'delivery-data',
      sourceId: context.sourceId,
    });
    return Object.freeze({
      family: '2d',
      project: mapAnimationDocumentToEditorProject(parsed, {
        projectId: context.sourceId,
        ...(parsed.name ? { name: parsed.name } : {}),
      }),
      diagnostics: Object.freeze([diagnostic]),
      authoring: 'limited-delivery',
    });
  },
});

function builtInAdapter(kind: SourceImportKind): SourceImportAdapter {
  if (kind === 'lottie') return lottieSourceImportAdapter;
  if (kind === 'hya') return hyaDeliverySourceImportAdapter;
  throw new SourceImportError(
    'E_IMPORT_ADAPTER',
    `${kind} conversion belongs to ${kind === 'spritesheet' ? 'G03' : 'G06'}; provide its delegated adapter.`,
  );
}

async function loadImportPayload(request: SourceImportRequest, signal: AbortSignal): Promise<SourceImportPayload> {
  throwIfAborted(signal);
  const input = request.input;
  if (input.kind === 'url') {
    let resolved: URL;
    try {
      resolved = request.packageBaseUrl
        ? new URL(input.url, request.packageBaseUrl)
        : new URL(input.url);
    } catch {
      throw new SourceImportError('E_IMPORT_INVALID_SOURCE', 'Relative import URLs require packageBaseUrl.');
    }
    let response: Response;
    try {
      response = await fetch(resolved, { signal });
    } catch (error) {
      if (signal.aborted) throw aborted('Import fetch was cancelled.');
      throw new SourceImportError('E_IMPORT_FETCH', error instanceof Error ? error.message : `Failed to fetch ${resolved.href}.`);
    }
    if (!response.ok) throw new SourceImportError('E_IMPORT_FETCH', `Import fetch failed with HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sourceUri = response.url || resolved.href;
    const contentType = response.headers.get('content-type');
    return Object.freeze({
      bytes,
      text: new TextDecoder().decode(bytes),
      ...(contentType ? { contentType } : {}),
      sourceUri,
      packageBaseUrl: new URL('.', sourceUri).href,
    });
  }
  if (input.kind === 'json') {
    const text = stableJson(input.value);
    return Object.freeze({
      bytes: new TextEncoder().encode(text), text, json: structuredClone(input.value),
      ...(request.sourceUri ? { sourceUri: request.sourceUri } : {}),
      ...(request.packageBaseUrl ? { packageBaseUrl: normalizedBase(request.packageBaseUrl) } : {}),
    });
  }
  if (input.kind === 'text') {
    return Object.freeze({
      bytes: new TextEncoder().encode(input.text), text: input.text,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(request.sourceUri ? { sourceUri: request.sourceUri } : {}),
      ...(request.packageBaseUrl ? { packageBaseUrl: normalizedBase(request.packageBaseUrl) } : {}),
    });
  }
  const bytes = input.bytes instanceof Uint8Array ? new Uint8Array(input.bytes) : new Uint8Array(input.bytes.slice(0));
  return Object.freeze({
    bytes, text: new TextDecoder().decode(bytes),
    ...(input.contentType ? { contentType: input.contentType } : {}),
    ...(request.sourceUri ? { sourceUri: request.sourceUri } : {}),
    ...(request.packageBaseUrl ? { packageBaseUrl: normalizedBase(request.packageBaseUrl) } : {}),
  });
}

function importPayloadForParser(payload: SourceImportPayload): string | ArrayBuffer {
  const binary = payload.bytes.length >= 4
    && payload.bytes[0] === 0x48 && payload.bytes[1] === 0x59 && payload.bytes[2] === 0x41 && payload.bytes[3] === 0x31;
  return binary
    ? payload.bytes.buffer.slice(payload.bytes.byteOffset, payload.bytes.byteOffset + payload.bytes.byteLength) as ArrayBuffer
    : payload.text;
}

function lottieDiagnostic(diagnostic: LottieConversionDiagnostic, sourceId: string): CompositionDiagnostic {
  const unsupported = /UNSUPPORTED|UNKNOWN|SKIP/iu.test(diagnostic.code);
  return Object.freeze({
    code: diagnostic.code,
    severity: diagnostic.severity,
    path: diagnostic.path,
    message: diagnostic.message,
    risk: unsupported ? 'unsupported' : 'fidelity',
    sourceId,
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new SourceImportError('E_IMPORT_ADAPTER', 'SHA-256 is unavailable in this environment.');
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copy));
  return `sha256-${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

function normalizedBase(value: string): string {
  try {
    return new URL(value.endsWith('/') ? value : `${value}/`).href;
  } catch {
    throw new SourceImportError('E_IMPORT_INVALID_SOURCE', `Invalid packageBaseUrl "${value}".`);
  }
}

function stableJson(value: unknown): string {
  const canonicalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonicalize);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  };
  return JSON.stringify(canonicalize(value));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw aborted('Import was cancelled.');
}

function aborted(message: string): SourceImportError {
  return new SourceImportError('E_IMPORT_ABORTED', message);
}

class CleanupStack {
  #callbacks: Array<() => void | Promise<void>> = [];
  #disposed = false;

  defer(callback: () => void | Promise<void>): void {
    if (this.#disposed) void callback();
    else this.#callbacks.push(callback);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const callbacks = this.#callbacks.splice(0).reverse();
    const results = await Promise.allSettled(callbacks.map(callback => Promise.resolve().then(callback)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length > 0) throw new SourceImportError(
      'E_IMPORT_ADAPTER',
      `Import cleanup failed for ${failures.length} resource owner(s): ${failures.map(result => String(result.reason)).join('; ')}`,
    );
  }
}

interface ActiveImport {
  readonly generation: number;
  readonly controller: AbortController;
  readonly cleanup: CleanupStack;
}
