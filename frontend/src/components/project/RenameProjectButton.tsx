"use client";

import { useId, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, IconButton, TextField } from '@omnistudio/ui';
import { api } from '@/lib/api';
import { writingError } from '@/lib/scriptWriting';
import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';

export default function RenameProjectButton({ projectId, title }: { projectId: string; title: string }) {
  const t = useTranslations('scriptWriting');
  const tc = useTranslations('common');
  const role = useAuthStore(state => state.activeWorkspace?.role);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const form = useId();
  if (role === 'viewer') return null;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || saving) return;
    setSaving(true); setError('');
    try {
      const project = await api.updateProject(projectId, { title: draft.trim() });
      useProjectStore.getState().updateProject(projectId, { title: project.title });
      setOpen(false);
    } catch (failure) { setError(writingError(failure, t('renameFailed'))); }
    finally { setSaving(false); }
  }
  return <>
    <span title={t('rename')}><IconButton aria-label={t('rename')} onPress={() => { setDraft(title); setError(''); setOpen(true); }}><Pencil size={14} /></IconButton></span>
    <Dialog isOpen={open} onOpenChange={next => { if (!saving) setOpen(next); }} isDismissable={!saving} title={t('rename')} closeLabel={tc('close')}
      footer={<><Button variant="quiet" isDisabled={saving} onPress={() => setOpen(false)}>{tc('cancel')}</Button><Button type="submit" form={form} isPending={saving} isDisabled={!draft.trim() || saving}>{tc('save')}</Button></>}>
      <form id={form} onSubmit={save}>
        <TextField autoFocus label={t('projectName')} value={draft} onChange={setDraft} maxLength={200} isRequired isDisabled={saving} />
        {error && <p role="alert" className="mt-3 text-sm text-status-failed-fg">{error}</p>}
      </form>
    </Dialog>
  </>;
}
