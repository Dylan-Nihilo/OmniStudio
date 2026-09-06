'use client';

import { useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { IconButton, SelectField } from '@omnistudio/ui';
import { Lock, Unlock } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Project } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import CharacterPanel from './CharacterPanel';
import ShotPanel from './ShotPanel';
import PipelinePanel from './PipelinePanel';
import LocationPanel from './LocationPanel';
import PropsPanel from './PropsPanel';
import NotesPanel from './NotesPanel';
import L3CompletionPanel from './L3CompletionPanel';

export interface RightPanelContainerProps {
  editor: Editor | null;
  mode?: 'full' | 'embedded' | 'focus';
  projectId?: string;
  project?: Project | null;
  onEnterPipeline?: () => void;
}

type PanelTab = 'characters' | 'shots' | 'pipeline' | 'locations' | 'props' | 'notes' | 'ai';

interface TabDef {
  id: PanelTab;
  label: string;
}

export default function RightPanelContainer({
  editor,
  mode = 'full',
  projectId,
  project,
  onEnterPipeline,
}: RightPanelContainerProps) {
  const t = useTranslations('scriptEditor');
  const activePanel = useEditorStore((s) => s.activeRightPanel);
  const setActivePanel = useEditorStore((s) => s.setActiveRightPanel);
  const panelLocked = useEditorStore((s) => s.rightPanelLocked);
  const setRightPanelLocked = useEditorStore((s) => s.setRightPanelLocked);

  const ALL_TABS: TabDef[] = [
    { id: 'characters', label: t('panels.characters') },
    { id: 'shots', label: t('panels.shots') },
    { id: 'pipeline', label: t('panels.pipeline') },
    { id: 'locations', label: t('panels.locations') },
    { id: 'props', label: t('panels.props') },
    { id: 'notes', label: t('panels.notes') },
    { id: 'ai', label: t('panels.aiCompletion') },
  ];

  const TABS_EMBEDDED: TabDef[] = [
    { id: 'shots', label: t('panels.shots') },
    { id: 'pipeline', label: t('panels.pipeline') },
  ];

  const togglePanelLock = useCallback(() => {
    setRightPanelLocked(!panelLocked);
  }, [panelLocked, setRightPanelLocked]);

  const isEmbedded = mode === 'embedded';
  const tabs = isEmbedded ? TABS_EMBEDDED : ALL_TABS;

  // Map editorStore panel names to our tab IDs
  const currentTab: PanelTab = (() => {
    const valid = tabs.find((t) => t.id === activePanel);
    if (valid) return valid.id;
    // Default fallback
    return isEmbedded ? 'shots' : 'characters';
  })();

  const handleTabChange = useCallback(
    (tab: PanelTab) => {
      setActivePanel(tab as typeof activePanel);
    },
    [setActivePanel]
  );

  // Smart auto-switch: listen to editor selection changes
  useEffect(() => {
    if (!editor || panelLocked) return;

    const handleSelectionUpdate = () => {
      const { $from } = editor.state.selection;

      // Walk up the node tree to find context
      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === 'characterCue') {
          if (!isEmbedded) {
            setActivePanel('characters');
          }
          return;
        }
        if (node.type.name === 'shotBlock') {
          setActivePanel('shots');
          return;
        }
      }
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, panelLocked, isEmbedded, setActivePanel]);


  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle p-3">
        <SelectField label={t('shell.inspector')} className="min-w-0 flex-1 [&_label]:sr-only" value={currentTab} onChange={value => handleTabChange(value as PanelTab)} options={tabs.map(tab => ({ id: tab.id, label: tab.label }))} />
        <IconButton aria-label={panelLocked ? t('panels.unlockPanel') : t('panels.lockPanel')} aria-pressed={panelLocked} onPress={togglePanelLock} className={panelLocked ? 'bg-primary/10 text-primary' : ''}>{panelLocked ? <Lock size={16} /> : <Unlock size={16} />}</IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
            {currentTab === 'characters' && !isEmbedded && (
              <CharacterPanel editor={editor} project={project} />
            )}
            {currentTab === 'shots' && (
              <ShotPanel editor={editor} project={project} />
            )}
            {currentTab === 'pipeline' && (
              <PipelinePanel
                projectId={projectId}
                project={project}
                onEnterPipeline={onEnterPipeline}
              />
            )}
            {currentTab === 'locations' && !isEmbedded && (
              <LocationPanel editor={editor} project={project} />
            )}
            {currentTab === 'props' && !isEmbedded && (
              <PropsPanel editor={editor} project={project} />
            )}
            {currentTab === 'notes' && !isEmbedded && (
              <NotesPanel editor={editor} />
            )}
            {currentTab === 'ai' && !isEmbedded && (
              <L3CompletionPanel />
            )}
      </div>
    </div>
  );
}
