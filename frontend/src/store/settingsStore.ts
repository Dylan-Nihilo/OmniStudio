import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useToastStore } from './toastStore';

export type Locale = 'zh' | 'en';

/**
 * 5 预设主题（Tasty Sam 主题系统）。
 * 3 暗（atelier-dark 默认 / bridge-dark / brand-dark）+ 2 亮（atelier-light / brand-light）。
 * 与 globals.css 的 html.<id> block、Providers/layout 切换逻辑一一对应。
 */
export type ThemePreset =
    | 'atelier-dark'
    | 'bridge-dark'
    | 'brand-dark'
    | 'atelier-light'
    | 'brand-light';

export const THEME_PRESETS: ThemePreset[] = [
    'atelier-dark',
    'bridge-dark',
    'brand-dark',
    'atelier-light',
    'brand-light',
];

export const DEFAULT_THEME: ThemePreset = 'atelier-dark';
export const DEFAULT_DARK_THEME: ThemePreset = 'atelier-dark';
export const DEFAULT_LIGHT_THEME: ThemePreset = 'atelier-light';

export type ThemeMode = 'dark' | 'light' | 'system';

export const THEME_MODES: ThemeMode[] = ['dark', 'light', 'system'];

const isDarkTheme = (theme: ThemePreset) => theme.endsWith('-dark');

interface SettingsStore {
    locale: Locale;
    theme: ThemePreset;
    themeMode: ThemeMode;
    darkTheme: ThemePreset;
    lightTheme: ThemePreset;
    // 全局动效开关。true = 启用 motion（默认）；false = 降低动效，
    // 由 Providers 挂载 html.no-motion 类来落地（无障碍/性能偏好）。
    animations: boolean;
    setLocale: (locale: Locale) => void;
    setTheme: (theme: ThemePreset) => void;
    setThemeMode: (mode: ThemeMode, systemPrefersDark?: boolean) => void;
    setAnimations: (animations: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            locale: 'zh',
            theme: DEFAULT_THEME,
            themeMode: 'dark',
            darkTheme: DEFAULT_DARK_THEME,
            lightTheme: DEFAULT_LIGHT_THEME,
            animations: true,
            setLocale: (locale: Locale) => set((state) => {
                if (state.locale === locale) return state;
                useToastStore.getState().clear();
                return { locale };
            }),
            setTheme: (theme: ThemePreset) => set(() => {
                if (isDarkTheme(theme)) {
                    return { theme, themeMode: 'dark', darkTheme: theme };
                }
                return { theme, themeMode: 'light', lightTheme: theme };
            }),
            setThemeMode: (themeMode: ThemeMode, systemPrefersDark = true) => set((state) => {
                const useDarkTheme = themeMode === 'dark' || (themeMode === 'system' && systemPrefersDark);
                return {
                    themeMode,
                    theme: useDarkTheme ? state.darkTheme : state.lightTheme,
                };
            }),
            setAnimations: (animations: boolean) => set({ animations }),
        }),
        {
            name: 'omni_studio-settings',
            version: 2,
            // v0/v1 -> v2: normalize legacy presets, then backfill the explicit
            // mode and the remembered dark/light preset pair.
            migrate: (persisted: unknown, version: number) => {
                const state = (persisted ?? {}) as Partial<SettingsStore>;
                const animations = typeof state.animations === 'boolean' ? state.animations : true;
                const theme = THEME_PRESETS.includes(state.theme as ThemePreset)
                    ? state.theme as ThemePreset
                    : DEFAULT_THEME;
                const inferredMode: ThemeMode = isDarkTheme(theme) ? 'dark' : 'light';
                const themeMode = version >= 2 && THEME_MODES.includes(state.themeMode as ThemeMode)
                    ? state.themeMode as ThemeMode
                    : inferredMode;
                const darkTheme = version >= 2
                    && THEME_PRESETS.includes(state.darkTheme as ThemePreset)
                    && isDarkTheme(state.darkTheme as ThemePreset)
                    ? state.darkTheme as ThemePreset
                    : isDarkTheme(theme) ? theme : DEFAULT_DARK_THEME;
                const lightTheme = version >= 2
                    && THEME_PRESETS.includes(state.lightTheme as ThemePreset)
                    && !isDarkTheme(state.lightTheme as ThemePreset)
                    ? state.lightTheme as ThemePreset
                    : !isDarkTheme(theme) ? theme : DEFAULT_LIGHT_THEME;

                return { ...state, theme, themeMode, darkTheme, lightTheme, animations } as SettingsStore;
            },
        }
    )
);
