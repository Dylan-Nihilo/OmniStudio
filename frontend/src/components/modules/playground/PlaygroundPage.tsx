'use client';

import { useEffect, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Button, LoadingState } from '@omnistudio/ui';
import styles from './PlaygroundPage.module.css';
import ModelSelector from './ModelSelector';
import MediaInput from './MediaInput';
import PromptInput from './PromptInput';
import ParameterBar from './ParameterBar';
import { getModelsForMode } from './playgroundModels';
import ResultGallery from './ResultGallery';
import { usePlaygroundStore, type PlaygroundMode, type QueuedRequest } from './usePlaygroundStore';
import { playgroundApi } from '@/lib/api';
import { toast } from '@/store/toastStore';
import { normalizeGeneration, normalizeTemplate } from './normalizers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<PlaygroundMode, string> = {
  t2i: 'T2I',
  i2i: 'I2I',
  t2v: 'T2V',
  i2v: 'I2V',
  r2v: 'R2V',
  v2v: 'V2V',
};

/** Modes that require media input (image or video source).
 *  t2i also shows optional media input — when provided, it auto-becomes i2i. */
const MODES_WITH_MEDIA: PlaygroundMode[] = ['i2i', 'i2v', 'r2v', 'v2v'];
const MODES_WITH_OPTIONAL_MEDIA: PlaygroundMode[] = ['t2i'];

