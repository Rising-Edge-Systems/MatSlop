import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    environment: 'node',
    // jsdom environment for .test.tsx files is set via per-file `// @vitest-environment jsdom` directive
    // (environmentMatchGlobs was removed in vitest v4)
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
