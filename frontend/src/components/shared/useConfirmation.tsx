"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from './ConfirmDialog';

/** A scoped replacement for native confirm; leaving the owner cancels it. */
export function useConfirmation() {
    const t = useTranslations('common');
    const [message, setMessage] = useState<string | null>(null);
    const resolver = useRef<((accepted: boolean) => void) | null>(null);
    useEffect(() => () => { resolver.current?.(false); resolver.current = null; }, []);
    const finish = useCallback((accepted: boolean) => {
        const resolve = resolver.current;
        resolver.current = null;
        setMessage(null);
        resolve?.(accepted);
    }, []);
    const confirm = useCallback((next: string): Promise<boolean> => {
        if (resolver.current) return Promise.resolve(false);
        setMessage(next);
        return new Promise(resolve => { resolver.current = resolve; });
    }, []);
    return { confirm, dialog: <ConfirmDialog open={message !== null} title={t('confirm')}
        message={message ?? ''} confirmLabel={t('confirm')} cancelLabel={t('cancel')}
        onCancel={() => finish(false)} onConfirm={() => finish(true)} /> };
}
