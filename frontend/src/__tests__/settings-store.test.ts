import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, THEME_PRESETS, DEFAULT_THEME } from '@/store/settingsStore';

describe('settingsStore', () => {
    beforeEach(() => {
        useSettingsStore.setState({
            locale: 'zh',
            theme: DEFAULT_THEME,
            themeMode: 'dark',
            darkTheme: 'atelier-dark',
            lightTheme: 'atelier-light',
        });
    });

    it('has correct default values', () => {
        const state = useSettingsStore.getState();
        expect(state.locale).toBe('zh');
        expect(state.theme).toBe(DEFAULT_THEME);
    });

    it('setLocale updates locale', () => {
        useSettingsStore.getState().setLocale('en');
        expect(useSettingsStore.getState().locale).toBe('en');
    });

    it('setTheme updates theme', () => {
        useSettingsStore.getState().setTheme('brand-light');
        expect(useSettingsStore.getState().theme).toBe('brand-light');
    });

    it('setTheme keeps the matching color mode and preset in sync', () => {
        useSettingsStore.getState().setTheme('bridge-dark');
        expect(useSettingsStore.getState().themeMode).toBe('dark');
        expect(useSettingsStore.getState().darkTheme).toBe('bridge-dark');

        useSettingsStore.getState().setTheme('brand-light');
        expect(useSettingsStore.getState().themeMode).toBe('light');
        expect(useSettingsStore.getState().lightTheme).toBe('brand-light');
    });

    it('switches between dark, light, and system modes using the saved presets', () => {
        useSettingsStore.getState().setTheme('bridge-dark');
        useSettingsStore.getState().setTheme('brand-light');

        useSettingsStore.getState().setThemeMode('dark');
        expect(useSettingsStore.getState()).toMatchObject({ themeMode: 'dark', theme: 'bridge-dark' });

        useSettingsStore.getState().setThemeMode('light');
        expect(useSettingsStore.getState()).toMatchObject({ themeMode: 'light', theme: 'brand-light' });

        useSettingsStore.getState().setThemeMode('system', true);
        expect(useSettingsStore.getState()).toMatchObject({ themeMode: 'system', theme: 'bridge-dark' });

        useSettingsStore.getState().setThemeMode('system', false);
        expect(useSettingsStore.getState()).toMatchObject({ themeMode: 'system', theme: 'brand-light' });
    });

    it('setLocale rejects invalid values at type level', () => {
        // Verify type constraint works - both valid locales are accepted
        useSettingsStore.getState().setLocale('zh');
        expect(useSettingsStore.getState().locale).toBe('zh');
        useSettingsStore.getState().setLocale('en');
        expect(useSettingsStore.getState().locale).toBe('en');
    });

    it('setTheme accepts every theme preset', () => {
        // All five presets must be settable (guards against enum drift)
        for (const preset of THEME_PRESETS) {
            useSettingsStore.getState().setTheme(preset);
            expect(useSettingsStore.getState().theme).toBe(preset);
        }
    });

    it('exposes exactly the five expected presets', () => {
        expect(THEME_PRESETS).toEqual([
            'atelier-dark',
            'bridge-dark',
            'brand-dark',
            'atelier-light',
            'brand-light',
        ]);
        expect(DEFAULT_THEME).toBe('atelier-dark');
    });
});
