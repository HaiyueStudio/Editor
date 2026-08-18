/** Owns the editor help dialog without coupling it to viewport input handling. */
export class EditorHelpController {
  private readonly _dialog = element<HTMLDialogElement>('editor-help-dialog');

  constructor() {
    element('editor-help').addEventListener('click', () => this.open());
    element('close-editor-help').addEventListener('click', () => this.close());
  }

  open(): void {
    if (this._dialog.open) return;
    if (typeof this._dialog.showModal === 'function') this._dialog.showModal();
    else this._dialog.setAttribute('open', '');
    this._dialog.focus();
  }

  close(): void {
    if (typeof this._dialog.close === 'function') this._dialog.close();
    else this._dialog.removeAttribute('open');
  }
}

function element<T extends Element = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}`);
  return value as unknown as T;
}
