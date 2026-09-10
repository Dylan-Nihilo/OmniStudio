'use client';

import { Button, IconButton } from '@omnistudio/ui';
import { useMemo, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Check, X, RefreshCw, Loader2 } from 'lucide-react';
import { useEditorStore, type L3Result } from '@/store/editorStore';
import { scriptEditorApi } from '@/lib/scriptEditorApi';

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
  onAccept,
  onReject,
  isAccepting,
  confidenceLabel,
  acceptLabel,
  rejectLabel,
  sceneLabel,
}: {
  item: L3Result;
  onAccept: () => void;
  onReject: () => void;
  isAccepting: boolean;
  confidenceLabel: string;
  acceptLabel: string;
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
            onPress={onAccept}
            aria-label={`${acceptLabel}: ${item.name}`}
            isPending={isAccepting}
            isDisabled={isAccepting}
          >
            {!isAccepting && <Check size={12} />}
          </IconButton>
          <IconButton
            type="button"
            onPress={onReject}
            aria-label={`${rejectLabel}: ${item.name}`}
            isDisabled={isAccepting}
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
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const projectId = useEditorStore((s) => s.projectId);
  const l3Status = useEditorStore((s) => s.l3Status);
  const l3Results = useEditorStore((s) => s.l3Results);
  const l3AcceptedResults = useEditorStore((s) => s.l3AcceptedResults);
  const derivedScenes = useEditorStore((s) => s.derivedScenes);
  const derivedCharacters = useEditorStore((s) => s.derivedCharacters);
  const estimatedDuration = useEditorStore((s) => s.estimatedDuration);
  const wordCount = useEditorStore((s) => s.wordCount);
  const confidenceScore = useEditorStore((s) => s.confidenceScore);
  const setL3Results = useEditorStore((s) => s.setL3Results);
  const setL3AcceptedResults = useEditorStore((s) => s.setL3AcceptedResults);
  const updateDerivation = useEditorStore((s) => s.updateDerivation);
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

  const handleAccept = useCallback(
    async (item: L3Result) => {
      if (!l3Results) return;

      const resultKey = `${item.type}:${item.name}`;
      if (acceptingKey === resultKey) return;
      setAcceptingKey(resultKey);

      const accepted = l3AcceptedResults.some(
        (result) => result.type === item.type && result.name.toLowerCase() === item.name.toLowerCase()
      )
        ? l3AcceptedResults
        : [...l3AcceptedResults, item];

      const nextCharacters =
        item.type === 'character' &&
        !derivedCharacters.some((character) => character.name.toLowerCase() === item.name.toLowerCase())
          ? [
              ...derivedCharacters,
              {
                id: item.name.trim().toLowerCase().replace(/\s+/g, '-'),
                name: item.name.trim(),
                occurrences: 1,
                firstAppearance: (item.sceneIndex ?? 0) + 1,
              },
            ]
          : derivedCharacters;

      const l3Supplements = accepted.map(({ sceneIndex, ...result }) => ({
        ...result,
        ...(sceneIndex !== undefined ? { scene_index: sceneIndex } : {}),
      }));

      try {
        if (projectId) {
          await scriptEditorApi.syncDerivation(projectId, {
            scenes: derivedScenes,
            characters: nextCharacters,
            locations: derivedScenes
              .map((scene) => scene.location)
              .filter((location): location is string => Boolean(location)),
            estimated_duration: estimatedDuration,
            word_count: wordCount,
            confidence_score: confidenceScore,
            l3_supplements: l3Supplements,
          });
        }

        if (nextCharacters !== derivedCharacters) {
          updateDerivation({ characters: nextCharacters });
        }
        setL3AcceptedResults(accepted);
        const updated = l3Results.filter(
          (result) => !(result.type === item.type && result.name === item.name)
        );
        setL3Results(updated.length > 0 ? updated : null);
      } catch (error) {
        console.warn('[L3Completion] accepting supplement failed:', error);
      } finally {
        setAcceptingKey(null);
      }
    },
    [
      acceptingKey,
      confidenceScore,
      derivedCharacters,
      derivedScenes,
      estimatedDuration,
      l3AcceptedResults,
      l3Results,
      projectId,
      setL3AcceptedResults,
      setL3Results,
      updateDerivation,
      wordCount,
    ]
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
                    onAccept={() => void handleAccept(item)}
                    onReject={() => handleReject(item)}
                    isAccepting={acceptingKey === `${item.type}:${item.name}`}
                    confidenceLabel={t('panels.aiConfidence')}
                    acceptLabel={t('panels.aiAccept')}
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
