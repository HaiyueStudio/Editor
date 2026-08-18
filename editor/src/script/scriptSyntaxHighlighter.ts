import { parser as javascriptParser } from '@lezer/javascript';
import { classHighlighter, highlightTree } from '@lezer/highlight';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeHighlightClasses(classes: string): string {
  return classes
    .split(/\s+/)
    .filter(token => /^[A-Za-z0-9_-]+$/.test(token))
    .join(' ');
}

export function renderJavaScriptHighlight(target: HTMLElement, code: string): void {
  const tree = javascriptParser.parse(code);
  let position = 0;
  const parts: string[] = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > position) parts.push(escapeHtml(code.slice(position, from)));
    const safeClasses = sanitizeHighlightClasses(classes);
    parts.push(safeClasses
      ? `<span class="${safeClasses}">${escapeHtml(code.slice(from, to))}</span>`
      : escapeHtml(code.slice(from, to)));
    position = to;
  });
  if (position < code.length) parts.push(escapeHtml(code.slice(position)));
  target.innerHTML = parts.join('') || '<br>';
}
