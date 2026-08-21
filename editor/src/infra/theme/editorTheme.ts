export type EditorTheme = 'light' | 'dark';

export interface EditorThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EditorThemeRoot {
  readonly dataset: Record<string, string | undefined>;
  readonly style?: { colorScheme?: string };
}

export const EDITOR_THEME_STORAGE_KEY = 'haiyue.editor.theme';
export const DEFAULT_EDITOR_THEME: EditorTheme = 'dark';
const LEGACY_BUTTON_THEME_MARKER = 'data-hy-theme-bridge';
const LEGACY_BUTTON_THEME_CSS = `
  button {
    border-color: var(--hy-border-color, #343765);
    background: var(--hy-surface-elevated-color, #181a40);
    color: var(--hy-text-color, #eef0ff);
  }
  button:not(:disabled):hover {
    border-color: var(--hy-hover-border-color, #6468aa);
    background: var(--hy-hover-bg-color, #242752);
  }
  button:focus-visible {
    outline: 2px solid var(--hy-focus-border-color, #9c8fff);
    outline-offset: 1px;
  }
`;

export function normalizeEditorTheme(value: unknown): EditorTheme {
  return value === 'light' ? 'light' : DEFAULT_EDITOR_THEME;
}

export function readStoredEditorTheme(storage: EditorThemeStorage | null = getBrowserStorage()): EditorTheme {
  if (!storage) return DEFAULT_EDITOR_THEME;
  try {
    return normalizeEditorTheme(storage.getItem(EDITOR_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_EDITOR_THEME;
  }
}

export function storeEditorTheme(
  theme: unknown,
  storage: EditorThemeStorage | null = getBrowserStorage(),
): EditorTheme {
  const normalized = normalizeEditorTheme(theme);
  if (!storage) return normalized;
  try {
    storage.setItem(EDITOR_THEME_STORAGE_KEY, normalized);
  } catch {
    // A blocked browser storage area must not prevent the editor from changing theme for this session.
  }
  return normalized;
}

export function applyEditorTheme(
  theme: unknown,
  root: EditorThemeRoot | null = getBrowserRoot(),
): EditorTheme {
  const normalized = normalizeEditorTheme(theme);
  if (!root) return normalized;
  root.dataset.hyTheme = normalized;
  if (root.style) root.style.colorScheme = normalized;
  return normalized;
}

export function applyStoredEditorTheme(
  storage: EditorThemeStorage | null = getBrowserStorage(),
  root: EditorThemeRoot | null = getBrowserRoot(),
): EditorTheme {
  return applyEditorTheme(readStoredEditorTheme(storage), root);
}

/**
 * UI 0.1.0 hard-coded ge-button colors inside its open shadow root. Bridge
 * those buttons to the HY semantic tokens until Editor consumes hy-button.
 */
export function installLegacyButtonThemeBridge(scope: ParentNode | null = getBrowserDocument()): number {
  if (!scope) return 0;
  let installedCount = 0;
  for (const host of scope.querySelectorAll<HTMLElement>('ge-button')) {
    const shadowRoot = host.shadowRoot;
    if (!shadowRoot || shadowRoot.querySelector(`style[${LEGACY_BUTTON_THEME_MARKER}]`)) continue;
    const style = host.ownerDocument.createElement('style');
    style.setAttribute(LEGACY_BUTTON_THEME_MARKER, '');
    style.textContent = LEGACY_BUTTON_THEME_CSS;
    shadowRoot.append(style);
    installedCount++;
  }
  return installedCount;
}

function getBrowserStorage(): EditorThemeStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function getBrowserRoot(): EditorThemeRoot | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

function getBrowserDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}
