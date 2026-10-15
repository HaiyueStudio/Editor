import { defineDropdownComponents, type HYDropdown, type HYDropdownItem, type HYDropdownSelectDetail } from '@haiyue/ui/dropdown';

/** Header menu presentation; commands still run through the editor's existing actions. */
export class HeaderMenus {
  private readonly production: HYDropdown;
  private readonly selection: HYDropdown;
  private hasDocument = false;
  private hasSelection = false;
  private signature = '';
  private readonly radius = document.getElementById('selection-radius') as HTMLInputElement;
  private readonly radiusDialog = document.getElementById('selection-radius-dialog') as HTMLDialogElement;
  private savedRadius = '3';

  constructor(execute: (action: string) => void, signal: AbortSignal) {
    defineDropdownComponents();
    this.production = document.getElementById('production-menu') as HYDropdown;
    this.selection = document.getElementById('selection-menu') as HYDropdown;
    for (const menu of [this.production, this.selection]) {
      const trigger = menu.querySelector<HTMLButtonElement>('[slot=trigger]')!;
      const popup = menu.shadowRoot!.querySelector<HTMLElement>('.menu')!;
      popup.id = `${menu.id}-popup`;
      popup.setAttribute('role', 'menu');
      popup.setAttribute('aria-label', menu.getAttribute('aria-label')!);
      const buttons = () => [...popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const observer = new MutationObserver(() => {
        trigger.setAttribute('aria-expanded', String(menu.open));
        if (menu.open) {
          for (const other of [this.production, this.selection]) if (other !== menu) other.close();
          buttons()[0]?.focus();
        } else if (document.activeElement === menu) trigger.focus();
      });
      observer.observe(menu, { attributes: true, attributeFilter: ['open'] });
      signal.addEventListener('abort', () => { observer.disconnect(); menu.close(); }, { once: true });
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { menu.close(); trigger.focus(); event.stopPropagation(); event.preventDefault(); return; }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation();
          const focused = menu.shadowRoot!.activeElement;
          if (menu.open && focused instanceof HTMLButtonElement) focused.click();
          else menu.toggle();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (!menu.open) {
          menu.show();
          queueMicrotask(() => { const items = buttons(); (event.key === 'ArrowUp' || event.key === 'End' ? items.at(-1) : items[0])?.focus(); });
          return;
        }
        const items = buttons(), index = items.indexOf(menu.shadowRoot!.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }, { signal });
      menu.addEventListener('focusout', () => queueMicrotask(() => {
        if (!menu.matches(':focus-within')) menu.close();
      }), { signal });
      menu.addEventListener('item-select', event => {
        const { value } = (event as CustomEvent<HYDropdownSelectDetail>).detail;
        if (!menu.items.some(item => item.value === value && !item.disabled)) return;
        menu.close(); trigger.focus();
        if (value === 'selection-radius') {
          this.savedRadius = this.radius.value;
          this.radiusDialog.returnValue = '';
          this.radiusDialog.showModal(); this.radius.select();
        } else execute(value);
      }, { signal });
    }
    document.getElementById('selection-radius-form')!.addEventListener('submit', event => {
      event.preventDefault();
      if (this.radius.reportValidity()) this.radiusDialog.close('apply');
    }, { signal });
    this.radiusDialog.addEventListener('close', () => {
      if (this.radiusDialog.returnValue !== 'apply') this.radius.value = this.savedRadius;
      this.update(this.hasDocument, this.hasSelection);
    }, { signal });
    this.update(false, false);
  }

  update(hasDocument: boolean, hasSelection: boolean): void {
    this.hasDocument = hasDocument; this.hasSelection = hasSelection;
    const signature = JSON.stringify([hasDocument, hasSelection, this.radius.value]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.setItems(this.production, [
      { label: '色彩管理', value: 'color-management', disabled: !hasDocument },
      { label: '批处理文件', value: 'batch' }, { separator: true },
      { label: '新建贝塞尔路径', value: 'path-new', disabled: !hasDocument },
      { label: '应用路径 · Enter', value: 'path-apply', disabled: !hasDocument },
      { label: '切换路径开闭', value: 'path-closed', disabled: !hasDocument },
      { label: '取消路径 · Esc', value: 'path-cancel' },
    ]);
    this.setItems(this.selection, [
      { label: '全选 · ⌘/Ctrl A', value: 'select-all', disabled: !hasDocument },
      { label: '取消选择 · ⌘/Ctrl D', value: 'deselect', disabled: !hasSelection },
      { label: '反向选择 · ⌘/Ctrl ⇧ I', value: 'invert-selection', disabled: !hasDocument },
      { separator: true }, { label: `调整半径… · ${this.radius.value} px`, value: 'selection-radius' },
      { label: '羽化边缘', value: 'feather', disabled: !hasSelection },
      { label: '扩展选区', value: 'expand-selection', disabled: !hasSelection },
      { label: '收缩选区', value: 'contract-selection', disabled: !hasSelection },
      { label: '边缘细化', value: 'refine-selection', disabled: !hasSelection },
      { separator: true },
      { label: '填充前景色', value: 'fill', disabled: !hasDocument },
      { label: '清除选区像素', value: 'clear', disabled: !hasDocument },
    ]);
  }

  private setItems(menu: HYDropdown, items: HYDropdownItem[]): void {
    const focused = (menu.shadowRoot!.activeElement as HTMLElement | null)?.dataset.action;
    menu.items = items;
    const buttons = [...menu.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')];
    items.filter(item => !item.separator).forEach((item, index) => {
      const button = buttons[index]!;
      button.dataset.action = `menu-${item.value}`;
      button.setAttribute('role', 'menuitem');
    });
    if (menu.open && focused) (buttons.find(button => button.dataset.action === focused && !button.disabled) ?? buttons.find(button => !button.disabled))?.focus();
  }
}
