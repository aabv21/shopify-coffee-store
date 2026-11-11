import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    // DOM suites opt in per file and import each component's module themselves, so happy-dom
    // skips the rendered <script> tags quietly and never makes a network request.
    environmentOptions: {
      happyDOM: { settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true } },
    },
  },
});
