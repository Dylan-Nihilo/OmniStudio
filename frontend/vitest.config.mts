import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    esbuild: {
        jsx: 'automatic',
    },
    test: {
        environment: 'node',
        include: [
            'src/__tests__/**/*.test.ts',
            'src/__tests__/**/*.spec.ts',
            'src/__tests__/**/*.test.tsx',
            'src/__tests__/**/*.spec.tsx',
        ],
        setupFiles: ['./vitest.setup.ts'],
    },
    resolve: {
        alias: {
            '@': path.resolve(projectRoot, 'src'),
        },
    },
});
