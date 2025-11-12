import { defineConfig } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import ClosePlugin from './vite-plugin-close.ts'
import checker from 'vite-plugin-checker'

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        'canvas'  // Mark canvas as external to prevent bundling native .node files
      ]
    }
  },
  plugins: [
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
    },
  }
});