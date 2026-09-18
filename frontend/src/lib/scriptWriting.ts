export type WritingScope = 'selection' | 'paragraph' | 'document';
export type WritingAction = 'polish' | 'rewrite' | 'expand' | 'shorten' | 'reorder' | 'continue';
export type TextRange = { start: number; end: number };
export type WritingRequest = {
  text: string;
  instruction: string;
  scope: WritingScope;
  action: WritingAction;
  selection?: TextRange;
};
export type WritingPreview = {
  original: string;
  replacement: string;
  summary: string;
  source_fingerprint: string;
  scope: WritingScope;
  selection: TextRange | null;
};
export type ContinuityIssue = {
  category: 'character' | 'timeline' | 'location' | 'object' | 'causality';
  severity: 'warning' | 'error';
  quote: string;
  related_quote: string;
  message: string;
  suggestion: string;
};
export type ContinuityReport = { issues: ContinuityIssue[]; source_fingerprint: string };

/** Select complete physical paragraphs, retaining whitespace and empty lines exactly. */
export function paragraphRange(text: string, range: TextRange): TextRange {
  const start = Math.max(0, Math.min(range.start, text.length));
  const end = Math.max(start, Math.min(range.end, text.length));
  const lineEnd = text.indexOf('\n', end > start ? end - 1 : end);
  return { start: start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1, end: lineEnd < 0 ? text.length : lineEnd };
}

export function applyWritingPreview(text: string, source: string, preview: WritingPreview): string | null {
  if (text !== source) return null;
  if (preview.scope === 'document') return preview.original === source ? preview.replacement : null;
  const range = preview.selection;
  if (!range || range.start < 0 || range.end > text.length || range.end <= range.start
      || text.slice(range.start, range.end) !== preview.original) return null;
  return text.slice(0, range.start) + preview.replacement + text.slice(range.end);
}

export function moveScriptParagraph(text: string, range: TextRange, direction: -1 | 1): { text: string; range: TextRange } | null {
  const selected = paragraphRange(text, range);
  const lines = text.split('\n');
  const first = text.slice(0, selected.start).split('\n').length - 1;
  const count = text.slice(selected.start, selected.end).split('\n').length;
  if ((direction === -1 && first === 0) || (direction === 1 && first + count === lines.length)) return null;
  const moved = lines.splice(first, count);
  const target = first + direction;
  lines.splice(target, 0, ...moved);
  const start = target === 0 ? 0 : lines.slice(0, target).join('\n').length + 1;
  return { text: lines.join('\n'), range: { start, end: start + moved.join('\n').length } };
}

export function writingError(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown; error?: { message?: string } } } })?.response?.data;
  if (typeof detail?.detail === 'string') return detail.detail;
  if (detail?.detail && typeof detail.detail === 'object' && 'message' in detail.detail) return String(detail.detail.message);
  return detail?.error?.message || fallback;
}
