import { describe, expect, it } from 'vitest';
import { applyWritingPreview, moveScriptParagraph, paragraphRange, type WritingPreview } from '@/lib/scriptWriting';

describe('script writing selections', () => {
  it('keeps exact whitespace, blank paragraphs, emoji and boundaries when selecting paragraphs', () => {
    expect(paragraphRange('甲😀乙\n\n尾声', { start: 1, end: 3 })).toEqual({ start: 0, end: 4 });
    expect(paragraphRange('\n尾声', { start: 0, end: 0 })).toEqual({ start: 0, end: 0 });
    expect(paragraphRange('开场\n结尾', { start: 3, end: 3 })).toEqual({ start: 3, end: 5 });
  });
  it('moves a paragraph or a multi-paragraph selection without changing its text', () => {
    expect(moveScriptParagraph('甲\n\n乙😀\n丙', { start: 3, end: 6 }, -1)).toEqual({ text: '甲\n乙😀\n\n丙', range: { start: 2, end: 5 } });
    expect(moveScriptParagraph('甲\n乙\n丙\n丁', { start: 2, end: 5 }, 1)).toEqual({ text: '甲\n丁\n乙\n丙', range: { start: 4, end: 7 } });
    expect(moveScriptParagraph('甲\n乙', { start: 0, end: 0 }, -1)).toBeNull();
  });
  it('applies suggestions only to their original document and range', () => {
    const source = '开场😀\n结尾';
    const preview: WritingPreview = { scope: 'selection', selection: { start: 2, end: 4 }, original: '😀', replacement: '雨夜', summary: '', source_fingerprint: '' };
    expect(applyWritingPreview(source, source, preview)).toBe('开场雨夜\n结尾');
    expect(applyWritingPreview(source + '新内容', source, preview)).toBeNull();
    expect(applyWritingPreview(source, source, { ...preview, original: '伪造原文' })).toBeNull();
    expect(applyWritingPreview(source, source, { ...preview, scope: 'document', original: source, replacement: '新剧本' })).toBe('新剧本');
  });
});
