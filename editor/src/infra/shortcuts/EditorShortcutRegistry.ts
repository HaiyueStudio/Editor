export type EditorShortcutContext = 'global' | 'viewport' | 'modal' | 'text';

export interface EditorShortcutBinding {
  readonly id: string;
  readonly chord: string;
  readonly context?: EditorShortcutContext;
  readonly priority?: number;
  readonly allowInText?: boolean;
  readonly enabled?: () => boolean;
  readonly handler: (event: KeyboardEvent) => void;
}

interface RegisteredShortcut extends EditorShortcutBinding {
  readonly normalizedChord: string;
  readonly context: EditorShortcutContext;
  readonly priority: number;
}

export class ShortcutConflictError extends Error {
  constructor(
    readonly chord: string,
    readonly context: EditorShortcutContext,
    readonly shortcutIds: readonly string[],
  ) {
    super(`Shortcut conflict for ${chord} in ${context}: ${shortcutIds.join(', ')}`);
    this.name = 'ShortcutConflictError';
  }
}

export class EditorShortcutRegistry {
  private readonly _bindings: RegisteredShortcut[] = [];
  private readonly _target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;

  constructor(target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window) {
    this._target = target;
    this._target?.addEventListener('keydown', this._onKeyDown as EventListener);
  }

  register(binding: EditorShortcutBinding): () => void {
    const normalizedChord = normalizeShortcutChord(binding.chord);
    const context = binding.context ?? 'global';
    const conflicts = this._bindings.filter(item => item.normalizedChord === normalizedChord && item.context === context);
    if (conflicts.length > 0) {
      throw new ShortcutConflictError(normalizedChord, context, [...conflicts.map(item => item.id), binding.id]);
    }
    const registered: RegisteredShortcut = { ...binding, normalizedChord, context, priority: binding.priority ?? 0 };
    this._bindings.push(registered);
    return () => {
      const index = this._bindings.indexOf(registered);
      if (index >= 0) this._bindings.splice(index, 1);
    };
  }

  handle(event: KeyboardEvent): boolean {
    const chord = eventToShortcutChord(event);
    const context = resolveShortcutContext(event.target);
    const candidates = this._bindings
      .filter(binding => binding.normalizedChord === chord
        && binding.enabled?.() !== false
        && matchesContext(binding, context))
      .sort((left, right) => {
        const contextDifference = Number(right.context === context) - Number(left.context === context);
        return contextDifference || right.priority - left.priority;
      });
    const binding = candidates[0];
    if (!binding) return false;
    event.preventDefault();
    binding.handler(event);
    return true;
  }

  get bindings(): readonly Readonly<EditorShortcutBinding>[] { return this._bindings; }

  dispose(): void {
    this._target?.removeEventListener('keydown', this._onKeyDown as EventListener);
    this._bindings.length = 0;
  }

  private readonly _onKeyDown = (event: KeyboardEvent): void => { this.handle(event); };
}

export function normalizeShortcutChord(chord: string): string {
  const parts = chord.split('+').map(part => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new TypeError('Shortcut chord requires a key.');
  const modifiers = new Set(parts.map(part => part === 'cmd' || part === 'ctrl' ? 'mod' : part));
  return [...(['mod', 'alt', 'shift'] as const).filter(modifier => modifiers.has(modifier)), normalizeKey(key)].join('+');
}

function eventToShortcutChord(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(normalizeKey(event.key));
  return parts.join('+');
}

function normalizeKey(key: string): string {
  const value = key.toLowerCase();
  return value === ' ' ? 'space' : value === 'esc' ? 'escape' : value;
}

function resolveShortcutContext(target: EventTarget | null): EditorShortcutContext {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return 'global';
  if (target.isContentEditable || target.matches('input, textarea, select')) return 'text';
  const owner = target.closest<HTMLElement>('[data-editor-shortcut-context]');
  const value = owner?.dataset.editorShortcutContext;
  return value === 'viewport' || value === 'modal' || value === 'text' ? value : 'global';
}

function matchesContext(binding: RegisteredShortcut, active: EditorShortcutContext): boolean {
  if (binding.context === active) return true;
  if (binding.context !== 'global') return false;
  return active !== 'text' || binding.allowInText === true;
}
