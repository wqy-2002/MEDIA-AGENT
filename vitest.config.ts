import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest 单元测试配置
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: true,
  },
});
