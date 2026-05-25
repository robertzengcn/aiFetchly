/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    conditions: ['node'],
  },
  test: {
    include: ['test/vitest/main/service/**/*.test.ts'],
  },
});