/** Polling interval for generation status (ms) */
const POLL_INTERVAL = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlaygroundPage() {
  const t = useTranslations('playground');

  const mode = usePlaygroundStore((s) => s.mode);
  const modelId = usePlaygroundStore((s) => s.modelId);
  const prompt = usePlaygroundStore((s) => s.prompt);
  const negativePrompt = usePlaygroundStore((s) => s.negativePrompt);
  const inputMedia = usePlaygroundStore((s) => s.inputMedia);
  const parameters = usePlaygroundStore((s) => s.parameters);
  const referenceLimit = getModelsForMode(mode).find(model => model.id === modelId)?.maxReferenceImages;
  const tooManyReferences = !!referenceLimit && inputMedia.length > referenceLimit;
  const batchSize = usePlaygroundStore((s) => s.batchSize);
  const history = usePlaygroundStore((s) => s.history);
  const setHistory = usePlaygroundStore((s) => s.setHistory);
  const setTemplates = usePlaygroundStore((s) => s.setTemplates);
  const startGeneration = usePlaygroundStore((s) => s.startGeneration);
  const updateGeneration = usePlaygroundStore((s) => s.updateGeneration);
  const enqueueRequest = usePlaygroundStore((s) => s.enqueueRequest);
  const markDispatching = usePlaygroundStore((s) => s.markDispatching);
  const removeFromQueue = usePlaygroundStore((s) => s.removeFromQueue);
  const queue = usePlaygroundStore((s) => s.queue);
  const activeCount = usePlaygroundStore((s) => s.activeGenerationIds.length);
  const maxConcurrent = usePlaygroundStore((s) => s.maxConcurrent);

  const activeIds = usePlaygroundStore(s => s.activeGenerationIds);
  const [pollingError, setPollingError] = useState(false);

  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);

  // ─── Fetch initial data on mount ───────────────────────────────────────────

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    setHistoryError(false);
    playgroundApi.getHistory().then(items => {
      if (active) setHistory(Array.isArray(items) ? items.map(normalizeGeneration) : []);
    }).catch(() => {
      if (active) setHistoryError(true);
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [historyReload, setHistory]);

  useEffect(() => {
    let active = true;
    playgroundApi.getTemplates().then(items => {
      if (active) setTemplates(Array.isArray(items) ? items.map(normalizeTemplate) : []);
    }).catch(err => {
      console.error('[Playground] Failed to fetch templates:', err);
    });
    return () => { active = false; };
  }, [setTemplates]);

  // One non-overlapping read loop per active job, including restored history.
  useEffect(() => {
    if (historyLoading) return;
    let active = true;
    const errors = new Set<string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    setPollingError(false);
    const isCurrent = (id: string) => active && usePlaygroundStore.getState().activeGenerationIds.includes(id);
    const poll = async (id: string) => {
      try {
        const response = await playgroundApi.getGeneration(id);
        if (!isCurrent(id)) return;
        updateGeneration(normalizeGeneration(response));
        errors.delete(id);
      } catch {
        if (!isCurrent(id)) return;
        errors.add(id);
      } finally {
        if (active) {
          setPollingError(errors.size > 0);
          if (isCurrent(id)) timers.set(id, setTimeout(() => void poll(id), POLL_INTERVAL));
        }
      }
    };
    activeIds.forEach(id => timers.set(id, setTimeout(() => void poll(id), POLL_INTERVAL)));
    return () => {
      active = false;
      timers.forEach(clearTimeout);
    };
  }, [activeIds, historyLoading, updateGeneration]);

  // ─── Generate handler — enqueue a request; the dispatcher runs it ──────────

  const handleGenerate = useCallback(() => {
    if (tooManyReferences || !prompt.trim() || (MODES_WITH_MEDIA.includes(mode) && inputMedia.length === 0)) return;
    // Auto-detect i2i: t2i + reference images -> i2i
    const effectiveMode = (mode === 't2i' && inputMedia.length > 0) ? 'i2i' : mode;
    enqueueRequest({
      mode: effectiveMode,
      modelId,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt || undefined,
      inputMedia,
      parameters,
      batchSize,
    });
  }, [mode, modelId, prompt, negativePrompt, inputMedia, parameters, batchSize, enqueueRequest, tooManyReferences]);

  // ─── Queue dispatcher — POST a queued request, then poll for status ────────

  const dispatchRequest = useCallback(async (req: QueuedRequest) => {
    try {
      const resp = await playgroundApi.generate({
        mode: req.mode,
        model_id: req.modelId,
        prompt: req.prompt,
        negative_prompt: req.negativePrompt || undefined,
        input_media: req.inputMedia.length > 0 ? req.inputMedia : undefined,
        parameters: Object.keys(req.parameters).length > 0 ? req.parameters : undefined,
        batch_size: req.batchSize > 1 ? req.batchSize : undefined,
      });
      const gen = normalizeGeneration(resp);
      startGeneration(gen);
      removeFromQueue(req.id);
    } catch (err) {
      console.error('[Playground] Dispatch failed:', err);
      toast.error(t('queue.dispatchFailed'), {
        body: err instanceof Error ? err.message : t('queue.unknownError'),
      });
      removeFromQueue(req.id);
    }
  }, [startGeneration, removeFromQueue, t]);

  // Pump: dispatch pending requests up to the concurrency limit.
  const pump = useCallback(() => {
    const s = usePlaygroundStore.getState();
    const dispatching = s.queue.filter((q) => q.status === 'dispatching').length;
    let slots = s.maxConcurrent - s.activeGenerationIds.length - dispatching;
    if (slots <= 0) return;
    for (const req of s.queue) {
      if (slots <= 0) break;
      if (req.status !== 'pending') continue;
      slots -= 1;
      markDispatching(req.id);
      dispatchRequest(req);
    }
  }, [markDispatching, dispatchRequest]);

  // Run the pump whenever the queue, in-flight count, or concurrency changes.
  useEffect(() => {
    if (!historyLoading) pump();
  }, [queue, activeCount, maxConcurrent, pump, historyLoading]);

  // ─── Derived values ────────────────────────────────────────────────────────

  const resultCount = history.reduce((n, g) => n + (Array.isArray(g.outputs) ? g.outputs.length : 0), 0);
  const showMediaInput = MODES_WITH_MEDIA.includes(mode) || MODES_WITH_OPTIONAL_MEDIA.includes(mode);
  const canGenerate = !tooManyReferences && !historyLoading && prompt.trim().length > 0
    && (!MODES_WITH_MEDIA.includes(mode) || inputMedia.length > 0);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><h1>{t('header.title')}</h1><p>{t('header.subtitle')}</p></div>
        <span>{MODE_LABELS[mode]} · {t('header.resultsCount', { count: resultCount })}</span>
      </header>
      <div className={styles.body}>
        <section className={styles.composer} aria-label={t('compose.eyebrow')}>
          <div className={styles.fields}>
            <section><PromptInput /></section>
            {showMediaInput && <section>
              <h2>{t(mode === 'v2v' ? 'compose.mediaSourceVideo' : mode === 'r2v' ? 'compose.mediaRefMaterial' : mode === 'i2v' ? 'compose.mediaFirstFrame' : 'compose.mediaReference')}</h2>
              <MediaInput />
              {tooManyReferences && <p role="alert" className={styles.error}>{t("media.tooManyReferences", { max: referenceLimit! })}</p>}
            </section>}
            <section>
              <ModelSelector />
              <h2 className="mt-5">{t('compose.parametersLabel')}</h2>
              <ParameterBar />
            </section>
          </div>
          <footer className={styles.generate}>
            <Button onPress={handleGenerate} isDisabled={!canGenerate}>
              <Sparkles size={16} aria-hidden="true" />
              {batchSize > 1 ? t('compose.generateBatch', { count: batchSize }) : t('compose.generate')}
            </Button>
          </footer>
        </section>
        <section className={styles.results} aria-label={t('results.title')}>
          {historyLoading && <LoadingState label={t('results.loading')} inline={history.length > 0} />}
          {pollingError && <p role="alert" className={styles.error}>{t('results.pollFailed')}</p>}
          {historyError && <div role="alert" className={styles.error}>{t('results.loadFailed')}<Button variant="quiet" onPress={() => setHistoryReload(value => value + 1)}>{t('card.retry')}</Button></div>}
          {((!historyLoading && !historyError) || history.length > 0) && <ResultGallery />}
        </section>
      </div>
    </div>
  );
}
