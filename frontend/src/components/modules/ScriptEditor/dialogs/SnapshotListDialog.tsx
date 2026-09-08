'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Dialog, LoadingState } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';
import { scriptEditorApi, SnapshotResponse } from '@/lib/scriptEditorApi';

export interface SnapshotListDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onRestore: (content: any) => void;
}

export default function SnapshotListDialog({
  open,
  onClose,
  projectId,
  onRestore,
}: SnapshotListDialogProps) {
  const t = useTranslations('scriptEditor');
  const tc = useTranslations('common');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [snapshots, setSnapshots] = useState<SnapshotResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmingTimestamp, setConfirmingTimestamp] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Fetch snapshots when dialog opens
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setError('');
    setSnapshots([]);
    setConfirmingTimestamp(null);
    setLoading(true);
    scriptEditorApi
      .listSnapshots(projectId)
      .then((list) => {
        if (cancelled) return;
        // Sort by created_at descending (newest first)
        const sorted = [...list].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setSnapshots(sorted);
      })
      .catch((err) => {
        if (!cancelled) setError(t('dialogs.snapshots.loadFailed'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId, attempt, t]);

  const handleRestore = useCallback(
    async (timestamp: string) => {
      if (restoring) return;
      setError('');
      setRestoring(true);
      try {
        const result = await scriptEditorApi.restoreSnapshot(projectId, timestamp);
        onRestore(result.content);
        onClose();
      } catch (err) {
        setError(t('dialogs.snapshots.restoreFailed'));
      } finally {
        setRestoring(false);

      }
    },
    [projectId, onRestore, onClose, restoring, t]
  );

  if (!open) return null;

  return <Dialog isOpen={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }} isDismissable={!restoring} title={t('snapshots.title')} closeLabel={tc('close')} footer={confirmingTimestamp ? <><Button variant="quiet" isDisabled={restoring} onPress={() => setConfirmingTimestamp(null)}>{tc('cancel')}</Button><Button variant="danger" isDisabled={restoring} isPending={restoring} onPress={() => handleRestore(confirmingTimestamp)}>{t('dialogs.snapshots.confirmBtn')}</Button></> : undefined}>
    {loading ? <LoadingState label={t('dialogs.snapshots.loading')} /> : <div className="divide-y divide-border-subtle">
      {snapshots.map(snap => <div key={snap.timestamp} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <time dateTime={snap.created_at} className="text-sm">{new Date(snap.created_at).toLocaleString()}</time>
        <Button variant="secondary" isDisabled={restoring} aria-pressed={confirmingTimestamp === snap.timestamp} onPress={() => setConfirmingTimestamp(snap.timestamp)}><RotateCcw size={14} />{t('dialogs.snapshots.restore')}</Button>
      </div>)}
      {!error && snapshots.length === 0 && <p className="py-8 text-sm text-text-muted">{t('snapshots.empty')}</p>}
    </div>}
    {confirmingTimestamp && <p className="mt-4 text-sm text-status-warning-fg">{t('snapshots.confirmRestore')}</p>}
    {error && <div role="alert" className="mt-3 text-sm text-status-failed-fg"><p>{error}</p>{!snapshots.length && <Button variant="secondary" className="mt-3" onPress={() => setAttempt(value => value + 1)}>{t('shell.retryLoadDocument')}</Button>}</div>}
  </Dialog>;
}
