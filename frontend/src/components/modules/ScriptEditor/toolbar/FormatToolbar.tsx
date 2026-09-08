'use client';

import { IconButton, SelectField } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { Undo2, Redo2, Pencil, LayoutGrid, BookOpen, Maximize2 } from 'lucide-react';
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
  const formats: ScriptFormat[] = ['hollywood', 'chinese_film', 'chinese_short', 'japanese_anime'];
  const renderings: TextRendering[] = ['latin', 'cjk_zh', 'cjk_ja'];
  const views = [
    { id: 'edit', icon: Pencil }, { id: 'storyboard', icon: LayoutGrid },
    { id: 'read', icon: BookOpen }, { id: 'focus', icon: Maximize2 },
  ] as const;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-surface px-4 py-2" role="group" aria-label={t('toolbar.format')}>
      <div className="grid min-w-0 flex-[1_1_280px] grid-cols-2 gap-2 sm:max-w-80">
        <SelectField label={t('toolbar.format')} className="min-w-0 [&_label]:sr-only" value={currentFormat} onChange={value => setFormat(value as ScriptFormat)} options={formats.map(id => ({ id, label: t(`formats.${id}`) }))} />
        <SelectField label={t('toolbar.rendering')} className="min-w-0 [&_label]:sr-only" value={currentRendering} onChange={value => setRendering(value as TextRendering)} options={renderings.map(id => ({ id, label: t(`renderings.${id}`) }))} />
      </div>
      <div className="flex gap-1">
        <IconButton aria-label={t('toolbar.undo')} isDisabled={!editor?.isEditable || !editor?.can().undo()} onPress={() => editor?.chain().focus().undo().run()}><Undo2 size={16} /></IconButton>
        <IconButton aria-label={t('toolbar.redo')} isDisabled={!editor?.isEditable || !editor?.can().redo()} onPress={() => editor?.chain().focus().redo().run()}><Redo2 size={16} /></IconButton>
      </div>
      <div className="ml-auto flex gap-1" role="group" aria-label={t('toolbar.view')}>
        {views.map(({ id, icon: Icon }) => <IconButton key={id} aria-label={t(`views.${id}`)} aria-pressed={viewMode === id} className={viewMode === id ? 'bg-primary/10 text-primary' : ''} onPress={() => onViewModeChange?.(id)}><Icon size={16} /></IconButton>)}
      </div>
    </div>
  );
}
