'use client';

import { useState, useRef } from 'react';
import { Button, Dialog } from '@omnistudio/ui';
import { Upload, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { scriptEditorApi } from '@/lib/scriptEditorApi';
import type { JSONContent } from '@tiptap/core';

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onImportSuccess: (content: JSONContent) => void;
}

export default function ImportDialog({ open, onClose, projectId, onImportSuccess }: ImportDialogProps) {
  const t = useTranslations('scriptEditor');
  const tc = useTranslations('common');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const selectFile = (selected: File) => {
    if (busy) return;
    const ext = selected.name.slice(selected.name.lastIndexOf('.')).toLowerCase();
    setFile(null);
    if (!['.fdx', '.fountain', '.txt'].includes(ext)) return setError(t('dialogs.import.unsupportedType', { ext }));
    if (selected.size > 10 * 1024 * 1024) return setError(t('dialogs.import.fileTooLarge', { size: (selected.size / 1024 / 1024).toFixed(1) }));
    setFile(selected);
    setError('');
  };
  const importFile = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await scriptEditorApi.importDocument(projectId, file);
      onImportSuccess(result.content || result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dialogs.import.failed'));
    } finally { setBusy(false); }
  };

  return <Dialog isOpen={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }} isDismissable={!busy} title={t('dialogs.import.title')} closeLabel={tc('close')} footer={<><Button variant="quiet" isDisabled={busy} onPress={onClose}>{tc('cancel')}</Button><Button isDisabled={!file || busy} isPending={busy} onPress={importFile}>{busy ? t('dialogs.import.parsing') : t('dialogs.import.title')}</Button></>}>
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface-inset p-6 text-center" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const selected = event.dataTransfer.files[0]; if (selected) selectFile(selected); }}>
      {file ? <FileText size={28} className="text-primary" /> : <Upload size={28} className="text-text-muted" />}
      <p className="max-w-full break-all text-sm">{file?.name || t('dialogs.import.dropzone')}</p>
      <p className="text-xs leading-5 text-text-muted">{t('dialogs.import.supportedFormats')}</p>
      <Button variant="secondary" isDisabled={busy} onPress={() => input.current?.click()}>{t('dialogs.import.chooseFile')}</Button>
      <input ref={input} type="file" accept=".fdx,.fountain,.txt" aria-label={t('dialogs.import.chooseFile')} className="hidden" disabled={busy} onChange={event => { const selected = event.target.files?.[0]; if (selected) selectFile(selected); event.target.value = ''; }} />
    </div>
    <p className="mt-4 text-sm text-text-secondary">{t('dialogs.import.replaceWarning')}</p>
    {error && <p role="alert" className="mt-3 text-sm text-status-failed-fg">{error}</p>}
  </Dialog>;
}
