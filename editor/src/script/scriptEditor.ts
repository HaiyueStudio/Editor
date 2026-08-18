import type { GESelect } from '@haiyue/ui';
import {
  ScriptComponent,
  SCRIPT_LIFECYCLES,
  ScriptResource,
  type ScriptLifecycleName,
} from '@haiyue/engine/components';
import type { ScriptEditorHandle } from '../types';
import {
  getScriptLifecycleHelp,
  getScriptLifecycleOptions,
  normalizeScriptLifecycle,
} from './scriptAuthoringText';

export {
  getKeyboardExample,
  getScriptLifecycleExample,
  getScriptLifecycleHelp,
  getScriptLifecycleOptions,
  normalizeScriptLifecycle,
} from './scriptAuthoringText';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let highlighterPromise: Promise<typeof import('./scriptSyntaxHighlighter')> | null = null;
let highlightRenderVersion = 0;
const highlightVersions = new WeakMap<HTMLElement, number>();

export function renderHighlightedCode(target: HTMLElement, code: string): void {
  const version = ++highlightRenderVersion;
  highlightVersions.set(target, version);
  target.innerHTML = escapeHtml(code) || '<br>';
  highlighterPromise ??= import('./scriptSyntaxHighlighter');
  void highlighterPromise.then(module => {
    if (highlightVersions.get(target) !== version) return;
    module.renderJavaScriptHighlight(target, code);
  });
}

function syncScriptEditorScroll(editor: ScriptEditorHandle): void {
  editor.highlight.scrollTop = editor.textarea.scrollTop;
  editor.highlight.scrollLeft = editor.textarea.scrollLeft;
}

export interface ScriptEditorControllerOptions {
  host: HTMLElement | null;
  lifecycleSelect: GESelect | null;
  parametersCode: HTMLElement | null;
  overlay: HTMLElement | null;
  overlayTitle: HTMLElement | null;
  getOnlyScriptResource: () => ScriptResource | null;
  onScriptChange?: (target: ScriptComponent | ScriptResource) => void;
}

export class ScriptEditorController {
  private readonly _options: ScriptEditorControllerOptions;
  private _lifecycle: ScriptLifecycleName = 'onUpdate';
  private _editor: ScriptEditorHandle | null = null;
  private _target: ScriptComponent | ScriptResource | null = null;
  private _editorLifecycle: ScriptLifecycleName | null = null;
  private _editingComponent: ScriptComponent | null = null;
  private _editingPreviousDisabled = false;

  constructor(options: ScriptEditorControllerOptions) {
    this._options = options;
  }

  get lifecycle(): ScriptLifecycleName {
    return this._lifecycle;
  }

  set lifecycle(value: string) {
    this._lifecycle = normalizeScriptLifecycle(value);
  }

  getTarget(target: ScriptComponent | ScriptResource | null): ScriptComponent | ScriptResource | null {
    if (!target) return null;
    if (target instanceof ScriptResource) return target;
    if (target.resource) return target.resource;
    const hasLocalScript = SCRIPT_LIFECYCLES.some(lifecycle => target.scripts[lifecycle].trim());
    const onlyScriptResource = this._options.getOnlyScriptResource();
    return !hasLocalScript && onlyScriptResource ? onlyScriptResource : target;
  }

  reset(): void {
    this.endEditing();
    this._editor = null;
    this._target = null;
    this._editorLifecycle = null;
  }

  setCode(target: ScriptComponent | ScriptResource, code: string): void {
    if (!this._editor || this._target !== target) return;
    this._editor.textarea.value = code;
    target.setScript(this._lifecycle, code);
    this._options.onScriptChange?.(target);
    renderHighlightedCode(this._editor.highlight, code);
    syncScriptEditorScroll(this._editor);
  }

  render(target: ScriptComponent | ScriptResource): void {
    const { host, lifecycleSelect, parametersCode, overlay } = this._options;
    if (!host) return;
    target = this.getTarget(target) ?? target;
    this._lifecycle = normalizeScriptLifecycle(this._lifecycle);
    if (lifecycleSelect) {
      lifecycleSelect.options = getScriptLifecycleOptions();
      lifecycleSelect.value = this._lifecycle;
    }
    if (parametersCode) {
      renderHighlightedCode(parametersCode, getScriptLifecycleHelp(this._lifecycle));
    }

    if (this._editor && this._target === target && this._editorLifecycle === this._lifecycle) return;

    this.endEditing();
    host.replaceChildren();
    this._target = target;
    this._editorLifecycle = this._lifecycle;

    const highlight = document.createElement('pre');
    const textarea = document.createElement('textarea');
    highlight.className = 'script-editor-highlight';
    textarea.className = 'script-editor-textarea';
    textarea.spellcheck = false;
    textarea.autocapitalize = 'off';
    textarea.autocomplete = 'off';
    textarea.value = target.getScript(this._lifecycle);
    renderHighlightedCode(highlight, textarea.value);
    this._editor = { textarea, highlight };

    textarea.addEventListener('focus', () => {
      if (target instanceof ScriptComponent) this.beginEditing(target);
    });
    textarea.addEventListener('blur', () => {
      target.setScript(this._lifecycle, textarea.value);
      this._options.onScriptChange?.(target);
      this.endEditing();
    });
    textarea.addEventListener('input', () => {
      target.setScript(this._lifecycle, textarea.value);
      this._options.onScriptChange?.(target);
      renderHighlightedCode(highlight, textarea.value);
      if (this._editor) syncScriptEditorScroll(this._editor);
    });
    textarea.addEventListener('scroll', () => {
      if (this._editor) syncScriptEditorScroll(this._editor);
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText('  ', start, end, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    host.append(highlight, textarea);
    host.onpointerdown = () => {
      requestAnimationFrame(() => textarea.focus());
    };
    requestAnimationFrame(() => {
      if (!overlay || overlay.hidden) return;
      textarea.focus();
    });
  }

  openResource(resource: ScriptResource): void {
    const { overlay, overlayTitle } = this._options;
    if (overlayTitle) overlayTitle.textContent = resource.name;
    if (overlay) overlay.hidden = false;
    this.reset();
    this.render(resource);
  }

  closeResource(): void {
    const { host, overlay } = this._options;
    if (overlay) overlay.hidden = true;
    this.reset();
    host?.replaceChildren();
  }

  private beginEditing(component: ScriptComponent): void {
    if (this._editingComponent === component) return;
    this.endEditing();
    this._editingComponent = component;
    this._editingPreviousDisabled = component.disabled;
    component.disabled = true;
  }

  private endEditing(): void {
    if (!this._editingComponent) return;
    this._editingComponent.disabled = this._editingPreviousDisabled;
    this._editingComponent = null;
  }
}
