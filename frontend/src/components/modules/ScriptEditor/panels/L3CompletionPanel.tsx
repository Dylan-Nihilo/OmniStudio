'use client';

import { Button, IconButton } from '@omnistudio/ui';
import { useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Check, X, RefreshCw, Loader2 } from 'lucide-react';
import { useEditorStore, type L3Result } from '@/store/editorStore';

type ResultGroup = {
  type: L3Result['type'];
  label: string;
  items: L3Result[];
};

function ConfidenceBadge({ value, label }: { value: number; label: string }) {
  const color =
    value > 0.8
      ? 'bg-status-done-bg text-status-done-fg border-status-done-border'
      : value > 0.6
        ? 'bg-status-warning-bg text-status-warning-fg border-status-warning-border'
        : 'bg-status-failed-bg text-status-failed-fg border-status-failed-border';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${color}`}
    >
      {label} {Math.round(value * 100)}%
    </span>
  );
}

function ResultCard({
  item,
  onReject,
  confidenceLabel,
  rejectLabel,
  sceneLabel,
}: {
  item: L3Result;
  onReject: () => void;
  confidenceLabel: string;
  rejectLabel: string;
  sceneLabel: string;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="group rounded-lg border border-glass-border bg-surface p-3 hover:border-primary/40 hover:bg-hover-bg transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
          {item.description && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{item.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <ConfidenceBadge value={item.confidence} label={confidenceLabel} />
            {item.sceneIndex !== undefined && (
              <span className="text-[10px] text-text-muted bg-surface-inset rounded px-1.5 py-0.5">
                {sceneLabel} {item.sceneIndex + 1}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            type="button"
            onPress={onReject}
            aria-label={rejectLabel}

          >
            <X size={12} />
          </IconButton>
        </div>
      </div>
    </motion.div>
  );
}

export default function L3CompletionPanel() {
  const t = useTranslations('scriptEditor');
  const l3Status = useEditorStore((s) => s.l3Status);
  const l3Results = useEditorStore((s) => s.l3Results);
  const setL3Results = useEditorStore((s) => s.setL3Results);
  const setL3Status = useEditorStore((s) => s.setL3Status);
  const setL3LastFetchTime = useEditorStore((s) => s.setL3LastFetchTime);

  const groupedResults: ResultGroup[] = useMemo(() => {
    if (!l3Results || l3Results.length === 0) return [];

    const groupMap: Record<L3Result['type'], L3Result[]> = {
      character: [],
      prop: [],
      beat: [],
      location: [],
    };

    for (const item of l3Results) {
      groupMap[item.type].push(item);
    }

    const typeLabels: Record<L3Result['type'], string> = {
      character: t('panels.characters'),
      prop: t('panels.props'),
      beat: t('panels.shots'),
      location: t('panels.locations'),
    };

    return Object.entries(groupMap)
      .filter(([, items]) => items.length > 0)
      .map(([type, items]) => ({
        type: type as L3Result['type'],
        label: typeLabels[type as L3Result['type']],
        items,
      }));
  }, [l3Results, t]);

  const handleReject = useCallback(
    (item: L3Result) => {
      if (!l3Results) return;
      const updated = l3Results.filter(
        (r) => !(r.type === item.type && r.name === item.name)
      );
      setL3Results(updated.length > 0 ? updated : null);
    },
    [l3Results, setL3Results]
  );

  const handleRetry = useCallback(() => {
    // Reset status to trigger re-fetch
    setL3Status('idle');
    setL3LastFetchTime(null);
  }, [setL3Status, setL3LastFetchTime]);

  // Status: idle
  if (l3Status === 'idle' && (!l3Results || l3Results.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset mb-3">
          <Sparkles size={20} className="text-text-secondary" />
        </div>
        <p className="text-sm text-text-muted">{t('panels.aiIdle')}</p>
      </div>
    );
  }

  // Status: loading
  if (l3Status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset mb-3">
          <Loader2 size={20} className="text-primary animate-spin" />
        </div>
        <p className="text-sm text-text-muted">{t('panels.aiLoading')}</p>
      </div>
    );
  }

  // Status: error
  if (l3Status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-failed-bg mb-3">
          <X size={20} className="text-status-failed-fg" />
        </div>
        <p className="text-sm text-text-muted">{t('panels.aiError')}</p>
        <Button variant="secondary"
          type="button"
          onPress={handleRetry}
          className="mt-3 flex items-center gap-1.5 rounded-md bg-surface-inset px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover-bg transition-colors"
        >
          <RefreshCw size={12} />
          {t('panels.aiRetry')}
        </Button>
      </div>
    );
  }

  // Status: success but empty
  if (l3Status === 'success' && (!l3Results || l3Results.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset mb-3">
          <Check size={20} className="text-text-secondary" />
        </div>
        <p className="text-sm text-text-muted">{t('panels.aiEmpty')}</p>
      </div>
    );
  }

  // Results view
  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} className="text-primary" />
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t('panels.aiCompletion')}
        </span>
      </div>

      <div className="space-y-4">
        {groupedResults.map((group) => (
          <div key={group.type}>
            <p className="text-xs font-medium text-text-muted mb-2">
              {group.label} ({group.items.length})
            </p>
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {group.items.map((item) => (
                  <ResultCard
                    key={`${item.type}-${item.name}`}
                    item={item}
                    onReject={() => handleReject(item)}
                    confidenceLabel={t('panels.aiConfidence')}
                    rejectLabel={t('panels.aiReject')}
                    sceneLabel={t('panels.sceneLabel', { number: '' }).trim()}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
