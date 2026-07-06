'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ChevronDown } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { useEditorStore, type DerivedScene } from '@/store/editorStore';

export interface LocationPanelProps {
  editor: Editor | null;
}

interface LocationEntry {
  name: string;
  scenes: DerivedScene[];
}

function LocationCard({ entry }: { entry: LocationEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      className="rounded-lg border border-white/10 bg-zinc-800/80 p-3 cursor-pointer hover:border-white/20 hover:bg-zinc-800 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700">
          <MapPin size={14} className="text-zinc-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{entry.name}</p>
          <span className="text-xs text-text-muted">{entry.scenes.length} 个场景</span>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={14} className="text-text-muted" />
        </motion.div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-2 border-t border-white/5">
              <p className="text-xs text-text-muted mb-1.5">关联场景</p>
              <ul className="space-y-1">
                {entry.scenes.map((scene) => (
                  <li
                    key={scene.id}
                    className="text-xs text-text-secondary px-2 py-1 rounded bg-zinc-900/50"
                  >
                    {scene.number != null ? `#${scene.number} ` : ''}
                    {scene.title || '无标题场景'}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function LocationPanel({ editor }: LocationPanelProps) {
  const derivedScenes = useEditorStore((s) => s.derivedScenes);

  const locations = useMemo<LocationEntry[]>(() => {
    const map = new Map<string, DerivedScene[]>();
    for (const scene of derivedScenes) {
      if (scene.location) {
        const key = scene.location.trim();
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key)!.push(scene);
      }
    }
    return Array.from(map.entries()).map(([name, scenes]) => ({ name, scenes }));
  }, [derivedScenes]);

  if (locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 mb-3">
          <MapPin size={20} className="text-zinc-500" />
        </div>
        <p className="text-sm text-text-muted">添加场景标题后地点将自动提取</p>
        <p className="text-xs text-text-muted/60 mt-1">
          场景标题格式：内/外. 地点 - 时间
        </p>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <MapPin size={14} className="text-text-muted" />
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          地点 ({locations.length})
        </span>
      </div>
      <div className="space-y-2">
        {locations.map((entry) => (
          <LocationCard key={entry.name} entry={entry} />
        ))}
      </div>
    </div>
  );
}
