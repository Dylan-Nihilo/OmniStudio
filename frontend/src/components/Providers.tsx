"use client";

import { useEffect } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useSettingsStore, THEME_PRESETS } from '@/store/settingsStore';
import { getMessages } from '@/lib/i18n';
import { LightboxProvider } from '@/components/shared/preview/LightboxProvider';
import ToastContainer from '@/components/shared/ToastContainer';
import { MotionConfig } from 'framer-motion';

export function Providers({ children }: { children: React.ReactNode }) {
    const locale = useSettingsStore((s) => s.locale);
    const theme = useSettingsStore((s) => s.theme);
    const themeMode = useSettingsStore((s) => s.themeMode);
    const setThemeMode = useSettingsStore((s) => s.setThemeMode);
    const animations = useSettingsStore((s) => s.animations);
    const messages = getMessages(locale);

    useEffect(() => {
        const html = document.documentElement;
        // 移除全部 5 个预设 class + 旧版遗留的 dark/light，再加当前主题
        html.classList.remove(...THEME_PRESETS, 'dark', 'light');
        html.classList.add(theme);
    }, [theme]);

    useEffect(() => {
        if (themeMode !== 'system') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const syncSystemTheme = (event: MediaQueryList | MediaQueryListEvent) => {
            setThemeMode('system', event.matches);
        };

        syncSystemTheme(mediaQuery);
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', syncSystemTheme);
            return () => mediaQuery.removeEventListener('change', syncSystemTheme);
        }

        mediaQuery.addListener(syncSystemTheme);
        return () => mediaQuery.removeListener(syncSystemTheme);
    }, [setThemeMode, themeMode]);

    useEffect(() => {
        // animations=false → 挂 html.no-motion，CSS 据此降低/禁用过渡动画
        document.documentElement.classList.toggle('no-motion', !animations);
    }, [animations]);

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    return (
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Shanghai">
            {/* MotionConfig: respect OS prefers-reduced-motion ("user"); when the
             *  in-app 动效 toggle is off, force-reduce Framer animations ("always"). */}
            <MotionConfig reducedMotion={animations ? "user" : "always"}>
                {/* LightboxProvider must wrap any subtree that uses PreviewImage /
                 *  PreviewVideo. Singleton portal — see Issue 14 design notes in
                 *  LightboxProvider.tsx. */}
                <LightboxProvider>
                    {children}
                    <ToastContainer />
                </LightboxProvider>
            </MotionConfig>
        </NextIntlClientProvider>
    );
}
