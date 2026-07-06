'use client';

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Camera, Workflow } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '@/store/editorStore';
import CharacterPanel from './CharacterPanel';
import ShotPanel from './ShotPanel';
import PipelinePanel from './PipelinePanel';

export interface RightPanelContainerProps {
  editor: Editor | null;
  mode?: 'full' | 'embedded' | 'focus';
  projectId?: string;
  onEnterPipeline?: () => void;
}

type PanelTab = 'characters' | 'shots' | 'pipeline';

const TABS_FULL: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'characters', label: '角色', icon: <Users size={14} /> },
  { id: 'shots', label: '镜头', icon: <Camera size={14} /> },
  { id: 'pipeline', label: '管线', icon: <Workflow size={14} /> },
];

const TABS_EMBEDDED: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'shots', label: '镜头', icon: <Camera size={14} /> },
  { id: 'pipeline', label: '管线', icon: <Workflow size={14} /> },
];

export default function RightPanelContainer({
  editor,
  mode = 'full',
  projectId,
  onEnterPipeline,
}: RightPanelContainerProps) {
  const activePanel = useEditorStore((s) => s.activeRightPanel);
  const setActivePanel = useEditorStore((s) => s.setActiveRightPanel);
  const panelLocked = useEditorStore((s) => s.rightPanelLocked);

  const isEmbedded = mode === 'embedded';
  const tabs = isEmbedded ? TABS_EMBEDDED : TABS_FULL;

  // Map editorStore panel names to our tab IDs
  const currentTab: PanelTab = (() => {
    if (activePanel === 'characters' && !isEmbedded) return 'characters';
    if (activePanel === 'shots') return 'shots';
    if (activePanel === 'pipeline') return 'pipeline';
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
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={`relative flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
              currentTab === tab.id
                ? 'text-foreground'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.icon}
            {tab.label}
            {currentTab === tab.id && (
              <motion.div
                layoutId="panel-tab-indicator"
                className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
          >
            {currentTab === 'characters' && !isEmbedded && (
              <CharacterPanel editor={editor} />
            )}
            {currentTab === 'shots' && (
              <ShotPanel editor={editor} />
            )}
            {currentTab === 'pipeline' && (
              <PipelinePanel
                projectId={projectId}
                onEnterPipeline={onEnterPipeline}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
