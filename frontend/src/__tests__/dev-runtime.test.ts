import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json';
import nextConfig from '../../next.config.mjs';
import { buildNextDevEnv } from '../../scripts/run-next-dev.mjs';

describe('frontend dev runtime', () => {
    it('proxies auth requests without changing the browser-visible cookie path', async () => {
        const rewrites = await nextConfig.rewrites();
        const authRewrite = rewrites.find((rewrite) => rewrite.source === '/auth/:path*');

        expect(authRewrite?.destination).toMatch(/\/auth\/:path\*$/);
    });

    it('routes npm run dev through the repo-controlled wrapper script', () => {
        expect(packageJson.scripts.dev).toBe('node ./scripts/run-next-dev.mjs');
    });

    it('enables Watchpack polling by default on macOS', () => {
        const env = buildNextDevEnv({}, 'darwin');

        expect(env.NEXT_DEV_DIST_DIR).toBe('.next-dev');
        expect(env.WATCHPACK_POLLING).toBe('true');
        expect(env.WATCHPACK_POLLING_INTERVAL).toBe('1000');
    });

    it('keeps an explicit development build directory override', () => {
        const env = buildNextDevEnv({ NEXT_DEV_DIST_DIR: '.custom-next-dev' }, 'win32');

        expect(env.NEXT_DEV_DIST_DIR).toBe('.custom-next-dev');
    });

    it('respects explicit watcher overrides from the user environment', () => {
        const env = buildNextDevEnv(
            {
                WATCHPACK_POLLING: 'false',
                WATCHPACK_POLLING_INTERVAL: '250',
            },
            'darwin'
        );

        expect(env.WATCHPACK_POLLING).toBe('false');
        expect(env.WATCHPACK_POLLING_INTERVAL).toBe('250');
    });
});
