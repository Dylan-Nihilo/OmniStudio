'use client';

import { useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Film, Camera, Plus, Eye } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '@/store/editorStore';

export interface ShotPanelProps {
  editor: Editor | null;
}

type ShotStatus = 'suggested' | 'reviewing' | 'confirmed' | 'queued' | 'generating' | 'done' | 'failed';

interface ShotBlockData {
  id: string;
  shotNumber: number;
  shotType: string;
  status: ShotStatus;
  description?: string;
  pos: number;
}

const STATUS_CONFIG: Record<ShotStatus, { label: string; className: string }> = {
  suggested: { label: '建议', className: 'bg-zinc-600/50 text-zinc-300' },
  reviewing: { label: '审阅', className: 'bg-blue-600/30 text-blue-300' },
  confirmed: { label: '确认', className: 'bg-green-600/30 text-green-300' },
  queued: { label: '排队', className: 'bg-yellow-600/30 text-yellow-300' },
  generating: { label: '生成中', className: 'bg-orange-600/30 text-orange-300 animate-pulse' },
  done: { label: '完成 ✓', className: 'bg-green-600/40 text-green-200' },
  failed: { label: '失败', className: 'bg-red-600/30 text-red-300' },
};

function ShotCard({
  shot,
  onClick,
}: {
  shot: ShotBlockData;
  onClick: () => void;
}) {
  const config = STATUS_CONFIG[shot.status] || STATUS_CONFIG.suggested;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-lg border border-white/10 bg-zinc-800/80 p-3 cursor-pointer hover:border-white/20 hover:bg-zinc-800 transition-colors"
      onClick={onClick}
    >
      {/* Thumbnail placeholder */}
      <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-zinc-900 border border-white/5">
        <Camera size={14} className="text-zinc-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">#{shot.shotNumber}</span>
          {shot.shotType && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">
              {shot.shotType}
            </span>
          )}
        </div>
        {shot.description && (
          <p className="text-xs text-text-muted mt-0.5 truncate">{shot.description}</p>
        )}
      </div>

      {/* Status badge */}
      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${config.className}`}>
        {config.label}
      </span>
    </motion.div>
  );
}

export default function ShotPanel({ editor }: ShotPanelProps) {
  const derivedScenes = useEditorStore((s) => s.derivedScenes);

  // Extract ShotBlock nodes from editor JSON
  const shotBlocks = useMemo<ShotBlockData[]>(() => {
    if (!editor) return [];

    const shots: ShotBlockData[] = [];
    let shotNumber = 1;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'shotBlock') {
        shots.push({
          id: node.attrs.id || `shot-${pos}`,
          shotNumber: node.attrs.shotNumber ?? shotNumber,
          shotType: node.attrs.shotType || '',
          status: (node.attrs.status as ShotStatus) || 'suggested',
          description: node.attrs.description || node.textContent?.slice(0, 60) || '',
          pos,
        });
        shotNumber++;
      }
    });

    return shots;
  }, [editor, editor?.state.doc]);

  const handleShotClick = useCallback(
    (shot: ShotBlockData) => {
      if (!editor) return;
      // Jump to the shot position in the editor
      editor.chain().focus().setTextSelection(shot.pos + 1).scrollIntoView().run();
    },
    [editor]
  );

  const handleAddShot = useCallback(() => {
    if (!editor) return;
    // Insert a new ShotBlock node at the end of the current selection
    editor.chain().focus().insertContent({
      type: 'shotBlock',
      attrs: { status: 'suggested', shotType: '' },
      content: [{ type: 'paragraph' }],
    }).run();
  }, [editor]);

  if (shotBlocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 mb-3">
          <Film size={20} className="text-zinc-500" />
        </div>
        <p className="text-sm text-text-muted">当前场景暂无镜头</p>
        <p className="text-xs text-text-muted/60 mt-1">添加 ShotBlock 节点以拆分镜头</p>
        <button
          type="button"
          onClick={handleAddShot}
          className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-sm text-foreground transition-colors"
        >
          <Plus size={14} />
          添加镜头
        </button>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-text-muted" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            镜头 ({shotBlocks.length})
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {shotBlocks.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            onClick={() => handleShotClick(shot)}
          />
        ))}
      </div>

      {/* Add shot button */}
      <button
        type="button"
        onClick={handleAddShot}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/10 py-2.5 text-sm text-text-muted hover:text-foreground hover:border-white/20 transition-colors"
      >
        <Plus size={14} />
        添加镜头
      </button>
    </div>
  );
}
