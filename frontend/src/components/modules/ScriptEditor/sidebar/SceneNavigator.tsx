'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { ActionMenu, Button } from '@omnistudio/ui';
import { Film } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useEditorStore, type DerivedScene } from '@/store/editorStore';

export interface SceneNavigatorProps { editor: Editor | null; onNavigate?: () => void; }
const COLOR_OPTIONS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4'];

export default function SceneNavigator({ editor, onNavigate }: SceneNavigatorProps) {
  const t = useTranslations('scriptEditor');
  const derivedScenes = useEditorStore(s => s.derivedScenes);
  const [sceneColors, setSceneColors] = useState<Record<string, string | null>>({});
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const handleSceneSelect = useCallback(
    (scene: DerivedScene) => {
      setActiveSceneId(scene.id);
      if (!editor) return;

      // Dispatch event to auto-unfold the target scene if it's collapsed
      document.dispatchEvent(
        new CustomEvent('script-editor:navigate-to-scene', {
          detail: { sceneId: scene.id },
        })
      );

      // Find the scene heading node position
      const doc = editor.state.doc;
      let targetPos: number | null = null;

      doc.descendants((node, pos) => {
        if (node.type.name === 'sceneHeading' && targetPos === null) {
          const nodeId = node.attrs.id as string | null;
          if (nodeId === scene.id) {
            targetPos = pos;
          } else {
            const text = node.textContent;
            if (scene.title && text.includes(scene.title)) {
              targetPos = pos;
            } else if (scene.location && text.includes(scene.location)) {
              targetPos = pos;
            }
          }
        }
        return targetPos === null;
      });

      if (targetPos !== null) {
        editor.commands.setTextSelection(targetPos + 1);
        editor.commands.scrollIntoView();
        onNavigate?.();
      }
    },
    [editor, onNavigate]
  );


  if (derivedScenes.length === 0) return <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-text-muted"><Film size={16} /><p className="text-xs">{t('sidebar.noScenes')}</p></div>;
  return <div className="space-y-1 p-2">
    {derivedScenes.map(scene => <div key={scene.id} className={`flex items-center rounded-lg ${activeSceneId === scene.id ? 'bg-selected-bg' : ''}`}>
      <Button variant="quiet" className="h-auto min-h-10 min-w-0 flex-1 justify-start px-2 text-left" aria-pressed={activeSceneId === scene.id} onPress={() => handleSceneSelect(scene)}>
        {scene.number != null && <span className="shrink-0 font-mono text-xs text-text-muted">#{scene.number}</span>}
        {scene.intExt && <span className="shrink-0 text-xs text-text-muted">{scene.intExt}</span>}
        <span className="truncate text-sm">{scene.location || scene.title || t('sidebar.untitled')}</span>
      </Button>
      <ActionMenu label={t('sidebar.sceneColor')} icon={<span className="h-3 w-3 rounded-full border border-border-subtle" style={{backgroundColor: sceneColors[scene.id] || 'transparent'}} />} items={[
        ...COLOR_OPTIONS.map((color,index) => ({ id: color, label: t(`sidebar.colors.${index}`), icon: <span className="h-3 w-3 rounded-full" style={{backgroundColor:color}} />, onAction: () => setSceneColors(previous => ({...previous, [scene.id]: color})) })),
        { id: 'clear', label: t('sidebar.clearColor'), onAction: () => setSceneColors(previous => ({...previous, [scene.id]: null})) },
      ]} />
    </div>)}
  </div>;
}
