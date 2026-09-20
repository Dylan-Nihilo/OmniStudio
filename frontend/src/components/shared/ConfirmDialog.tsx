"use client";

import { Button, Dialog } from '@omnistudio/ui';
import { useTranslations } from 'next-intl';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    pending?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export default function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, pending = false, onCancel, onConfirm }: ConfirmDialogProps) {
    const t = useTranslations('common');
    return <Dialog isOpen={open} onOpenChange={isOpen => { if (!isOpen && !pending) onCancel(); }}
        title={title} closeLabel={t('close')} isDismissable={!pending}
        footer={<>
            <Button variant="secondary" isDisabled={pending} onPress={onCancel}>{cancelLabel}</Button>
            <Button variant="danger" isDisabled={pending} isPending={pending} onPress={onConfirm}>{confirmLabel}</Button>
        </>}>
        <p>{message}</p>
    </Dialog>;
}
