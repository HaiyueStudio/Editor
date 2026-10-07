import type { EditorDisposable, EditorTaskProgress } from './index.js';

/** Transport contract version; independent from plugin and project-format versions. */
export const EDITOR_OPERATION_API_VERSION = '1' as const;
export type EditorJsonValue = null | boolean | number | string | readonly EditorJsonValue[] | { readonly [key: string]: EditorJsonValue };

/** A deliberately small schema vocabulary, not a full JSON Schema implementation. */
export type EditorOperationSchema =
  | Readonly<{ type: 'json' | 'null' | 'boolean' }>
  | Readonly<{ type: 'string'; minLength?: number; maxLength?: number; enum?: readonly string[] }>
  | Readonly<{ type: 'number' | 'integer'; minimum?: number; maximum?: number }>
  | Readonly<{ type: 'array'; items: EditorOperationSchema; maxItems?: number }>
  | Readonly<{ type: 'object'; properties: Readonly<Record<string, EditorOperationSchema>>; required?: readonly string[] }>;

export interface EditorOperationDescriptor {
  readonly id: string;
  readonly version: 1;
  readonly title: string;
  readonly target: 'document' | 'workspace';
  readonly access: 'read' | 'write';
  readonly documentKinds?: readonly string[];
  readonly input: EditorOperationSchema;
  readonly output: EditorOperationSchema;
}
export interface EditorOperationRequest {
  readonly apiVersion: typeof EDITOR_OPERATION_API_VERSION;
  readonly requestId: string;
  readonly operation: string;
  readonly documentId?: string;
  /** Mandatory for document writes; checked at dequeue AND immediately before commit. */
  readonly expectedRevision?: number;
  readonly params: EditorJsonValue;
}
export interface EditorOperationDocument {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly revision: number;
}
export type EditorOperationErrorCode = 'INVALID_REQUEST' | 'UNSUPPORTED_VERSION' | 'OPERATION_NOT_FOUND'
  | 'INVALID_PARAMS' | 'INVALID_RESULT' | 'DOCUMENT_NOT_FOUND' | 'DOCUMENT_KIND_MISMATCH'
  | 'REVISION_CONFLICT' | 'DUPLICATE_REQUEST' | 'QUEUE_FULL' | 'CANCELLED' | 'DISPOSED'
  | 'EXECUTION_FAILED' | 'ROLLBACK_FAILED';
export interface EditorOperationError {
  readonly code: EditorOperationErrorCode;
  readonly message: string;
}
export type EditorOperationResult<T extends EditorJsonValue = EditorJsonValue> =
  | Readonly<{ apiVersion: '1'; requestId: string; status: 'completed'; value: T; document?: EditorOperationDocument }>
  | Readonly<{ apiVersion: '1'; requestId: string; status: 'failed' | 'cancelled'; error: EditorOperationError }>;
export interface EditorOperationContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly document?: EditorOperationDocument;
  report(progress: EditorTaskProgress): void;
  assertCurrent(): void;
}
export interface EditorOperationDefinition<P extends EditorJsonValue = EditorJsonValue, Prepared = unknown, R extends EditorJsonValue = EditorJsonValue> {
  readonly ownerId: string;
  readonly descriptor: EditorOperationDescriptor;
  /** Must not mutate live state. Only commit may perform the domain transaction. */
  prepare(params: P, context: EditorOperationContext): Prepared | Promise<Prepared>;
  /** Synchronous domain commit, including history/dirty state; read operations return their prepared result. */
  commit(prepared: Prepared, context: EditorOperationContext): R;
  /** Required for writes. Restore effects of a failed commit and release prepared resources. */
  rollback?(prepared: Prepared | undefined, context: EditorOperationContext & { readonly commitStarted: boolean }, error: EditorOperationError): void | Promise<void>;
}
export type EditorOperationPhase = 'queued' | 'preparing' | 'committing' | 'rolling-back' | 'completed' | 'failed' | 'cancelled';
export interface EditorOperationEvent {
  readonly requestId: string;
  readonly operation: string;
  readonly ownerId: string;
  readonly documentId?: string;
  readonly phase: EditorOperationPhase;
  readonly progress?: EditorTaskProgress;
  readonly error?: EditorOperationError;
}
export interface EditorOperationServicePort extends EditorDisposable {
  register<P extends EditorJsonValue, Prepared, R extends EditorJsonValue>(definition: EditorOperationDefinition<P, Prepared, R>): EditorDisposable;
  list(): readonly Readonly<{ ownerId: string; descriptor: EditorOperationDescriptor }>[];
  execute(request: EditorOperationRequest, options?: { readonly signal?: AbortSignal }): Promise<EditorOperationResult>;
  cancel(requestId: string): boolean;
  subscribe(listener: (event: EditorOperationEvent) => void): EditorDisposable;
}

