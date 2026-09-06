'use client';

import { SelectField } from "@omnistudio/ui";
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Undo2,
  Redo2,
  Sparkles,
  Download,
  Pencil,
  LayoutGrid,
  BookOpen,
  Maximize2,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useFormatEngine } from '../hooks/useFormatEngine';
import type { ScriptFormat, TextRendering, ViewMode } from '@/store/editorStore';

export interface FormatToolbarProps {
  editor: Editor | null;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

export default function FormatToolbar({ editor, viewMode = 'edit', onViewModeChange }: FormatToolbarProps) {
  const t = useTranslations('scriptEditor');
  const { currentFormat, currentRendering, setFormat, setRendering } = useFormatEngine();

  const FORMAT_OPTIONS: { value: ScriptFormat; label: string }[] = [
    { value: 'hollywood', label: t('formats.hollywood') },
    { value: 'chinese_film', label: t('formats.chinese_film') },
    { value: 'chinese_short', label: t('formats.chinese_short') },
    { value: 'japanese_anime', label: t('formats.japanese_anime') },
  ];

  const RENDERING_OPTIONS: { value: TextRendering; label: string }[] = [
    { value: 'latin', label: t('renderings.latin') },
    { value: 'cjk_zh', label: t('renderings.cjk_zh') },
    { value: 'cjk_ja', label: t('renderings.cjk_ja') },
  ];

  const VIEW_OPTIONS: { value: ViewMode; label: string; icon: typeof Pencil }[] = [
    { value: 'edit', label: t('views.edit'), icon: Pencil },
    { value: 'storyboard', label: t('views.storyboard'), icon: LayoutGrid },
    { value: 'read', label: t('views.read'), icon: BookOpen },
    { value: 'focus', label: t('views.focus'), icon: Maximize2 },
  ];

  const handleUndo = useCallback(() => {
    editor?.chain().focus().undo().run();
  }, [editor]);

  const handleRedo = useCallback(() => {
    editor?.chain().focus().redo().run();
  }, [editor]);

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-glass-border bg-surface px-4">
      {/* Format Selector */}
      <SelectField label={t('toolbar.format')} className="max-w-40 [&>label]:sr-only" value={currentFormat} onChange={value => setFormat(value as ScriptFormat)}
        options={FORMAT_OPTIONS.map(option => ({ id: option.value, label: option.label }))} />

      {/* Rendering Selector */}
      <SelectField label={t('toolbar.rendering')} className="max-w-40 [&>label]:sr-only" value={currentRendering} onChange={value => setRendering(value as TextRendering)}
        options={RENDERING_OPTIONS.map(option => ({ id: option.value, label: option.label }))} />

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-glass-border" />

      {/* Undo / Redo */}
      <button
        type="button"
        onClick={handleUndo}
        disabled={!editor?.can().undo()}
        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={t('toolbar.undo')}
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        onClick={handleRedo}
        disabled={!editor?.can().redo()}
        className="rounded p-1.5 text-text-secondary transition-colors hover:bg-hover-bg hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={t('toolbar.redo')}
      >
        <Redo2 size={15} />
      </button>

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-white/10" />

      {/* AI Tool (placeholder) */}
      <button
        type="button"
        disabled
        className="flex items-center gap-1 rounded px-2 py-1.5 text-xs text-text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t('toolbar.ai')}
      >
        <Sparkles size={14} />
        <span>AI</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* View Mode Toggle */}
      <div className="flex items-center gap-0.5 rounded-md border border-glass-border bg-surface-inset p-0.5">
        {VIEW_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = viewMode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onViewModeChange?.(opt.value)}
              className={`rounded px-2 py-1 text-[11px] transition-all ${
                isActive
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-text-muted hover:text-foreground'
              }`}
              aria-label={opt.label}
              title={opt.label}
            >
              <Icon size={13} />
            </button>
          );
        })}
      </div>

      {/* Export (placeholder) */}
      <button
        type="button"
        disabled
        className="rounded p-1.5 text-text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t('toolbar.export')}
      >
        <Download size={15} />
      </button>
    </div>
  );
}
