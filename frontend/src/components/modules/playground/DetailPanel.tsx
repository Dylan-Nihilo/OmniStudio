'use client';

import { useEffect, useCallback, useState } from 'react';
import { Button, Dialog, IconButton } from '@omnistudio/ui';
import {
  Download,
  Crown,
  Bookmark,
  Video,
  RotateCcw,
  Trash2,
  Copy,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { playgroundApi } from '@/lib/api';
import { getAssetUrl } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { usePlaygroundStore, type PlaygroundGeneration } from './usePlaygroundStore';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DetailPanelProps {
  generation: PlaygroundGeneration;
  allGenerations: PlaygroundGeneration[];
  focusOutputId?: string;
  onClose: () => void;
  onNavigate: (generation: PlaygroundGeneration) => void;
  onRetry?: (generation: PlaygroundGeneration) => void;
  onGenerateVideo?: (imagePath: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<string, string> = {
  t2v: 'T2V',
  i2v: 'I2V',
  r2v: 'R2V',
  v2v: 'V2V',
  t2i: 'T2I',
  i2i: 'I2I',
};

function getMediaUrl(path: string): string {
  const relativePath = path.replace(/^output\//, '');
  return getAssetUrl(relativePath);
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DetailPanel({
  generation: generationProp,
  allGenerations,
  focusOutputId,
  onClose,
  onNavigate,
  onRetry,
  onGenerateVideo,
}: DetailPanelProps) {
  const t = useTranslations('playground');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const markOutputSaved = usePlaygroundStore((s) => s.markOutputSaved);
  const removeGeneration = usePlaygroundStore((s) => s.removeGeneration);
  const history = usePlaygroundStore((s) => s.history);
  const featuredByGen = usePlaygroundStore((s) => s.featuredByGen);
  const toggleFeatured = usePlaygroundStore((s) => s.toggleFeatured);

  // Always read the latest generation from store (so saved_to_library stays in sync)
  const generation = history.find((g) => g.id === generationProp.id) ?? generationProp;

  // Determine media — focus the clicked output of a batch, else the first.
  const output =
    generation.outputs.find((o) => o.id === focusOutputId) ?? generation.outputs[0];
  const saved = output?.saved_to_library ?? false;
  const busy = saving || deleting;
  const featured = output ? featuredByGen[generation.id] === output.id : false;
  const isVideo =
    output?.media_type === 'video' ||
    ['t2v', 'i2v', 'r2v', 'v2v'].includes(generation.mode);
  const mediaUrl = output?.media_path ? getMediaUrl(output.media_path) : null;

  // Navigation
  const currentIndex = allGenerations.findIndex((g) => g.id === generation.id);
  const hasPrev = currentIndex >= 0 && currentIndex < allGenerations.length - 1;
  const hasNext = currentIndex > 0;

  const navigatePrev = useCallback(() => {
    if (hasPrev && !busy) onNavigate(allGenerations[currentIndex + 1]);
  }, [hasPrev, busy, currentIndex, allGenerations, onNavigate]);

  const navigateNext = useCallback(() => {
    if (hasNext && !busy) onNavigate(allGenerations[currentIndex - 1]);
  }, [hasNext, busy, currentIndex, allGenerations, onNavigate]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('input, textarea, select, video, audio, [role="slider"], [contenteditable="true"]'))) return;
      if (e.key === 'ArrowLeft') navigatePrev();
      if (e.key === 'ArrowRight') navigateNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigatePrev, navigateNext]);

  useEffect(() => setActionError(null), [generation.id, output?.id]);

  // Actions
  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(generation.prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    if (!mediaUrl) return;
    const a = document.createElement('a');
    a.href = mediaUrl;
    a.download = output?.media_path?.split('/').pop() || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSaveToLibrary = async () => {
    if (!output || saved || busy) return;
    setSaving(true);
    setActionError(null);
    try {
      await playgroundApi.saveToLibrary(generation.id, output.id);
      markOutputSaved(generation.id, output.id);
    } catch (err) {
      console.error('[DetailPanel] Save to library failed:', err);
      setActionError(t('detail.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setDeleting(true);
    setActionError(null);
    try {
      await playgroundApi.deleteGeneration(generation.id);
      removeGeneration(generation.id);
      onClose();
    } catch (err) {
      console.error('[DetailPanel] Delete failed:', err);
      setActionError(t('detail.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  // Build parameter entries
  const paramEntries: [string, string][] = [];
  const params = generation.parameters || {};
  if (params.size) paramEntries.push(['Size', params.size]);
  if (params.resolution) paramEntries.push(['Resolution', params.resolution]);
  if (params.aspect_ratio) paramEntries.push(['Aspect Ratio', params.aspect_ratio]);
  if (params.duration) paramEntries.push(['Duration', `${params.duration}s`]);
  if (generation.batch_size > 1)
    paramEntries.push(['Batch Size', String(generation.batch_size)]);
  if (params.seed !== undefined && params.seed !== null)
    paramEntries.push(['Seed', String(params.seed)]);
  // Add remaining params
  const skipKeys = new Set([
    'size',
    'resolution',
    'aspect_ratio',
    'duration',
    'seed',
  ]);
  Object.entries(params).forEach(([key, value]) => {
    if (!skipKeys.has(key) && value !== undefined && value !== null && value !== '') {
      paramEntries.push([key, String(value)]);
    }
  });

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      isDismissable={!busy}
      title={t('detail.title')}
      closeLabel={tc('close')}
      className="w-[calc(100vw-2rem)] max-w-[1440px] [&_.modal__body]:p-0"
    >
      <div className="flex flex-col md:flex-row md:h-[min(760px,75dvh)]">
        {/* ─── LEFT SIDE (Media) ─────────────────────────────────────────── */}
        <div className="relative w-full aspect-video md:aspect-auto md:w-[60%] md:h-full bg-surface-inset flex items-center justify-center">
          {mediaUrl ? (
            isVideo ? (
              <video
                src={mediaUrl}
                controls
                className="max-w-full max-h-full object-contain rounded"
              />
            ) : (
              <img
                src={mediaUrl}
                alt={generation.prompt}
                className="max-w-full max-h-full object-contain"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 text-text-muted">
              <Video className="w-12 h-12" />
              <span className="font-mono text-xs">No media</span>
            </div>
          )}

          {/* Amber halation overlay — only when saved to library (mirrors ResultCard) */}
          {saved && (
            <div className="atelier-proj-halation pointer-events-none absolute inset-0 z-[1]" />
          )}

          {/* Navigation arrows */}
          {hasPrev && (
            <IconButton
              onPress={navigatePrev}
              aria-label={t('detail.previous')}
              isDisabled={busy}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-elevated backdrop-blur-sm border border-glass-border flex items-center justify-center hover:bg-hover-bg transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-foreground/80" />
            </IconButton>
          )}
          {hasNext && (
            <IconButton
              onPress={navigateNext}
              aria-label={t('detail.next')}
              isDisabled={busy}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-elevated backdrop-blur-sm border border-glass-border flex items-center justify-center hover:bg-hover-bg transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-foreground/80" />
            </IconButton>
          )}
        </div>

        {/* ─── RIGHT SIDE (Details) — 3 zones: header / scroll body / pinned footer ─── */}
        <div className="w-full md:w-[40%] md:h-full md:overflow-y-auto border-t md:border-t-0 md:border-l border-border-subtle">

          {/* ── Header ── */}
          <div className="px-6 pt-6 pb-4 border-b border-border-subtle pr-14">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-[0.5625rem] bg-primary/15 text-primary rounded px-[6px] py-[2px] uppercase tracking-[0.1em]">
                {MODE_LABELS[generation.mode] || generation.mode}
              </span>
              <span className="font-mono text-[0.5625rem] text-text-muted uppercase tracking-[0.1em]">
                {generation.id.slice(0, 8)}
              </span>
            </div>
            <h2 className="font-display atelier-display text-xl font-semibold tracking-tight text-foreground leading-tight">
              {generation.model_id}
            </h2>
            <p className="font-mono text-[0.625rem] text-text-muted mt-1.5">
              {formatTimestamp(generation.created_at)}
            </p>
          </div>

          {/* ── Body ── */}
          <div className="px-6 py-5 space-y-5">
            {/* Prompt */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em] text-text-muted">
                  PROMPT
                </h3>
                <Button
                  onPress={handleCopyPrompt}
                  variant="quiet"
                  size="sm"
                >
                  <Copy className="w-3 h-3" />
                  {copied ? t('card.copied') : t('history.copy')}
                </Button>
              </div>
              <div className="rounded-[14px] bg-surface-inset border border-border-subtle p-4 max-h-48 overflow-y-auto">
                <p className="font-display italic text-[0.9375rem] text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                  {generation.prompt ? `“${generation.prompt}”` : '(empty)'}
                </p>
              </div>
            </div>

            {/* Parameters — labeled spec grid; first entry (Size) is a hero row */}
            {paramEntries.length > 0 && (
              <div>
                <h3 className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em] text-text-muted mb-2">
                  {t('detail.parameters')}
                </h3>
                <div className="rounded-[14px] bg-surface-inset border border-border-subtle p-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
                  {paramEntries.map(([label, value], i) => (
                    <div key={label} className={i === 0 ? 'col-span-2' : ''}>
                      <div className="font-mono text-[0.625rem] uppercase tracking-[0.08em] text-text-muted mb-1">
                        {label}
                      </div>
                      <div
                        className={`font-mono text-foreground ${
                          i === 0 ? 'text-[1.0625rem]' : 'text-sm'
                        }`}
                      >
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Negative prompt */}
            {generation.negative_prompt && (
              <div>
                <h3 className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.18em] text-text-muted mb-2">
                  NEGATIVE PROMPT
                </h3>
                <div className="rounded-[14px] bg-surface-inset border border-border-subtle p-4 max-h-28 overflow-y-auto">
                  <p className="text-[0.8125rem] text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                    {generation.negative_prompt}
                  </p>
                </div>
              </div>
            )}

            {/* Error display for failed generations */}
            {generation.status === 'failed' && generation.error && (
              <div>
                <h3 className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-status-failed-fg mb-2">
                  ERROR
                </h3>
                <div className="max-h-28 overflow-y-auto rounded-[16px] bg-status-failed-bg border border-status-failed-border p-4">
                  <p className="text-[0.6875rem] text-status-failed-fg leading-relaxed break-all font-mono">
                    {generation.error}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Actions (flow after content; not pinned to bottom) ── */}
          <div className="border-t border-border-subtle px-6 py-4 space-y-2.5">
            {actionError && <p role="alert" className="text-sm text-status-failed-fg">{actionError}</p>}
            {/* Primary: Retry (failed) or Save to library */}
            {generation.status === 'failed' && onRetry ? (
              <Button
                onPress={() => onRetry(generation)}
                isDisabled={busy}
                className="w-full"
              >
                <RotateCcw className="w-4 h-4" />
                {t('card.retry')}
              </Button>
            ) : output ? (
              <Button
                onPress={handleSaveToLibrary}
                isDisabled={saved || busy}
                isPending={saving}
                className="w-full"
              >
                <Bookmark className={`w-4 h-4 ${saved ? 'fill-current' : ''}`} />
                {saving ? t('detail.saving') : saved ? t('card.saved') : t('detail.saveToLibrary')}
              </Button>
            ) : null}

            {/* Featured (best-of-batch) toggle — amber only when active */}
            {output && (
              <Button
                onPress={() => toggleFeatured(generation.id, output.id)}
                variant="secondary"
                isDisabled={busy}
                aria-pressed={featured}
                className={`w-full ${featured ? 'bg-status-starred-bg border-status-starred-border text-status-starred-fg' : ''}`}
              >
                <Crown className={`w-4 h-4 ${featured ? 'fill-status-starred-solid' : ''}`} />
                {t('card.featured')}
              </Button>
            )}

            {output && (
              <p className="text-[0.625rem] leading-relaxed text-text-muted">
                {t('detail.markHint')}
              </p>
            )}

            {/* Secondary row: Download + Generate Video (neutral ghosts) */}
            {(mediaUrl || (!isVideo && output?.media_path && onGenerateVideo)) && (
              <div className="flex gap-2">
                {mediaUrl && (
                  <Button
                    onPress={handleDownload}
                    variant="secondary"
                    className="flex-1"
                  >
                    <Download className="w-4 h-4" />
                    {t('card.download')}
                  </Button>
                )}
                {!isVideo && output?.media_path && onGenerateVideo && (
                  <Button
                    onPress={() => onGenerateVideo(output.media_path)}
                    variant="secondary"
                    isDisabled={busy}
                    className="flex-1"
                  >
                    <Video className="w-4 h-4" />
                    {t('card.generateVideo')}
                  </Button>
                )}
              </div>
            )}

            {/* Delete — subdued, red only on hover */}
            <Button
              onPress={handleDelete}
              isDisabled={busy}
              isPending={deleting}
              variant="quiet"
              className="w-full text-status-failed-fg"
            >
              <Trash2 className="w-4 h-4" />
              {deleting ? t('detail.deleting') : t('card.delete')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
