/// <reference types="vitest" />
import { defineConfig,loadEnv} from 'vite';
import checker from 'vite-plugin-checker'
import * as path from 'path';
export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

  return defineConfig({
    plugins: [
      checker({
        // e.g. use TypeScript check
        typescript: true,
      }),
    ],
    resolve: {
      alias: {
          "@": path.resolve(__dirname, "./src"),
      },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [
        'sqlite3'
      ]
    }
  }
})
}