import {
  copyEditorJson, defineEditorOperation, validateEditorOperationValue,
  type EditorDiagnostic, type EditorDisposable, type EditorJsonValue,
  type EditorOperationContext, type EditorOperationDefinition, type EditorOperationDescriptor,
  type EditorOperationDocument, type EditorOperationError, type EditorOperationErrorCode,
  type EditorOperationEvent, type EditorOperationRequest, type EditorOperationResult,
  type EditorOperationServicePort, type EditorTaskContext,
} from '@haiyue/editor-plugin-sdk';
import { EditorDocumentHost } from './DocumentHost.js';
import { EditorTaskCoordinator } from './TaskCoordinator.js';

type Definition = EditorOperationDefinition<EditorJsonValue, unknown, EditorJsonValue>;
interface Registration { readonly definition: Definition; readonly descriptor: EditorOperationDescriptor; readonly ownerId: string; active: boolean }
interface Job {
  readonly request: EditorOperationRequest;
  readonly registration: Registration;
  readonly lane: string;
  readonly generation: number | undefined;
  readonly promise: Promise<EditorOperationResult>;
  resolve(result: EditorOperationResult): void;
  releaseSignal(): void;
  running: boolean;
  committing: boolean;
  settled: boolean;
  cancellation?: EditorOperationError;
}
interface Lane { active?: Job; readonly queue: Job[] }
export interface EditorOperationServiceOptions {
  readonly maxPending?: number;
  readonly diagnostic?: (diagnostic: EditorDiagnostic) => void;
}
class OperationFault extends Error {
  constructor(readonly code: EditorOperationErrorCode, message: string) { super(message); }
}
let serviceSequence = 0;

/** FIFO operations share the existing task owner; they never use latest-wins to discard writes. */
export class EditorOperationService implements EditorOperationServicePort {
  private readonly registrations = new Map<string, Registration>();
  private readonly jobs = new Map<string, Job>();
  private readonly lanes = new Map<string, Lane>();
  private readonly listeners = new Set<(event: EditorOperationEvent) => void>();
  private readonly documentSubscription: EditorDisposable;
  private readonly lanePrefix = `editor-operations:${++serviceSequence}:`;
  private readonly maxPending: number;
  private disposed = false;
  private disposal?: Promise<void>;

