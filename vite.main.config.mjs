/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';
import ClosePlugin from './vite-plugin-close'
import checker from 'vite-plugin-checker'
import { optionalChecker } from './vite-checker-toggle.mjs';
import {
  MAIN_PROCESS_EXTERNALS,
  MAIN_PROCESS_RESOLVE_ALIAS,
  emptyModulesPlugin,
  fixInteropNamespacePlugin,
  platformCopyPlugin,
} from './vite.main.shared.mjs';

// The externals list, resolve aliases, empty-modules shim, interop-namespace
// fix, and platform copy (icons + sqlite-vec) are shared with the Playwright
// E2E main build via vite.main.shared.mjs so the two bundles always use the
// same native-module / TypeORM bundling rules (design §6.4).

export default ({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

    return defineConfig({
        plugins: [
            alias(),
            emptyModulesPlugin(),
            ClosePlugin(),
            ...optionalChecker(() => checker({
                // e.g. use TypeScript check
                typescript: true,
            })),
            platformCopyPlugin({ outDir: '.vite/build' }),
            fixInteropNamespacePlugin(),
        ],
        resolve: {
            alias: MAIN_PROCESS_RESOLVE_ALIAS,
            conditions: ['node'],
            // mainFields: ['main', 'module', 'browser']
        },
        define: {
            // Embed VITE_LOGIN_URL as a build-time string literal so the
            // packaged app never needs to read a .env file at runtime.
            // process.env is populated from .env by loadEnv() above.
            'process.env.VITE_LOGIN_URL': JSON.stringify(
                process.env.VITE_LOGIN_URL || process.env.VITE_LOGIN_URL_TEST || ''
            ),
            // Plugin Hub (community catalog) base URL — first-party constant
            // consumed by src/config/pluginHubUrl.ts (see that file for why
            // process.env is used instead of import.meta.env).
            'process.env.VITE_PLUGIN_HUB_URL': JSON.stringify(
                process.env.VITE_PLUGIN_HUB_URL || ''
            ),
            // Bake the crash-upload mainLogTail rollout flag for PRODUCTION
            // builds only: packaged apps launched from Finder/Start Menu have
            // no shell env, so the value must come from the build environment
            // (CI env, or .env — forge.config.js loads it via dotenv with no
            // prefix filter before vite runs). Dev and test keep a live
            // process.env read so the flag stays runtime-controllable
            // (tests toggle it per-case; dev uses the shell env).
            ...(mode === 'production'
                ? {
                      'process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL': JSON.stringify(
                          process.env.AIFETCHLY_SEND_MAIN_LOG_TAIL || ''
                      ),
                  }
                : {}),
        },
        build: {
            rollupOptions: {
                external: MAIN_PROCESS_EXTERNALS,
            },
            sourcemap: true,
        },
        test: {
            // Component tests under test/vitest/main/components/ import .vue files,
            // which the root config cannot transform (no @vitejs/plugin-vue here).
            // Skip that subtree in the root suite; it runs via a dedicated config:
            //   test/vitest/main/components/vitest.config.mjs
            include: ['test/vitest/main/**/*.test.ts', '!test/vitest/main/components/**'],
            exclude: ['**/.claude/**', '**/.worktrees/**', '**/node_modules/**'],
            // NOTE: Do NOT set `environment: 'happy-dom'` globally here.
            // Doing so breaks non-component tests (e.g. AIChatQueryLoopAsyncPoll)
            // because happy-dom interferes with resolution of Node builtins
            // like 'fs'. Component tests under test/vitest/main/components/
            // use a dedicated workspace config
            // (test/vitest/main/components/vitest.config.mjs) that opts only
            // that subtree into happy-dom.
            // Run `tsc --noEmit` once before tests start. Vitest's esbuild
            // transpile-only mode silently passes files with type errors
            // (this exact issue bit us during the zod schema rollout).
            globalSetup: ['./test/vitest/_typecheck/globalSetup.ts'],
            // WS-2: coverage (only active when run with --coverage).
            coverage: {
                provider: 'v8',
                reporter: ['text', 'html', 'lcov'],
                reportsDirectory: './coverage/main',
                include: [
                    'src/main-process/**', 'src/service/**', 'src/modules/**',
                    'src/model/**', 'src/controller/**', 'src/utils/**',
                    'src/config/**', 'src/schemas/**', 'src/entity/**', 'src/entityTypes/**',
                ],
                exclude: ['**/*.test.ts', 'test/**', 'src/**/*.d.ts', '**/index.ts'],
            },
        }
    })
}
