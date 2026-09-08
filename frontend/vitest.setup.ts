import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
    cleanup();
});

// DOM emulators do not implement Web Animations; motion is checked in the browser.
if (typeof Element !== 'undefined' && !Element.prototype.getAnimations) {
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
}

if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = query => ({
        media: query, matches: false, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
        dispatchEvent: () => false,
    });
}