  constructor(private readonly documents: EditorDocumentHost, private readonly tasks: EditorTaskCoordinator, private readonly options: EditorOperationServiceOptions = {}) {
    this.maxPending = options.maxPending ?? 128;
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) throw new TypeError('maxPending must be a positive integer.');
    this.documentSubscription = documents.subscribe(() => {
      for (const job of [...this.jobs.values()]) {
        if (job.request.documentId && documents.generation(job.request.documentId) !== job.generation) this.cancelJob(job, failure('DOCUMENT_NOT_FOUND', 'The target document was closed or replaced.'));
      }
    });
  }

  register<P extends EditorJsonValue, Prepared, R extends EditorJsonValue>(definition: EditorOperationDefinition<P, Prepared, R>): EditorDisposable {
    if (this.disposed) throw new Error('Operation service is disposed.');
    const descriptor = defineEditorOperation(definition.descriptor);
    if (typeof definition.ownerId !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(definition.ownerId) || definition.ownerId.length > 160) throw new TypeError('Invalid operation owner.');
    if (typeof definition.prepare !== 'function' || typeof definition.commit !== 'function'
      || descriptor.access === 'write' && typeof definition.rollback !== 'function'
      || definition.rollback !== undefined && typeof definition.rollback !== 'function') throw new TypeError('Operations require prepare/commit; writes also require rollback.');
    if (definition.commit.constructor.name === 'AsyncFunction' || definition.commit.constructor.name === 'GeneratorFunction' || definition.commit.constructor.name === 'AsyncGeneratorFunction') throw new TypeError('Operation commit must be synchronous.');
    if (this.registrations.has(descriptor.id)) throw new Error(`Operation ${descriptor.id} is already registered.`);
    const registration: Registration = { ownerId: definition.ownerId, descriptor, active: true,
      definition: Object.freeze({ ...definition, descriptor }) as unknown as Definition };
    this.registrations.set(descriptor.id, registration);
    let disposal: Promise<void> | undefined;
    return Object.freeze({ dispose: () => {
      if (disposal) return disposal;
      let complete!: () => void;
      disposal = new Promise<void>(resolve => { complete = resolve; });
      registration.active = false;
      if (this.registrations.get(descriptor.id) === registration) this.registrations.delete(descriptor.id);
      const owned = [...this.jobs.values()].filter(job => job.registration === registration);
      for (const job of owned) this.cancelJob(job, failure('CANCELLED', 'Operation owner was unregistered.'));
      void Promise.all(owned.map(job => job.promise)).then(complete); return disposal;
    } });
  }

  list() {
    return Object.freeze([...this.registrations.values()].map(({ ownerId, descriptor }) => Object.freeze({ ownerId, descriptor })).sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id)));
  }

  execute(input: EditorOperationRequest, options: { readonly signal?: AbortSignal } = {}): Promise<EditorOperationResult> {
    let requestId = '';
    try {
      const rawId = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'requestId')?.value : undefined;
      requestId = typeof rawId === 'string' && rawId.length <= 160 ? rawId : '';
      const request = parseRequest(input); requestId = request.requestId;
      const signal = options.signal;
      if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new OperationFault('INVALID_REQUEST', 'Expected an AbortSignal.');
      if (this.disposed) throw new OperationFault('DISPOSED', 'Operation service is disposed.');
      if (this.jobs.has(requestId)) throw new OperationFault('DUPLICATE_REQUEST', 'Request ID is already in flight.');
      if (this.jobs.size >= this.maxPending) throw new OperationFault('QUEUE_FULL', 'Operation queue is full.');
      const registration = this.registrations.get(request.operation);
      if (!registration) throw new OperationFault('OPERATION_NOT_FOUND', 'Operation is not registered.');
      const descriptor = registration.descriptor;
      if (descriptor.target === 'document' ? !request.documentId : request.documentId !== undefined || request.expectedRevision !== undefined) throw new OperationFault('INVALID_REQUEST', 'Request target does not match operation target.');
      if (descriptor.target === 'document' && descriptor.access === 'write' && request.expectedRevision === undefined) throw new OperationFault('INVALID_REQUEST', 'Document writes require expectedRevision.');
      try { validateEditorOperationValue(descriptor.input, request.params); }
      catch (error) { throw new OperationFault('INVALID_PARAMS', message(error)); }
      let generation: number | undefined;
      if (request.documentId) {
        const document = this.documents.get(request.documentId);
        if (!document) throw new OperationFault('DOCUMENT_NOT_FOUND', 'Document is not open.');
        if (descriptor.documentKinds && !descriptor.documentKinds.includes(document.identity.kind)) throw new OperationFault('DOCUMENT_KIND_MISMATCH', 'Operation does not support this document kind.');
        generation = this.documents.generation(request.documentId);
      }
      if (signal?.aborted) return Promise.resolve(resultFailure(requestId, failure('CANCELLED', 'Request was cancelled.')));
      let resolve!: Job['resolve'];
      const promise = new Promise<EditorOperationResult>(done => { resolve = done; });
      const laneKey = this.lanePrefix + (request.documentId ? `document:${request.documentId}` : 'workspace');
      const job: Job = { request, registration, lane: laneKey, generation, promise, resolve, releaseSignal() {}, running: false, committing: false, settled: false };
      const lane = this.lanes.get(laneKey) ?? { queue: [] };
      if (signal) {
        const abort = () => { this.cancel(requestId); };
        signal.addEventListener('abort', abort, { once: true }); job.releaseSignal = () => signal.removeEventListener('abort', abort);
      }
      this.lanes.set(laneKey, lane); this.jobs.set(requestId, job); lane.queue.push(job);
      this.emit(job, 'queued'); this.pump(laneKey);
      return promise;
    } catch (error) { return Promise.resolve(resultFailure(requestId, errorData(error, 'INVALID_REQUEST'))); }
  }

  cancel(requestId: string): boolean {
    const job = this.jobs.get(requestId); if (!job || job.cancellation || job.committing) return false;
    this.cancelJob(job, failure('CANCELLED', 'Request was cancelled.')); return true;
  }

  subscribe(listener: (event: EditorOperationEvent) => void): EditorDisposable {
    if (this.disposed) throw new Error('Operation service is disposed.');
    this.listeners.add(listener); return Object.freeze({ dispose: () => { this.listeners.delete(listener); } });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    let complete!: () => void;
    this.disposal = new Promise<void>(resolve => { complete = resolve; });
    this.disposed = true; this.documentSubscription.dispose();
    for (const registration of this.registrations.values()) registration.active = false;
    this.registrations.clear();
    const jobs = [...this.jobs.values()];
    for (const job of jobs) this.cancelJob(job, failure('DISPOSED', 'Operation service was disposed.'));
    void Promise.all(jobs.map(job => job.promise)).then(() => { this.listeners.clear(); this.lanes.clear(); complete(); });
    return this.disposal;
  }

  private cancelJob(job: Job, error: EditorOperationError): void {
    if (job.settled || job.cancellation || job.committing) return;
    job.cancellation = error;
    if (job.running) this.tasks.cancel(job.lane);
    else {
      const lane = this.lanes.get(job.lane);
      if (lane) { const index = lane.queue.indexOf(job); if (index >= 0) lane.queue.splice(index, 1); }
      this.finish(job, resultFailure(job.request.requestId, error)); this.pump(job.lane);
    }
  }

  private pump(key: string): void {
    const lane = this.lanes.get(key); if (!lane || lane.active) return;
    const job = lane.queue.shift();
    if (!job) { this.lanes.delete(key); return; }
    lane.active = job; job.running = true;
    void this.run(job).then(result => this.finish(job, result), error => this.finish(job, resultFailure(job.request.requestId, errorData(error)))).finally(() => {
      delete lane.active; this.pump(key);
    });
  }

  private async run(job: Job): Promise<EditorOperationResult> {
    const { request, registration } = job;
    let context: EditorOperationContext | undefined, started = false, commitStarted = false, baseRevision: number | undefined;
    const current = () => {
      if (job.cancellation) throw new OperationFault(job.cancellation.code, job.cancellation.message);
      if (this.disposed || !registration.active) throw new OperationFault('CANCELLED', 'Operation owner is unavailable.');
      if (request.documentId) {
        if (this.documents.generation(request.documentId) !== job.generation) throw new OperationFault('DOCUMENT_NOT_FOUND', 'The target document was closed or replaced.');
        const revision = this.documents.get(request.documentId)!.revision;
        if (baseRevision !== undefined && revision !== baseRevision) throw new OperationFault('REVISION_CONFLICT', 'Document changed while the operation was preparing.');
        if (request.expectedRevision !== undefined && revision !== request.expectedRevision) throw new OperationFault('REVISION_CONFLICT', `Expected document revision ${request.expectedRevision}, received ${revision}.`);
      }
    };
    const result = await this.tasks.run(job.lane, {
      prepare: async (task: EditorTaskContext) => {
        current(); task.assertCurrent();
        const document = this.documentSnapshot(request.documentId); baseRevision = document?.revision;
        context = Object.freeze({ requestId: request.requestId, signal: task.signal, ...(document ? { document } : {}),
          assertCurrent: () => { current(); task.assertCurrent(); },
          report: progress => {
            current(); task.assertCurrent();
            if (!Number.isFinite(progress.current) || progress.current < 0 || progress.total !== undefined && (!Number.isFinite(progress.total) || progress.total < progress.current)) throw new TypeError('Invalid operation progress.');
            const owned = Object.freeze({ current: progress.current, ...(progress.total !== undefined ? { total: progress.total } : {}), ...(progress.message !== undefined ? { message: String(progress.message).slice(0, 1000) } : {}) });
            task.report(owned); this.emit(job, 'preparing', { progress: owned });
          },
        } satisfies EditorOperationContext);
        this.emit(job, 'preparing'); context.assertCurrent(); started = true;
        return registration.definition.prepare(request.params, context);
      },
      commit: prepared => {
        context!.assertCurrent(); this.emit(job, 'committing'); context!.assertCurrent();
        commitStarted = true; job.committing = true;
        const result = registration.definition.commit(prepared, context!);
        if (isPromiseLike(result)) { void Promise.resolve(result).catch(() => {}); throw new OperationFault('INVALID_RESULT', 'Operation commit must be synchronous.'); }
        let value: EditorJsonValue;
        try { value = copyEditorJson(result); validateEditorOperationValue(registration.descriptor.output, value); }
        catch (error) { throw new OperationFault('INVALID_RESULT', message(error)); }
        const document = this.documentSnapshot(request.documentId);
        return Object.freeze({ apiVersion: '1' as const, requestId: request.requestId, status: 'completed' as const, value, ...(document ? { document } : {}) });
      },
      rollback: async (_reason, prepared, error) => {
        if (!started || !context || !registration.definition.rollback) return;
        job.committing = false; this.emit(job, 'rolling-back');
        try { await registration.definition.rollback(prepared, Object.freeze({ ...context, commitStarted }), job.cancellation ?? errorData(error)); }
        catch (rollbackError) { throw new OperationFault('ROLLBACK_FAILED', message(rollbackError)); }
      },
    });
    if (result.status === 'completed') return result.value;
    if (result.status === 'failed') return resultFailure(request.requestId, errorData(result.error));
    return resultFailure(request.requestId, job.cancellation ?? failure('CANCELLED', 'Operation was cancelled.'));
  }

  private documentSnapshot(id: string | undefined): EditorOperationDocument | undefined {
    const doc = id ? this.documents.get(id) : undefined;
    return doc ? Object.freeze({ id: doc.identity.id, kind: doc.identity.kind, name: doc.identity.name, revision: doc.revision }) : undefined;
  }
  private finish(job: Job, result: EditorOperationResult): void {
    if (job.settled) return;
    job.settled = true; job.releaseSignal(); this.jobs.delete(job.request.requestId);
    this.emit(job, result.status, result.status === 'completed' ? {} : { error: result.error }); job.resolve(result);
  }
  private emit(job: Job, phase: EditorOperationEvent['phase'], extra: Partial<Pick<EditorOperationEvent, 'progress' | 'error'>> = {}): void {
    const event = Object.freeze({ requestId: job.request.requestId, operation: job.request.operation, ownerId: job.registration.ownerId,
      ...(job.request.documentId ? { documentId: job.request.documentId } : {}), phase, ...extra });
    for (const listener of [...this.listeners]) {
      try { listener(event); }
      catch (cause) { try { this.options.diagnostic?.({ code: 'EDITOR_OPERATION_OBSERVER_FAILED', severity: 'warning', message: 'Operation observer failed.', ownerId: job.registration.ownerId, cause }); } catch { /* Diagnostics cannot change an operation outcome. */ } }
    }
  }
}

