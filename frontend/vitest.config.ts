import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup/vitest.setup.ts'],
        include: [
            'tests/unit/**/*.test.ts',
            'tests/unit/**/*.test.tsx',
            'tests/integration/**/*.test.ts',
            'tests/integration/**/*.test.tsx',
        ],
        exclude: ['tests/e2e/**'],
        clearMocks: true,
        restoreMocks: true,
    },
});
