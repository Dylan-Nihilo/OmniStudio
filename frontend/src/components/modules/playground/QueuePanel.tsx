'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ListOrdered, X, Minus, Plus } from 'lucide-react';
import { usePlaygroundStore } from './usePlaygroundStore';
import { playgroundApi } from '@/lib/api';
import { toast } from '@/store/toastStore';
import { normalizeGeneration } from './normalizers';

/**
 * Queue indicator + popover for the client-side generation queue.
 * Shows queued and running requests, lets the user cancel them and adjust the
 * concurrency limit.
 */
export default function QueuePanel() {
  const t = useTranslations('playground');
  const queue = usePlaygroundStore((s) => s.queue);
  const history = usePlaygroundStore((s) => s.history);
  const activeGenerationIds = usePlaygroundStore((s) => s.activeGenerationIds);
  const activeCount = usePlaygroundStore((s) => s.activeGenerationIds.length);
  const maxConcurrent = usePlaygroundStore((s) => s.maxConcurrent);
  const setMaxConcurrent = usePlaygroundStore((s) => s.setMaxConcurrent);
  const removeFromQueue = usePlaygroundStore((s) => s.removeFromQueue);
  const updateGeneration = usePlaygroundStore((s) => s.updateGeneration);

  const [open, setOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const running = history.filter(
    (generation) => activeGenerationIds.includes(generation.id)
      && (generation.status === 'pending' || generation.status === 'processing'),
  );
  const waiting = queue.length + running.length;

  const handleCancelRunning = async (id: string) => {
    setCancellingId(id);
    try {
      const canceled = await playgroundApi.cancelGeneration(id);
      updateGeneration(normalizeGeneration(canceled));
    } catch (error) {
      console.error('[Playground] Cancel failed:', error);
      toast.error(t('queue.cancelFailed'), {
        body: error instanceof Error ? error.message : t('queue.unknownError'),
      });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-glass-border bg-surface-inset px-3.5 py-2 text-[0.8125rem] font-medium text-text-muted transition-colors cursor-pointer hover:bg-hover-bg hover:text-foreground"
        title={t('queue.label')}
      >
        <ListOrdered className="w-4 h-4" />
        {t('queue.label')}
        {waiting > 0 && <span className="font-mono text-[0.6875rem] text-accent">· {waiting}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[300px] rounded-[16px] border border-glass-border bg-elevated p-4 shadow-2xl">
          {/* Concurrency control */}
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-text-muted">
              {t('queue.concurrency')}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMaxConcurrent(maxConcurrent - 1)}
                disabled={maxConcurrent <= 1}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-glass-border bg-surface-inset text-text-muted transition-colors hover:text-foreground disabled:opacity-30"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-4 text-center font-mono text-sm text-foreground">{maxConcurrent}</span>
              <button
                type="button"
                onClick={() => setMaxConcurrent(maxConcurrent + 1)}
                disabled={maxConcurrent >= 8}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-glass-border bg-surface-inset text-text-muted transition-colors hover:text-foreground disabled:opacity-30"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
          <p className="mb-3 text-[0.625rem] text-text-muted">{t('queue.runningHint', { count: activeCount })}</p>

          {/* Running generations */}
          {running.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {running.map((generation) => (
                <div
                  key={generation.id}
                  className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2"
                >
                  <span className="font-mono text-[0.5625rem] uppercase px-1.5 py-[1px] rounded shrink-0 bg-primary/15 text-primary">
                    {t('queue.running')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-text-secondary">
                    {generation.prompt || '(empty)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCancelRunning(generation.id)}
                    disabled={cancellingId === generation.id}
                    title={t('queue.cancelRunning')}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-status-failed-bg hover:text-status-failed-fg disabled:opacity-40"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Queued requests */}
          {queue.length === 0 && running.length === 0 ? (
            <p className="py-3 text-center text-[0.75rem] text-text-muted">{t('queue.empty')}</p>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {queue.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-inset px-2.5 py-2"
                >
                  <span
                    className={`font-mono text-[0.5625rem] uppercase px-1.5 py-[1px] rounded shrink-0 ${
                      q.status === 'dispatching' ? 'bg-primary/15 text-primary' : 'bg-glass text-text-muted'
                    }`}
                  >
                    {q.status === 'dispatching' ? t('queue.dispatching') : t('queue.pending')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-text-secondary">
                    {q.prompt || '(empty)'}
                  </span>
                  {q.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => removeFromQueue(q.id)}
                      title={t('queue.cancel')}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-status-failed-bg hover:text-status-failed-fg"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
