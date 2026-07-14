import { defineConfig } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import ClosePlugin from './vite-plugin-close.ts'
import checker from 'vite-plugin-checker'
// import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        'electron-store',  // Should only be used in main process, not renderer
        'electron',        // Electron APIs should not be bundled in renderer
        'keytar',          // Native module, should not be bundled
      ]
    }
  },
  // Stable dev-server port so the dev browser bridge origin and the Chrome
  // launch config (http://localhost:5173) line up. strictPort fails fast if
  // 5173 is taken rather than silently picking another port (PRD FR-7.2).
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [
    // nodePolyfills({
    //   // To exclude specific polyfills, add them to this list.
    //   exclude: [],
    //   // Whether to polyfill specific globals.
    //   globals: {
    //     Buffer: true, // can also be 'build', 'dev', or false
    //     global: true,
    //     process: true,
    //   },
    //   // Whether to polyfill `node:` protocol imports.
    //   protocolImports: true,
    // }),
    alias(),
    vue(),
    // https://github.com/vuetifyjs/vuetify-loader/tree/next/packages/vite-plugin
    vuetify({
      autoImport: true,
    }),
    ClosePlugin(),
    checker({
      // e.g. use TypeScript check
      typescript: true,
      //vueTsc: true
    }),
  ],
    define: { 'process.env': {} },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Prevent dep-scan from failing on Node built-ins pulled in by shared modules
      crypto: path.resolve(__dirname, "./src/shims/crypto.empty.ts"),
      fs: path.resolve(__dirname, "./src/shims/fs.empty.ts"),
    },
  },
  // Prevent Vite from trying to optimize electron-store and other main-process-only modules
  optimizeDeps: {
    exclude: [
      'electron-store',
      'electron',
      'keytar',
    ]
  }
});