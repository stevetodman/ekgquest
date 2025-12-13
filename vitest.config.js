import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run tests in Node environment (not browser)
    environment: 'node',

    // Test file patterns
    include: ['test/**/*.test.js'],

    // Parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },

    // Timeouts
    testTimeout: 30000,
    hookTimeout: 10000,

    // Reporter
    reporter: ['verbose'],

    // Coverage configuration (run with --coverage)
    coverage: {
      provider: 'v8',
      include: ['viewer/js/**/*.js'],
      exclude: ['viewer/js/ecg-worker.js'],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
});
