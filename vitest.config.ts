import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // So a test can import a `.vue` file. Only the component tests do: see `environment`
  // below: but the plugin has to be here for any of them to compile at all.
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': resolve('shared'),
      '@main': resolve('main'),
      // Renderer modules are testable only as far as they avoid `window`: `api.ts`
      // reads `window.git` at import time, so anything importing it stays untestable
      // here by design. The selection store and the formatters do not.
      '@renderer': resolve('renderer')
    }
  },
  test: {
    // Node, still, for all but a handful. Almost everything here is a parser, an argv
    // table or a store, and a DOM none of them touch would cost every file the setup.
    // A component test opts itself in with `@vitest-environment happy-dom` at the top:
    // per file, so the cost lands only where a component is actually mounted.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests shell out to real git; give them room.
    testTimeout: 20_000
  }
});
