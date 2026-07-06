'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, X, Film } from 'lucide-react';
import type { Editor } from '@tiptap/react';

export interface SearchPanelProps {
  editor: Editor | null;
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

const NODE_TYPE_OPTIONS: { id: NodeTypeFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'sceneHeading', label: '场景标题' },
  { id: 'characterCue', label: '角色' },
  { id: 'dialogue', label: '对白' },
  { id: 'action', label: '动作' },
  { id: 'note', label: '笔记' },
];

const NODE_TYPE_LABELS: Record<string, string> = {
  sceneHeading: '场景',
  characterCue: '角色',
  dialogue: '对白',
  action: '动作',
  note: '笔记',
  paragraph: '段落',
};

export default function SearchPanel({ editor }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NodeTypeFilter>('all');

  const results = useMemo<SearchResult[]>(() => {
    if (!editor || !query.trim()) return [];

    const searchTerm = query.trim().toLowerCase();
    const matches: SearchResult[] = [];
    const doc = editor.state.doc;
    let currentScene = '未知场景';

    doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        currentScene = node.textContent || '未命名场景';
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
            nodeTypeLabel: NODE_TYPE_LABELS[node.type.name] || node.type.name,
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
    },
    [editor]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search Input */}
      <div className="p-2 space-y-2 border-b border-white/5">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索内容..."
            className="w-full rounded-lg bg-zinc-800 border border-white/10 py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:border-indigo-500/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as NodeTypeFilter)}
          className="w-full rounded-lg bg-zinc-800 border border-white/10 py-1.5 px-2 text-xs text-foreground focus:outline-none focus:border-indigo-500/50"
        >
          {NODE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-2">
        {query.trim() === '' ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Search size={16} className="text-zinc-500 mb-2" />
            <p className="text-xs text-text-muted">输入关键词搜索</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-xs text-text-muted">无匹配结果</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-[10px] text-text-muted px-1 mb-2">
              {results.length} 个结果
            </p>
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => handleResultClick(result.pos)}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-white/5 transition-colors border border-transparent hover:border-white/10"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-700 text-zinc-300 shrink-0">
                    {result.nodeTypeLabel}
                  </span>
                  <span className="text-[10px] text-text-muted truncate flex items-center gap-1">
                    <Film size={8} />
                    {result.sceneName}
                  </span>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2 mt-0.5">
                  {result.text}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
