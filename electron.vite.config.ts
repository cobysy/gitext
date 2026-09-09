import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

const shared = resolve('shared');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared, '@main': resolve('main') } },
    build: {
      // So a crash report names a file someone can open. Node rewrites `error.stack`
      // through these once `setSourceMapsEnabled` is on, which `main/index.ts` does.
      sourcemap: true,
      rollupOptions: { input: resolve('main/index.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: resolve('main/preload.ts'),
        // A sandboxed preload cannot be an ES module: it must be CommonJS, and
        // named .js so `webPreferences.preload` resolves it.
        output: { format: 'cjs', entryFileNames: 'preload.js' }
      }
    }
  },
  renderer: {
    root: resolve('renderer'),
    plugins: [vue()],
    resolve: { alias: { '@shared': shared, '@renderer': resolve('renderer') } },
    // Two entries: the repository window, and the window every dialog is loaded into.
    // A dialog is its own `BrowserWindow` with its own renderer process: see
    // `main/dialogs.ts`: so it needs its own HTML document to load.
    build: {
      // `hidden`: the maps are written beside the bundles but no `sourceMappingURL`
      // points at them, so nothing is fetched at runtime and the pages are unchanged.
      // Chromium never rewrites a renderer's `error.stack`, so these are for resolving a
      // reported frame afterwards rather than for the report itself.
      sourcemap: 'hidden',
      rollupOptions: {
        input: {
          index: resolve('renderer/index.html'),
          dialog: resolve('renderer/dialog.html')
        }
      }
    }
  }
});
