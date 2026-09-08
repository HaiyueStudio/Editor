import type { EditorDisposable, EditorHistorySnapshot, EditorSelectionReference, EditorSelectionSnapshot } from '@haiyue/editor-plugin-sdk';

/** Ephemeral authoring presentation contract, not a product document or storage format. */
export type AuthoringValue = null | boolean | number | string | readonly AuthoringValue[] | { readonly [key: string]: AuthoringValue };
export interface AuthoringBinding { readonly documentId: string; readonly revision: number; readonly epoch: string; }
export interface AuthoringHierarchyItem {
  readonly reference: EditorSelectionReference;
  readonly parentId: string | null;
  readonly order: number;
  readonly label: string;
  readonly editable: boolean;
}
export interface AuthoringField {
  readonly id: string;
  readonly label: string;
  readonly kind: 'number' | 'boolean' | 'string' | 'enum' | 'json';
  readonly value: AuthoringValue;
  readonly readOnly: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly options?: readonly Readonly<{ label: string; value: AuthoringValue }>[];
}
export interface AuthoringSection {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly editable: boolean;
  readonly removable: boolean;
  readonly fields: readonly AuthoringField[];
}
export type AuthoringVec3 = readonly [number, number, number];
export interface AuthoringTransform {
  readonly position: AuthoringVec3;
  readonly rotationDegrees: AuthoringVec3;
  readonly scale: AuthoringVec3;
}
export interface AuthoringTransformItem {
  readonly id: string;
  readonly parentId: string | null;
  readonly value: AuthoringTransform;
}
export type AuthoringGizmoMode = 'translate' | 'rotate' | 'scale';
export type AuthoringGizmoSpace = 'local' | 'world';
export type AuthoringGizmoAxis = 'x' | 'y' | 'z' | 'all';
export interface AuthoringGizmoView {
  readonly enabled: boolean;
  readonly transforms: readonly AuthoringTransformItem[];
  /** Host viewport projection in CSS pixels; no camera, World or GPU objects. */
  readonly projection: Readonly<{
    origin: readonly [number, number];
    axes: Readonly<Record<'x' | 'y' | 'z', readonly [number, number]>>;
    unitsPerPixel: number;
  }> | null;
}
export interface AuthoringRuntimeView {
  readonly status: 'unavailable' | 'stopped' | 'current' | 'historical';
  readonly instanceId: string | null;
  readonly documentRevision: number | null;
  readonly frame: number | null;
  readonly tick: number | null;
  readonly diagnostics: readonly string[];
  readonly fields: readonly AuthoringField[];
}
export interface AdvancedAuthoringView {
  readonly schemaVersion: 1;
  readonly binding: AuthoringBinding | null;
  readonly hierarchy: readonly AuthoringHierarchyItem[];
  readonly selection: EditorSelectionSnapshot;
  readonly history: EditorHistorySnapshot;
  readonly sections: readonly AuthoringSection[];
  readonly additions: readonly Readonly<{ id: string; label: string; description: string; enabled: boolean }>[];
  readonly gizmo: AuthoringGizmoView;
  readonly runtime: AuthoringRuntimeView;
  readonly diagnostics: readonly string[];
  readonly capabilities: Readonly<{ multiSelection: boolean; rename: boolean; reparent: boolean; addSection: boolean }>;
}
export type AdvancedAuthoringIntent =
  | Readonly<{ type: 'selection'; binding: AuthoringBinding; references: readonly EditorSelectionReference[]; active: EditorSelectionReference | null }>
  | Readonly<{ type: 'rename'; binding: AuthoringBinding; reference: EditorSelectionReference; name: string }>
  | Readonly<{ type: 'reparent'; binding: AuthoringBinding; reference: EditorSelectionReference; parent: EditorSelectionReference | null; order: number }>
  | Readonly<{ type: 'field.edit'; binding: AuthoringBinding; sectionId: string; fieldId: string; value: AuthoringValue }>
  | Readonly<{ type: 'section.toggle'; binding: AuthoringBinding; sectionId: string; enabled: boolean }>
  | Readonly<{ type: 'section.remove'; binding: AuthoringBinding; sectionId: string }>
  | Readonly<{ type: 'section.add'; binding: AuthoringBinding; additionId: string }>
  | Readonly<{ type: 'transform'; binding: AuthoringBinding; changes: readonly Readonly<{ reference: EditorSelectionReference; before: AuthoringTransform; after: AuthoringTransform }>[] }>
  | Readonly<{ type: 'undo' | 'redo' | 'runtime.inspect' | 'focus-selection'; binding: AuthoringBinding }>
  | Readonly<{ type: 'cancel' }>;
export interface AuthoringPreview {
  readonly binding: AuthoringBinding;
  readonly changes: readonly Readonly<{ reference: EditorSelectionReference; before: AuthoringTransform; after: AuthoringTransform }>[];
}
export interface AdvancedAuthoringMount extends EditorDisposable {
  update(value: unknown): void;
  reveal(reference: EditorSelectionReference): boolean;
  cancel(): void;
}
export interface AdvancedAuthoringOptions {
  readonly host: HTMLElement;
  readonly viewportHost: HTMLElement;
  readonly initial: unknown;
  readonly dispatch: (intent: AdvancedAuthoringIntent, signal: AbortSignal) => void | Promise<void>;
  /** Display-only viewport overlay. null restores the authoritative projection. */
  readonly preview: (value: AuthoringPreview | null) => void;
}