const identifier = /^[a-z0-9][a-z0-9._-]*$/;
export function defineEditorOperation(descriptor: EditorOperationDescriptor): EditorOperationDescriptor {
  const value = copyEditorJson(descriptor) as unknown as EditorOperationDescriptor;
  if (Object.keys(value).some(key => !['id','version','title','target','access','documentKinds','input','output'].includes(key)) || value.version !== 1 || typeof value.id !== 'string' || value.id.length > 160 || !identifier.test(value.id)
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200
    || !['document', 'workspace'].includes(value.target) || !['read', 'write'].includes(value.access)) throw new TypeError('Invalid operation descriptor.');
  if (value.documentKinds !== undefined && (value.target !== 'document' || !Array.isArray(value.documentKinds)
    || !value.documentKinds.length || value.documentKinds.some(kind => typeof kind !== 'string' || !identifier.test(kind)))) throw new TypeError('Invalid document kinds.');
  validateSchema(value.input); validateSchema(value.output);
  return value;
}

/** Own and freeze boundary data. Reject non-JSON values, cycles, accessors and oversized/deep input. */
export function copyEditorJson(value: unknown): EditorJsonValue {
  let nodes = 0, characters = 0;
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): EditorJsonValue => {
    if (++nodes > 100_000 || depth > 32) throw new TypeError('JSON value exceeds structural limits.');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') { characters += item.length; if (characters > 1_048_576) throw new TypeError('JSON text exceeds limit.'); return item; }
    if (typeof item !== 'object' || item === null || active.has(item)) throw new TypeError('Expected finite, acyclic JSON data.');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Expected plain JSON object.');
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('JSON cannot contain symbol properties.');
    active.add(item);
    let result: EditorJsonValue;
    if (Array.isArray(item)) {
      if (item.length > 100_000 || Object.getOwnPropertyNames(item).length !== item.length + 1) throw new TypeError('Expected dense JSON array.');
      result = Object.freeze(Array.from({ length: item.length }, (_, i) => {
        const property = Object.getOwnPropertyDescriptor(item, String(i));
        if (!property || !('value' in property)) throw new TypeError('JSON cannot contain accessors.');
        return visit(property.value, depth + 1);
      }));
    } else {
      const entries = Object.entries(Object.getOwnPropertyDescriptors(item));
      if (entries.length > 100_000) throw new TypeError('JSON object exceeds limit.');
      const record: Record<string, EditorJsonValue> = {};
      for (const [key, property] of entries) {
        characters += key.length;
        if (characters > 1_048_576 || !property.enumerable || !('value' in property)) throw new TypeError('Invalid JSON property.');
        Object.defineProperty(record, key, { value: visit(property.value, depth + 1), enumerable: true });
      }
      result = Object.freeze(record);
    }
    active.delete(item); return result;
  };
  return visit(value, 0);
}

function validateSchema(schema: EditorOperationSchema, depth = 0): void {
  if (!schema || typeof schema !== 'object' || depth > 24) throw new TypeError('Invalid operation schema.');
  const bound = (n: unknown) => n === undefined || typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const keys: Record<string, readonly string[]> = {json:['type'],null:['type'],boolean:['type'],string:['type','minLength','maxLength','enum'],number:['type','minimum','maximum'],integer:['type','minimum','maximum'],array:['type','items','maxItems'],object:['type','properties','required']};
  if (!Object.hasOwn(keys, schema.type) || Object.keys(schema).some(key => !keys[schema.type]!.includes(key))) throw new TypeError('Unknown operation schema keyword.');
  switch (schema.type) {
    case 'json': case 'null': case 'boolean': return;
    case 'string':
      if (!bound(schema.minLength) || !bound(schema.maxLength) || (schema.minLength ?? 0) > (schema.maxLength ?? Infinity)
        || schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some(v => typeof v !== 'string'))) break;
      return;
    case 'number': case 'integer':
      if ([schema.minimum, schema.maximum].some(n => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n))) || (schema.minimum ?? -Infinity) > (schema.maximum ?? Infinity)) break;
      return;
    case 'array': if (!bound(schema.maxItems)) break; validateSchema(schema.items, depth + 1); return;
    case 'object':
      if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)
        || schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(k => typeof k !== 'string' || !Object.hasOwn(schema.properties, k)))) break;
      for (const child of Object.values(schema.properties)) validateSchema(child, depth + 1); return;
  }
  throw new TypeError('Invalid operation schema.');
}

/** Call on owned JSON values, after copyEditorJson. Objects are closed (unknown keys reject). */
export function validateEditorOperationValue(schema: EditorOperationSchema, value: EditorJsonValue, path = '$'): void {
  const reject = (): never => { throw new TypeError(`Value does not match ${schema.type} schema at ${path}.`); };
  switch (schema.type) {
    case 'json': return;
    case 'null': if (value !== null) reject(); return;
    case 'boolean': if (typeof value !== 'boolean') reject(); return;
    case 'string':
      if (typeof value !== 'string') return reject();
      if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || schema.enum && !schema.enum.includes(value)) reject(); return;
    case 'number': case 'integer':
      if (typeof value !== 'number') return reject();
      if (!Number.isFinite(value) || schema.type === 'integer' && !Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) reject(); return;
    case 'array':
      if (!Array.isArray(value)) return reject();
      if (value.length > (schema.maxItems ?? Infinity)) reject();
      value.forEach((item, i) => validateEditorOperationValue(schema.items, item, `${path}[${i}]`)); return;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reject();
      for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) reject();
      for (const [key, item] of Object.entries(value)) {
        if (!Object.hasOwn(schema.properties, key)) reject();
        validateEditorOperationValue(schema.properties[key]!, item, `${path}.${key}`);
      } return;
  }
}
