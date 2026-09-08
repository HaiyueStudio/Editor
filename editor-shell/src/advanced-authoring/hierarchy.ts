import type { AuthoringHierarchyItem } from './types.js';

export interface HierarchyRow { readonly item: AuthoringHierarchyItem; readonly depth: number; readonly hasChildren: boolean; readonly expanded: boolean; }
/** Complete hierarchy ordering with bounded DOM pages; matches keep their ancestors. */
export function projectAuthoringHierarchy(items: readonly AuthoringHierarchyItem[], options: Readonly<{ search?: string; collapsed?: ReadonlySet<string>; offset?: number; limit?: number }> = {}) {
  const search = options.search?.trim().toLocaleLowerCase() ?? '', collapsed = options.collapsed ?? new Set<string>();
  const index = new Map(items.map(item => [item.reference.id, item])), children = new Map<string | null, AuthoringHierarchyItem[]>();
  for (const item of items) { const rows = children.get(item.parentId) ?? []; rows.push(item); children.set(item.parentId, rows); }
  for (const rows of children.values()) rows.sort((a, b) => a.order - b.order || a.reference.id.localeCompare(b.reference.id));
  const matches = new Set<string>();
  if (search) for (const item of items) if (`${item.label} ${item.reference.id}`.toLocaleLowerCase().includes(search)) {
    let cursor: AuthoringHierarchyItem | undefined = item;
    while (cursor && !matches.has(cursor.reference.id)) { matches.add(cursor.reference.id); cursor = cursor.parentId ? index.get(cursor.parentId) : undefined; }
  }
  const rows: HierarchyRow[] = [], stack = (children.get(null) ?? []).map(item => ({ item, depth: 0 })).reverse();
  while (stack.length) {
    const { item, depth } = stack.pop()!; if (search && !matches.has(item.reference.id)) continue;
    const descendants = children.get(item.reference.id) ?? [], expanded = Boolean(search) || !collapsed.has(item.reference.id);
    rows.push({ item, depth, hasChildren: descendants.length > 0, expanded });
    if (expanded) for (let i = descendants.length - 1; i >= 0; i--) stack.push({ item: descendants[i]!, depth: depth + 1 });
  }
  const offset = Math.max(0, Math.min(rows.length, Math.floor(options.offset ?? 0))), limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  return Object.freeze({ rows: Object.freeze(rows.slice(offset, offset + limit).map(row => Object.freeze(row))), total: rows.length, offset, next: offset + limit < rows.length });
}
export function canReparent(items: readonly AuthoringHierarchyItem[], id: string, parentId: string | null): boolean {
  const index = new Map(items.map(item => [item.reference.id, item]));
  if (!index.get(id)?.editable || parentId !== null && !index.has(parentId)) return false;
  const seen = new Set<string>([id]); let cursor = parentId;
  while (cursor !== null) { if (seen.has(cursor)) return false; seen.add(cursor); cursor = index.get(cursor)?.parentId ?? null; }
  return true;
}
