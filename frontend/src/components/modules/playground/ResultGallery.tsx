'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, Grid3x3, GalleryHorizontal } from 'lucide-react';
import { Button, IconButton } from '@omnistudio/ui';
import styles from './PlaygroundPage.module.css';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';
import { playgroundApi } from '@/lib/api';
import ResultCard from './ResultCard';
import GalleryView from './GalleryView';
import DetailPanel from './DetailPanel';
import QueuePanel from './QueuePanel';

type FilterType = 'all' | 'image' | 'video';

const VIDEO_MODES = new Set(['t2v', 'i2v', 'r2v', 'v2v']);

function formatSessionLabel(
  dateStr: string,
  todayLabel: string,
  yesterdayLabel: string,
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');

  if (itemDay.getTime() === today.getTime()) {
    return `${todayLabel} · ${hh}:${mm}`;
  }
  if (itemDay.getTime() === yesterday.getTime()) {
    return `${yesterdayLabel} · ${hh}:${mm}`;
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day} · ${hh}:${mm}`;
}

export default function ResultGallery() {
  const { history, queue, enqueueRequest, useResultAsReference } = usePlaygroundStore();
  const t = useTranslations('playground');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'gallery'>('gallery');
  const [detailGen, setDetailGen] = useState<PlaygroundGeneration | null>(null);
  const [detailOutputId, setDetailOutputId] = useState<string | undefined>(undefined);

  const handleOpenDetail = useCallback((gen: PlaygroundGeneration, outputId?: string) => {
    setDetailGen(gen);
    setDetailOutputId(outputId);
  }, []);

  const handleRetry = useCallback((gen: PlaygroundGeneration) => {
    enqueueRequest({ mode: gen.mode, modelId: gen.model_id, prompt: gen.prompt,
      negativePrompt: gen.negative_prompt, inputMedia: gen.input_media,
      parameters: gen.parameters, batchSize: gen.batch_size });
  }, [enqueueRequest]);

  const handleDelete = useCallback(async (gen: PlaygroundGeneration) => {
    try {
      await playgroundApi.deleteGeneration(gen.id);
      usePlaygroundStore.getState().removeGeneration(gen.id);
    } catch (err) {
      console.error('[Playground] Delete failed:', err);
    }
  }, []);

  // Image result → "Generate video": set the image as i2v reference and switch mode.
  const handleGenerateVideo = useCallback(
    (mediaPath: string) => useResultAsReference(mediaPath, 'image', 'i2v'),
    [useResultAsReference],
  );

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return history;
    if (activeFilter === 'image') {
      return history.filter((g) => !VIDEO_MODES.has(g.mode));
    }
    return history.filter((g) => VIDEO_MODES.has(g.mode));
  }, [history, activeFilter]);

  // Sort descending by created_at
  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filtered],
  );

  // Build items with session dividers
  const itemsWithDividers = useMemo(() => {
    const result: Array<
      | { type: 'generation'; data: PlaygroundGeneration }
      | { type: 'divider'; label: string; key: string }
    > = [];

    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prevTime = new Date(sorted[i - 1].created_at).getTime();
        const currTime = new Date(sorted[i].created_at).getTime();
        const gap = prevTime - currTime; // prev is more recent (descending)
        if (gap > 30 * 60 * 1000) {
          result.push({
            type: 'divider',
            label: formatSessionLabel(
              sorted[i].created_at,
              t('results.today'),
              t('results.yesterday'),
            ),
            key: `divider-${sorted[i].id}`,
          });
        }
      }
      result.push({ type: 'generation', data: sorted[i] });
    }

    return result;
  }, [sorted, t]);

  // Flat list of generation data items (no dividers) for GalleryView and DetailPanel
  const dataItems = useMemo(
    () =>
      itemsWithDividers
        .filter((item): item is { type: 'generation'; data: PlaygroundGeneration } => item.type === 'generation')
        .map((item) => item.data),
    [itemsWithDividers],
  );

  // Grid items: expand each completed generation into one tile per output (so
  // multi-output batches show all N); keep pending/processing/failed as one card.
  const gridItems = useMemo(() => {
    const out: Array<
      | { kind: 'divider'; label: string; key: string }
      | { kind: 'output'; gen: PlaygroundGeneration; outputIndex: number }
      | { kind: 'gen'; gen: PlaygroundGeneration }
    > = [];
    for (const item of itemsWithDividers) {
      if (item.type === 'divider') {
        out.push({ kind: 'divider', label: item.label, key: item.key });
        continue;
      }
      const g = item.data;
      if (g.status === 'completed' && g.outputs.length > 0) {
        g.outputs.forEach((_, i) => out.push({ kind: 'output', gen: g, outputIndex: i }));
      } else {
        out.push({ kind: 'gen', gen: g });
      }
    }
    return out;
  }, [itemsWithDividers]);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: t('results.filterAll') },
    { key: 'image', label: t('results.filterImage') },
    { key: 'video', label: t('results.filterVideo') },
  ];

  if (history.length === 0) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {queue.length > 0 && (
          <div className="flex shrink-0 justify-end border-b border-border-subtle px-7 py-4">
            <QueuePanel />
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <Sparkles className="w-12 h-12 text-text-muted opacity-40 mb-4" />
          <p className="font-display atelier-display text-base text-foreground mb-1">
            {t('results.emptyTitle')}
          </p>
          <p className="text-xs text-text-muted">{t('results.emptyBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-w-0">
      <header className={styles.resultToolbar}>
        <h2>{t('results.title')}<span>{filtered.reduce((n, g) => n + g.outputs.length, 0)}</span></h2>
        <div className={styles.resultActions}>
          <div className={styles.filters}>{filters.map(f => <Button key={f.key} variant="quiet" aria-pressed={activeFilter === f.key} onPress={() => setActiveFilter(f.key)}>{f.label}</Button>)}</div>
          <IconButton variant="quiet" aria-label={t('results.gridView')} aria-pressed={viewMode === 'grid'} onPress={() => setViewMode('grid')}><Grid3x3 size={16} /></IconButton>
          <IconButton variant="quiet" aria-label={t('results.galleryView')} aria-pressed={viewMode === 'gallery'} onPress={() => setViewMode('gallery')}><GalleryHorizontal size={16} /></IconButton>
          <QueuePanel />
        </div>
      </header>

      {/* Content area */}
      {viewMode === 'gallery' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <GalleryView
            generations={dataItems}
            onOpenDetail={handleOpenDetail}
            onRetry={handleRetry}
            onDelete={handleDelete}
            onGenerateVideo={handleGenerateVideo}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-5">
          <div className={styles.resultGrid}>
            {gridItems.map((it) => {
              if (it.kind === 'divider') {
                return (
                  <div
                    key={it.key}
                    className="col-span-full flex items-center gap-3 py-2"
                  >
                    <div className="flex-1 h-px bg-border-subtle" />
                    <span className="font-mono text-[0.5625rem] text-text-muted uppercase tracking-wider whitespace-nowrap">
                      {it.label}
                    </span>
                    <div className="flex-1 h-px bg-border-subtle" />
                  </div>
                );
              }
              if (it.kind === 'output') {
                return (
                  <ResultCard
                    key={`${it.gen.id}-${it.outputIndex}`}
                    generation={it.gen}
                    outputIndex={it.outputIndex}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                    onGenerateVideo={handleGenerateVideo}
                    onOpenDetail={handleOpenDetail}
                  />
                );
              }
              return (
                <ResultCard
                  key={it.gen.id}
                  generation={it.gen}
                  onRetry={handleRetry}
                  onDelete={handleDelete}
                  onGenerateVideo={handleGenerateVideo}
                  onOpenDetail={handleOpenDetail}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Detail Panel */}
      {detailGen && (
        <DetailPanel
          generation={detailGen}
          allGenerations={dataItems}
          focusOutputId={detailOutputId}
          onClose={() => { setDetailGen(null); setDetailOutputId(undefined); }}
          onNavigate={(g) => handleOpenDetail(g)}
          onRetry={handleRetry}
          onGenerateVideo={handleGenerateVideo}
        />
      )}
    </div>
  );
}