function parseRequest(input: unknown): EditorOperationRequest {
  const value = copyEditorJson(input);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OperationFault('INVALID_REQUEST', 'Expected an operation request object.');
  const request = value as unknown as EditorOperationRequest;
  if (request.apiVersion !== '1') throw new OperationFault('UNSUPPORTED_VERSION', 'Unsupported operation API version.');
  const id = (item: unknown) => typeof item === 'string' && item.length > 0 && item.length <= 160 && item.trim() === item;
  if (!id(request.requestId) || !id(request.operation) || request.documentId !== undefined && !id(request.documentId)
    || request.expectedRevision !== undefined && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)
    || !Object.hasOwn(value, 'params') || Object.keys(value).some(key => !['apiVersion', 'requestId', 'operation', 'documentId', 'expectedRevision', 'params'].includes(key))) throw new OperationFault('INVALID_REQUEST', 'Invalid operation request envelope.');
  return request;
}
function message(error: unknown): string { return (error instanceof Error ? error.message : 'Operation failed.').slice(0, 2000); }
function failure(code: EditorOperationErrorCode, message: string): EditorOperationError { return Object.freeze({ code, message }); }
function errorData(error: unknown, fallback: EditorOperationErrorCode = 'EXECUTION_FAILED'): EditorOperationError { return failure(error instanceof OperationFault ? error.code : fallback, message(error)); }
function resultFailure(requestId: string, error: EditorOperationError): EditorOperationResult {
  return Object.freeze({ apiVersion: '1', requestId, status: error.code === 'CANCELLED' || error.code === 'DISPOSED' ? 'cancelled' : 'failed', error });
}
function isPromiseLike(value: unknown): value is PromiseLike<unknown> { return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function'; }
