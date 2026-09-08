'use client';

import { Button, SelectField, TextField } from "@omnistudio/ui";
import { useState, useMemo, useCallback } from 'react';
import { Search, Film } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useTranslations } from 'next-intl';

export interface SearchPanelProps {
  editor: Editor | null;
  onNavigate?: () => void;
}

type NodeTypeFilter = 'all' | 'sceneHeading' | 'characterCue' | 'dialogue' | 'action' | 'note';

interface SearchResult {
  id: string;
  text: string;
  nodeType: string;
  nodeTypeLabel: string;
  sceneName: string;
  pos: number;
}

const NODE_TYPE_OPTIONS: { id: NodeTypeFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'sidebar.filterAll' },
  { id: 'sceneHeading', labelKey: 'sidebar.nodeSceneHeading' },
  { id: 'characterCue', labelKey: 'sidebar.nodeCharacter' },
  { id: 'dialogue', labelKey: 'sidebar.nodeDialogue' },
  { id: 'action', labelKey: 'sidebar.nodeAction' },
  { id: 'note', labelKey: 'sidebar.nodeNote' },
];

const NODE_TYPE_LABEL_KEYS: Record<string, string> = {
  sceneHeading: 'sidebar.labelScene',
  characterCue: 'sidebar.nodeCharacter',
  dialogue: 'sidebar.nodeDialogue',
  action: 'sidebar.nodeAction',
  note: 'sidebar.nodeNote',
  paragraph: 'sidebar.labelParagraph',
};

export default function SearchPanel({ editor, onNavigate }: SearchPanelProps) {
  const t = useTranslations('scriptEditor');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NodeTypeFilter>('all');

  const results = useMemo<SearchResult[]>(() => {
    if (!editor || !query.trim()) return [];

    const searchTerm = query.trim().toLowerCase();
    const matches: SearchResult[] = [];
    const doc = editor.state.doc;
    let currentScene = t('sidebar.unknownScene');

    doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        currentScene = node.textContent || t('sidebar.untitledScene');
      }

      // Filter by node type
      if (typeFilter !== 'all' && node.type.name !== typeFilter) {
        return true;
      }

      // Check text content
      if (node.isTextblock) {
        const text = node.textContent;
        if (text.toLowerCase().includes(searchTerm)) {
          // Extract snippet around match
          const idx = text.toLowerCase().indexOf(searchTerm);
          const start = Math.max(0, idx - 20);
          const end = Math.min(text.length, idx + searchTerm.length + 20);
          const snippet =
            (start > 0 ? '...' : '') +
            text.slice(start, end) +
            (end < text.length ? '...' : '');

          matches.push({
            id: `result-${pos}`,
            text: snippet,
            nodeType: node.type.name,
            nodeTypeLabel: NODE_TYPE_LABEL_KEYS[node.type.name] || node.type.name,
            sceneName: currentScene,
            pos,
          });
        }
      }

      return true;
    });

    return matches.slice(0, 50); // Limit results
  }, [editor, query, typeFilter, editor?.state.doc]);

  const handleResultClick = useCallback(
    (pos: number) => {
      if (!editor) return;
      editor.commands.setTextSelection(pos + 1);
      editor.commands.scrollIntoView();
      onNavigate?.();
    },
    [editor, onNavigate]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search Input */}
      <div className="p-2 space-y-2 border-b border-border-subtle bg-surface">
        <TextField label={t('sidebar.searchPlaceholder')} type="search" autoFocus value={query} onChange={setQuery} placeholder={t('sidebar.searchPlaceholder')} className="[&_label]:sr-only" />

        {/* Type filter */}
        <SelectField label={t('sidebar.search')} className="[&_label]:sr-only" value={typeFilter} onChange={value => setTypeFilter(value as NodeTypeFilter)}
          options={NODE_TYPE_OPTIONS.map(option => ({ id: option.id, label: t(option.labelKey) }))} />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-2">
        {query.trim() === '' ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Search size={16} className="text-text-secondary mb-2" />
            <p className="text-xs text-text-muted">{t('sidebar.searchHint')}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-xs text-text-muted">{t('sidebar.noResults')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[10px] text-text-muted px-1 mb-2">
              {t('sidebar.resultsCount', { count: results.length })}
            </p>
            {results.map((result) => (
              <Button
                variant="quiet"
                key={result.id}
                type="button"
                onPress={() => handleResultClick(result.pos)}
                className="h-auto items-start whitespace-normal w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-hover-bg transition-colors border border-transparent hover:border-glass-border"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1 py-0.5 rounded bg-surface-inset text-text-secondary shrink-0">
                    {t(result.nodeTypeLabel)}
                  </span>
                  <span className="text-[10px] text-text-muted truncate flex items-center gap-1">
                    <Film size={8} />
                    {result.sceneName}
                  </span>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2 mt-0.5">
                  {result.text}
                </p>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
