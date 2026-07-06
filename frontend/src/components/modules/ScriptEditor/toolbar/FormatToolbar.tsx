'use client';

import { useCallback } from 'react';
import {
  Undo2,
  Redo2,
  Sparkles,
  Columns2,
  Download,
  ChevronDown,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useFormatEngine } from '../hooks/useFormatEngine';
import type { ScriptFormat, TextRendering } from '@/store/editorStore';

export interface FormatToolbarProps {
  editor: Editor | null;
}

const FORMAT_OPTIONS: { value: ScriptFormat; label: string }[] = [
  { value: 'hollywood', label: 'Hollywood' },
  { value: 'chinese_film', label: '中国电影剧本' },
  { value: 'chinese_short', label: '中国短剧剧本' },
  { value: 'japanese_anime', label: '日本アニメ' },
];

const RENDERING_OPTIONS: { value: TextRendering; label: string }[] = [
  { value: 'latin', label: 'Latin (Courier)' },
  { value: 'cjk_zh', label: '中文 (宋体)' },
  { value: 'cjk_ja', label: '日本語 (明朝)' },
];

export default function FormatToolbar({ editor }: FormatToolbarProps) {
  const { currentFormat, currentRendering, setFormat, setRendering } = useFormatEngine();

  const handleUndo = useCallback(() => {
    editor?.chain().focus().undo().run();
  }, [editor]);

  const handleRedo = useCallback(() => {
    editor?.chain().focus().redo().run();
  }, [editor]);

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-900/80 px-4">
      {/* Format Selector */}
      <div className="relative">
        <select
          value={currentFormat}
          onChange={(e) => setFormat(e.target.value as ScriptFormat)}
          className="appearance-none rounded-md border border-white/10 bg-zinc-800 px-3 py-1.5 pr-7 text-xs text-zinc-200 outline-none transition-colors hover:border-white/20 focus:border-[var(--color-primary)]"
        >
          {FORMAT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
        />
      </div>

      {/* Rendering Selector */}
      <div className="relative">
        <select
          value={currentRendering}
          onChange={(e) => setRendering(e.target.value as TextRendering)}
          className="appearance-none rounded-md border border-white/10 bg-zinc-800 px-3 py-1.5 pr-7 text-xs text-zinc-200 outline-none transition-colors hover:border-white/20 focus:border-[var(--color-primary)]"
        >
          {RENDERING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
        />
      </div>

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* Undo / Redo */}
      <button
        type="button"
        onClick={handleUndo}
        disabled={!editor?.can().undo()}
        className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="撤销"
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        onClick={handleRedo}
        disabled={!editor?.can().redo()}
        className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="重做"
      >
        <Redo2 size={15} />
      </button>

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* AI Tool (placeholder) */}
      <button
        type="button"
        disabled
        className="flex items-center gap-1 rounded px-2 py-1.5 text-xs text-zinc-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="AI 工具"
      >
        <Sparkles size={14} />
        <span>AI</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* View Toggle (placeholder) */}
      <button
        type="button"
        disabled
        className="rounded p-1.5 text-zinc-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="视图切换"
      >
        <Columns2 size={15} />
      </button>

      {/* Export (placeholder) */}
      <button
        type="button"
        disabled
        className="rounded p-1.5 text-zinc-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="导出"
      >
        <Download size={15} />
      </button>
    </div>
  );
}
