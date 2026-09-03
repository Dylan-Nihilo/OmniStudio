import type { JSONContent } from '@tiptap/core';

/** Return the text represented by a Tiptap JSON value. */
export function getDocumentText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as { text?: unknown; content?: unknown };
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map(getDocumentText).join('\n');
}

/** Convert an existing plain-text project script into editable Tiptap blocks. */
export function documentFromOriginalText(text: string): JSONContent {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let sceneNumber = 0;
  const content = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const value = line.trim();
      const sceneMatch = value.match(/^场景\s*\d+\s*(.*)$/);
      if (sceneMatch) {
        sceneNumber += 1;
        return {
          type: 'sceneHeading',
          attrs: { id: `restored-scene-${sceneNumber}` },
          content: [{ type: 'text', text: value }],
        };
      }
      return {
        type: 'action',
        content: [{ type: 'text', text: value }],
      };
    });

  return {
    type: 'doc',
    content: content.length > 0
      ? content
      : [{ type: 'action', content: [{ type: 'text', text: '' }] }],
  };
}

/**
 * Old projects can contain a short scratch document created by the first
 * editor prototype. Prefer the canonical project script when the persisted
 * document is clearly only a small fraction of it.
 */
export function shouldUseOriginalText(documentValue: unknown, originalText: string): boolean {
  const sourceLength = originalText.trim().length;
  if (sourceLength < 120) return false;
  const documentLength = getDocumentText(documentValue).trim().length;
  return documentLength < Math.max(40, Math.floor(sourceLength * 0.35));
}
