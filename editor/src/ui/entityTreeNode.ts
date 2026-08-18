import type { GETreeNodeData } from '@haiyue/ui';

export interface EditorEntityTreeNodeVisibilityDetail {
  entityId: number;
  disabled: boolean;
}

const ENTITY_TREE_NODE_CSS = `
  :host {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    color: inherit;
    font: inherit;
  }
  :host::before {
    content: attr(data-label);
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 1;
  }
  :host([disabled-entity])::before {
    opacity: 0.48;
  }
  button {
    position: relative;
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    color: #8fa7c8;
    background: transparent;
    cursor: pointer;
  }
  button:hover {
    color: #d8e2f2;
    background: rgba(115, 183, 255, 0.14);
  }
  button::before,
  button::after {
    position: absolute;
    inset: 50% auto auto 50%;
    box-sizing: border-box;
    content: '';
    pointer-events: none;
  }
  button::before {
    width: 12px;
    height: 12px;
    border: 1.7px solid currentColor;
    border-radius: 72% 18%;
    transform: translate(-50%, -50%) rotate(45deg);
  }
  button::after {
    width: 3.5px;
    height: 3.5px;
    border-radius: 50%;
    background: currentColor;
    transform: translate(-50%, -50%);
  }
  :host([disabled-entity]) button::before {
    opacity: 0.58;
  }
  :host([disabled-entity]) button::after {
    width: 16px;
    height: 1.7px;
    border-radius: 1px;
    transform: translate(-50%, -50%) rotate(45deg);
  }
`;

let sharedStyleSheet: CSSStyleSheet | null = null;

export class EditorEntityTreeNode extends HTMLElement {
  private readonly _visibilityButton = document.createElement('button');
  private _entityId: number | null = null;
  private _disabled = false;
  private _renderedDisabled: boolean | null = null;
  private _labelText = '';

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    installEntityTreeNodeStyles(root);
    this._visibilityButton.type = 'button';
    this._visibilityButton.addEventListener('click', this._onVisibilityClick);
    root.append(this._visibilityButton);
  }

  set node(value: GETreeNodeData) {
    this._entityId = Number(value.entityId ?? value.id);
    const labelText = String(value.label ?? value.id);
    if (labelText !== this._labelText) {
      this._labelText = labelText;
      this.setAttribute('data-label', labelText);
    }
    this._disabled = Boolean(value.disabled);
    if (this._disabled === this._renderedDisabled) return;
    this._renderedDisabled = this._disabled;
    this.toggleAttribute('disabled-entity', this._disabled);
    this._visibilityButton.title = this._disabled ? 'Show entity' : 'Hide entity';
  }

  private _onVisibilityClick = (event: MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    if (!Number.isFinite(this._entityId)) return;
    this.dispatchEvent(new CustomEvent<EditorEntityTreeNodeVisibilityDetail>('entity-visibility-toggle', {
      detail: { entityId: this._entityId!, disabled: !this._disabled },
      bubbles: true,
      composed: true,
    }));
  };
}

function installEntityTreeNodeStyles(root: ShadowRoot): void {
  try {
    sharedStyleSheet ??= new CSSStyleSheet();
    if (sharedStyleSheet.cssRules.length === 0) sharedStyleSheet.replaceSync(ENTITY_TREE_NODE_CSS);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sharedStyleSheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = ENTITY_TREE_NODE_CSS;
    root.append(style);
  }
}

export function defineEditorEntityTreeNode(): void {
  if (!customElements.get('editor-entity-tree-node')) {
    customElements.define('editor-entity-tree-node', EditorEntityTreeNode);
  }
}
