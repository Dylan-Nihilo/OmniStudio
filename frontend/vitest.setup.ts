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
