import { paintThumbnail } from './canvasView.js';
import type { Bitmap, ImageDocument, ImageLayer } from './document.js';

interface Row {
  element: HTMLDivElement;
  eye: HTMLButtonElement;
  lock: HTMLButtonElement;
  thumb: HTMLSpanElement;
  title: HTMLSpanElement;
  layer: ImageLayer;
  bitmap: Bitmap | null;
  kind: ImageLayer['kind'];
  canvas?: HTMLCanvasElement;
  job?: AbortController;
  visible: boolean;
}
type ButtonFactory = (title: string, symbol: string, action: () => void) => HTMLButtonElement;
const attribute = (el: HTMLElement, name: string, value: string) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };

/** Keep row identity/focus stable; only visible thumbnails own background work. */
export class LayerListView {
  private rows = new Map<string, Row>();
  private doc: ImageDocument | undefined;
  private observer: IntersectionObserver;
  private lifetime = new AbortController();

  constructor(private list: HTMLElement, private run: (action: () => unknown) => void,
    private button: ButtonFactory, private folder: () => SVGElement) {
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const row = this.rows.get((entry.target as HTMLElement).dataset.layerId!);
        if (!row || row.element !== entry.target) continue;
        row.visible = entry.isIntersecting;
        this.thumbnail(row);
      }
    }, { root: list });
    document.addEventListener('visibilitychange', () => {
      for (const row of this.rows.values()) this.thumbnail(row);
    }, { signal: this.lifetime.signal });
  }

  sync(doc: ImageDocument | undefined): void {
    if (this.doc?.identity.id !== doc?.identity.id) this.clear();
    this.doc = doc;
    const ordered: { layer: ImageLayer; depth: number }[] = [];
    const visit = (layers: readonly ImageLayer[], depth: number) => {
      for (const layer of [...layers].reverse()) { ordered.push({ layer, depth }); visit(layer.children, depth + 1); }
    };
    if (doc) visit(doc.state.layers, 0);
    const live = new Set(ordered.map(item => item.layer.id));
    for (const [id, row] of this.rows) if (!live.has(id)) {
      this.cancel(row); this.observer.unobserve(row.element); row.element.remove(); this.rows.delete(id);
    }
    if (!ordered.length) {
      if (!this.list.querySelector('.empty-layers')) this.list.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty-layers' }));
      this.list.firstElementChild!.textContent = doc ? '还没有图层。点击 + 新建，或导入一张图片。' : '打开文档后，在这里管理图层。';
      return;
    }
    this.list.querySelector('.empty-layers')?.remove();
    const focused = this.list.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    let cursor = this.list.firstElementChild;
    for (const { layer, depth } of ordered) {
      let row = this.rows.get(layer.id);
      if (!row) { row = this.create(layer); this.rows.set(layer.id, row); this.observer.observe(row.element); }
      this.update(row, layer, depth);
      if (row.element !== cursor) this.list.insertBefore(row.element, cursor);
      cursor = row.element.nextElementSibling;
    }
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  private create(layer: ImageLayer): Row {
    const element = document.createElement('div'), thumb = document.createElement('span'), title = document.createElement('span');
    element.dataset.layerId = layer.id; element.setAttribute('role', 'treeitem');
    thumb.className = 'layer-thumb'; title.className = 'layer-title';
    const eye = this.button('', 'eye', () => { const doc = this.doc; if (doc) this.run(() => doc.updateLayer(layer.id, { visible: !row.layer.visible })); });
    const lock = this.button('', 'lock', () => { const doc = this.doc; if (doc) this.run(() => doc.updateLayer(layer.id, { locked: !row.layer.locked })); });
    const row: Row = { element, eye, lock, thumb, title, layer, bitmap: null, kind: layer.kind, visible: false };
    if (layer.kind === 'group') thumb.append(this.folder());
    element.append(eye, thumb, title, lock);
    element.onclick = event => {
      const doc = this.doc; if (!doc) return;
      if (event.shiftKey && doc.state.selectedId) {
        const ids = [...this.list.querySelectorAll<HTMLElement>('[data-layer-id]')].map(el => el.dataset.layerId!);
        const a = ids.indexOf(doc.state.selectedId), b = ids.indexOf(layer.id);
        doc.selectMany(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else if (event.metaKey || event.ctrlKey) doc.selectMany(doc.selectedIds.includes(layer.id) ? doc.selectedIds.filter(id => id !== layer.id) : [...doc.selectedIds, layer.id]);
      else doc.select(layer.id);
    };
    element.onkeydown = event => {
      if (event.target !== element) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.doc?.select(layer.id); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const rows = [...this.list.querySelectorAll<HTMLElement>('[role=treeitem]')], next = rows[rows.indexOf(element) + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) { this.doc?.select(next.dataset.layerId!); next.focus(); }
      }
    };
    return row;
  }

  private update(row: Row, layer: ImageLayer, depth: number): void {
    const selected = this.doc!.selectedIds.includes(layer.id);
    attribute(row.element, 'class', 'layer-row' + (selected ? ' selected' : '') + (!layer.visible ? ' invisible' : ''));
    if (row.element.style.paddingLeft !== `${depth * 12}px`) row.element.style.paddingLeft = `${depth * 12}px`;
    attribute(row.element, 'aria-level', String(depth + 1)); attribute(row.element, 'aria-selected', String(selected));
    attribute(row.element, 'tabindex', layer.id === this.doc!.state.selectedId ? '0' : '-1');
    attribute(row.eye, 'class', 'layer-eye' + (layer.visible ? '' : ' off')); attribute(row.eye, 'aria-pressed', String(layer.visible));
    this.label(row.eye, `${layer.visible ? '隐藏' : '显示'} ${layer.name}`);
    const title = (layer.clipping ? '↳ ' : '') + layer.name + (layer.content?.type === 'smart' ? ' ◈' : '') + (layer.styles?.enabled ? ' · fx' : '');
    if (row.title.textContent !== title) row.title.textContent = title;
    attribute(row.title, 'title', layer.name);
    const partial = Object.values(layer.locks ?? {}).some(Boolean);
    attribute(row.lock, 'class', 'layer-lock' + (layer.locked ? ' locked' : '') + (partial ? ' partial' : ''));
    attribute(row.lock, 'aria-pressed', String(layer.locked));
    const label = `${layer.locked ? '解锁' : '锁定'} ${layer.name}`;
    attribute(row.lock, 'aria-label', label);
    attribute(row.lock, 'title', partial ? '部分锁定：' + [layer.locks?.transparency ? '透明像素' : '', layer.locks?.pixels ? '像素编辑' : '', layer.locks?.position ? '位置' : '', layer.locks?.artboards ? '画板自动嵌套' : ''].filter(Boolean).join('、') + '；在图层面板调整' : label);
    if (row.bitmap !== layer.bitmap || row.kind !== layer.kind) {
      this.cancel(row); row.thumb.replaceChildren(); delete row.canvas;
      row.bitmap = layer.bitmap; row.kind = layer.kind;
      if (layer.kind === 'group') row.thumb.append(this.folder());
      else if (layer.bitmap) {
        row.canvas = document.createElement('canvas'); row.canvas.width = row.canvas.height = 62;
        row.canvas.dataset.thumbnail = 'idle'; row.thumb.append(row.canvas);
      }
    }
    row.layer = layer;
    this.thumbnail(row);
  }

  private label(button: HTMLButtonElement, text: string): void { attribute(button, 'title', text); attribute(button, 'aria-label', text); }
  private cancel(row: Row): void {
    row.job?.abort(); delete row.job;
    if (row.canvas?.dataset.thumbnail === 'loading') row.canvas.dataset.thumbnail = 'idle';
  }
  private thumbnail(row: Row): void {
    if (!row.visible || document.hidden) { this.cancel(row); return; }
    const canvas = row.canvas, bitmap = row.bitmap;
    if (!canvas || !bitmap || row.job || canvas.dataset.thumbnail === 'ready' || canvas.dataset.thumbnail === 'error') return;
    const job = row.job = new AbortController(); canvas.dataset.thumbnail = 'loading';
    void paintThumbnail(canvas, bitmap, job.signal).then(() => {
      if (!job.signal.aborted) canvas.dataset.thumbnail = 'ready';
    }).catch(error => {
      if (!job.signal.aborted) { canvas.dataset.thumbnail = 'error'; canvas.title = String(error); }
    }).finally(() => { if (row.job === job) delete row.job; });
  }
  private clear(): void {
    for (const row of this.rows.values()) this.cancel(row);
    this.observer.disconnect(); this.rows.clear(); this.list.replaceChildren();
  }
  dispose(): void { this.lifetime.abort(); this.clear(); this.doc = undefined; }
}
