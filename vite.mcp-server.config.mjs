import { defineConfig } from 'vite';
import { resolve } from 'path';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/mcp-server/basic.ts'),
      name: 'AiFetchlyMCPServer',
      fileName: 'index',
      formats: ['cjs']
    },
    outDir: 'dist/mcp-server',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        'sqlite3',
        'puppeteer',
        'puppeteer-extra',
        'puppeteer-extra-plugin-stealth',
        'puppeteer-cluster',
        'got',
        'cheerio',
        'nodemailer',
        'cron',
        'winston',
        'uuid',
        'lodash',
        'crypto',
        'fs',
        'path',
        'os',
        'child_process',
        'util',
        'events',
        'stream',
        'buffer',
        'url',
        'querystring',
        'http',
        'https',
        'net',
        'tls',
        'zlib',
        'readline',
        'cluster',
        'worker_threads'
      ],
      output: {
        format: 'cjs'
      }
    }
  },
  plugins: [
    nodeResolve({
      preferBuiltins: true,
      exportConditions: ['node']
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.mcp-server.json',
      useTsconfigDeclarationDir: true,
      tsconfigOverride: {
        compilerOptions: {
          declaration: true,
          declarationMap: true,
          sourceMap: true
        }
      }
    })
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  optimizeDeps: {
    exclude: ['@modelcontextprotocol/sdk']
  }
});
