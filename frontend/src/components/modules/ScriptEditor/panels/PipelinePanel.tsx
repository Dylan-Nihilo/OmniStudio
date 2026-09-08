'use client';

import { Button } from '@omnistudio/ui';
import { Clapperboard, Users, Clock, FileText, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/store/projectStore';

export interface PipelinePanelProps {
  projectId?: string;
  project?: Project | null;
  onEnterPipeline?: () => void;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded bg-surface-inset">
        {icon}
      </div>
      <div>
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function formatDuration(seconds: number, t: (key: string, values?: Record<string, any>) => string): string {
  if (seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return t('panels.durationSeconds', { count: secs });
  if (secs > 0) return t('panels.durationMinSec', { min: mins, sec: secs });
  return t('panels.durationMin', { min: mins });
}

export default function PipelinePanel({ project, onEnterPipeline }: PipelinePanelProps) {
  const t = useTranslations('scriptEditor');
  const derivedScenes = useEditorStore((s) => s.derivedScenes);
  const derivedCharacters = useEditorStore((s) => s.derivedCharacters);
  const estimatedDuration = useEditorStore((s) => s.estimatedDuration);
  const wordCount = useEditorStore((s) => s.wordCount);
  const editorMode = useEditorStore((s) => s.editorMode);

  const isEmbedded = editorMode === 'embedded';
  const sceneCount = project?.scenes?.length ?? derivedScenes.length;
  const characterCount = project?.characters?.length ?? derivedCharacters.length;

  return (
    <div className="p-3 space-y-4">
      {/* Overview stats */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clapperboard size={14} className="text-text-muted" />
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t('panels.statsOverview')}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            icon={<Clapperboard size={13} className="text-text-secondary" />}
            label={t('panels.statScenes')}
            value={sceneCount}
          />
          <StatCard
            icon={<Users size={13} className="text-text-secondary" />}
            label={t('panels.statCharacters')}
            value={characterCount}
          />
          <StatCard
            icon={<Clock size={13} className="text-text-secondary" />}
            label={t('panels.statDuration')}
            value={formatDuration(estimatedDuration, t)}
          />
          <StatCard
            icon={<FileText size={13} className="text-text-secondary" />}
            label={t('panels.statWordCount')}
            value={wordCount.toLocaleString()}
          />
        </div>
      </div>

      {/* Enter pipeline CTA - hidden in embedded mode */}
      {!isEmbedded && onEnterPipeline && (
        <Button
          type="button"
          onPress={onEnterPipeline}
          className="w-full"
        >
          {t('panels.enterPipeline')}
          <ArrowRight size={16} />
        </Button>
      )}

    </div>
  );
}
