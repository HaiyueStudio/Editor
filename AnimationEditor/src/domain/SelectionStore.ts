export type AnimationEditorSelectionKind =
  | 'asset'
  | 'node'
  | 'component'
  | 'effect'
  | 'track'
  | 'keyframe'
  | 'clip'
  | 'parameter'
  | 'layer'
  | 'state'
  | 'transition';

export interface AnimationEditorSelectionItem {
  readonly kind: AnimationEditorSelectionKind;
  readonly id: string;
  readonly ownerId?: string;
}

export interface SelectionOptions {
  readonly additive?: boolean;
  readonly toggle?: boolean;
}

export type SelectionListener = (
  items: readonly AnimationEditorSelectionItem[],
  primary: AnimationEditorSelectionItem | null,
) => void;

export class SelectionStore {
  private _items: readonly AnimationEditorSelectionItem[] = Object.freeze([]);
  private readonly _listeners = new Set<SelectionListener>();

  get items(): readonly AnimationEditorSelectionItem[] { return this._items; }
  get primary(): AnimationEditorSelectionItem | null { return this._items.at(-1) ?? null; }

  subscribe(listener: SelectionListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  select(item: AnimationEditorSelectionItem, options: SelectionOptions = {}): boolean {
    const normalized = Object.freeze({ ...item });
    const key = selectionKey(normalized);
    const index = this._items.findIndex(candidate => selectionKey(candidate) === key);
    let next: readonly AnimationEditorSelectionItem[];
    if (options.toggle === true && index >= 0) {
      next = this._items.filter((_candidate, candidateIndex) => candidateIndex !== index);
    } else if (options.additive === true || options.toggle === true) {
      next = index >= 0
        ? [...this._items.filter((_candidate, candidateIndex) => candidateIndex !== index), normalized]
        : [...this._items, normalized];
    } else {
      next = index === 0 && this._items.length === 1 ? this._items : [normalized];
    }
    return this._replace(next);
  }

  replace(items: readonly AnimationEditorSelectionItem[]): boolean {
    const unique = new Map<string, AnimationEditorSelectionItem>();
    for (const item of items) unique.set(selectionKey(item), Object.freeze({ ...item }));
    return this._replace([...unique.values()]);
  }

  prune(predicate: (item: AnimationEditorSelectionItem) => boolean): boolean {
    return this._replace(this._items.filter(predicate));
  }

  clear(): boolean {
    return this._replace([]);
  }

  private _replace(items: readonly AnimationEditorSelectionItem[]): boolean {
    const next = Object.freeze([...items]);
    if (sameSelection(this._items, next)) return false;
    this._items = next;
    for (const listener of [...this._listeners]) listener(this._items, this.primary);
    return true;
  }
}

function selectionKey(item: AnimationEditorSelectionItem): string {
  return `${item.kind}\u0000${item.ownerId ?? ''}\u0000${item.id}`;
}

function sameSelection(
  left: readonly AnimationEditorSelectionItem[],
  right: readonly AnimationEditorSelectionItem[],
): boolean {
  return left.length === right.length && left.every((item, index) => selectionKey(item) === selectionKey(right[index]!));
}
