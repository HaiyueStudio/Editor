export interface TextInputRequest {
  readonly title: string;
  readonly label: string;
  readonly initialValue?: string;
  readonly placeholder?: string;
}

export type RequestTextInput = (request: TextInputRequest) => Promise<string | null>;

/** Owns the editor-native replacement for window.prompt, which Electron does not support. */
export class TextInputDialogController {
  private readonly _root: Document;
  private readonly _dialog: HTMLDialogElement;
  private readonly _form: HTMLFormElement;
  private readonly _title: HTMLElement;
  private readonly _label: HTMLElement;
  private readonly _input: HTMLInputElement;
  private readonly _cancel: HTMLButtonElement;
  private readonly _abort = new AbortController();
  private _resolve: ((value: string | null) => void) | null = null;
  private _returnFocus: HTMLElement | null = null;
  private _ownedCloseEvents = 0;
  private _disposed = false;

  constructor(root: Document = document) {
    this._root = root;
    this._dialog = requiredElement(root, 'text-input-dialog');
    this._form = requiredElement(root, 'text-input-dialog-form');
    this._title = requiredElement(root, 'text-input-dialog-title');
    this._label = requiredElement(root, 'text-input-dialog-label');
    this._input = requiredElement(root, 'text-input-dialog-input');
    this._cancel = requiredElement(root, 'cancel-text-input-dialog');
    const { signal } = this._abort;
    this._form.addEventListener('submit', event => {
      event.preventDefault();
      this._settle(this._input.value);
    }, { signal });
    this._cancel.addEventListener('click', () => this._settle(null), { signal });
    this._dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this._settle(null);
    }, { signal });
    this._dialog.addEventListener('close', () => {
      if (this._ownedCloseEvents > 0) {
        this._ownedCloseEvents--;
        return;
      }
      this._settle(null);
    }, { signal });
  }

  readonly request: RequestTextInput = request => {
    if (this._disposed) return Promise.resolve(null);
    if (this._resolve) this._settle(null, false);
    this._title.textContent = request.title;
    this._label.textContent = request.label;
    this._input.value = request.initialValue ?? '';
    this._input.placeholder = request.placeholder ?? '';
    if (!this._returnFocus) {
      this._returnFocus = this._root.activeElement instanceof HTMLElement ? this._root.activeElement : null;
    }
    return new Promise(resolve => {
      this._resolve = resolve;
      this._open();
    });
  };

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._settle(null, false);
    this._abort.abort();
    this._returnFocus = null;
  }

  private _open(): void {
    if (!this._dialog.open) {
      if (typeof this._dialog.showModal === 'function') this._dialog.showModal();
      else this._dialog.setAttribute('open', '');
    }
    queueMicrotask(() => {
      if (!this._resolve) return;
      this._input.focus();
      this._input.select();
    });
  }

  private _settle(value: string | null, restoreFocus = true): void {
    const resolve = this._resolve;
    if (!resolve) return;
    this._resolve = null;
    if (this._dialog.open && typeof this._dialog.close === 'function') {
      this._ownedCloseEvents++;
      this._dialog.close();
    } else this._dialog.removeAttribute('open');
    const returnFocus = this._returnFocus;
    resolve(value);
    if (restoreFocus) queueMicrotask(() => {
      if (this._resolve) return;
      this._returnFocus = null;
      returnFocus?.focus({ preventScroll: true });
    });
  }
}

function requiredElement<T extends Element>(root: Document, id: string): T {
  const value = root.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
