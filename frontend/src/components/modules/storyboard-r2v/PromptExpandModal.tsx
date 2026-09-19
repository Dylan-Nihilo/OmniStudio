"use client";
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog } from '@omnistudio/ui';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

interface PromptExpandModalProps {
    /** Current prompt text. Modal owns its own draft until commit so
     *  the user can Cancel without polluting upstream state. */
    initialValue: string;
    /** Display label for the shot the user is editing
     *  (e.g. "Shot 3"); pure context, not editable. */
    shotLabel: string;
    placeholder?: string;
    /** Commit and close — the host should update the underlying
     *  shot.prompt with the returned value. */
    onSave: (next: string) => void;
    /** Discard draft and close. */
    onClose: () => void;
}

export const getPromptExpandTextareaClasses = () =>
    "flex-1 w-full resize-none rounded-md border border-glass-border bg-input-bg px-4 py-3 font-sans text-body text-foreground leading-relaxed placeholder:text-text-muted outline-none transition-colors duration-fast ease-out-quart focus:border-primary/55 focus-visible:ring-2 focus-visible:ring-primary/45";

export default function PromptExpandModal({ initialValue, shotLabel, placeholder, onSave, onClose }: PromptExpandModalProps) {
    const t = useTranslations('storyboardR2V');
    const tc = useTranslations('common');
    const [draft, setDraft] = useState(initialValue);
    const [confirmClose, setConfirmClose] = useState(false);
    const close = () => { if (draft !== initialValue) setConfirmClose(true); else onClose(); };
    return <><Dialog isOpen title={t('promptExpandTitle', { shot: shotLabel })} closeLabel={t('close')}
        className="!w-[min(800px,92vw)] !max-w-none" onOpenChange={open => { if (!open) close(); }}
        footer={<><span className="mr-auto text-xs text-text-muted">{t('promptExpandHotkeys')}</span>
            <Button variant="secondary" onPress={close}>{tc('cancel')}</Button>
            <Button onPress={() => onSave(draft)}>{t('promptExpandSave')}</Button></>}>
        <p className="text-xs text-text-muted">{draft.length} {t('promptExpandChars')}</p>
        <textarea autoFocus aria-label={t('promptExpandTitle', { shot: shotLabel })} value={draft}
            onChange={e => setDraft(e.target.value)} placeholder={placeholder} spellCheck={false}
            className={`${getPromptExpandTextareaClasses()} min-h-[45vh]`}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.key.toLowerCase() === 'e')) { e.preventDefault(); onSave(draft); } }} />
    </Dialog><ConfirmDialog open={confirmClose} title={tc('unsavedChangesTitle')} message={tc('unsavedChangesMessage')}
        confirmLabel={tc('discardChanges')} cancelLabel={tc('keepEditing')} onCancel={() => setConfirmClose(false)} onConfirm={onClose} /></>;
}
