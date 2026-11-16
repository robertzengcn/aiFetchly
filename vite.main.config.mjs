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

/**
 * Build-time mirror of the AiFetchHubMarketplaceFetcher https guard: an http
 * non-loopback hub URL without AIFETCHLY_ALLOW_HTTP_HUB=1 is rejected by every
 * packaged build at runtime (packaged apps never run with
 * NODE_ENV=development), so surface the misconfiguration during the build
 * instead of letting production discover it as "Plugin Hub URL must be
 * https..." on each community:list call (incident 2026-11-16).
 */
function warnOnUnreachableHttpHub(env) {
  const hubUrl = String(env.VITE_PLUGIN_HUB_URL || '').trim();
  const allowHttp = String(env.AIFETCHLY_ALLOW_HTTP_HUB || '').trim();
  if (!hubUrl.startsWith('http://')) return;
  let hostname = '';
  try {
    hostname = new URL(hubUrl).hostname;
  } catch {
    return;
  }
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isLoopback && allowHttp !== '1') {
    console.warn(
      `[vite.main] VITE_PLUGIN_HUB_URL=${hubUrl} is http, not localhost, and AIFETCHLY_ALLOW_HTTP_HUB is not "1" — ` +
        'the packaged app will reject every Plugin Hub request at runtime ' +
        '(Plugin Hub URL must be https, or set AIFETCHLY_ALLOW_HTTP_HUB=1 in .env).'
    );
  }
}

export default ({ mode }) => {
    // loadEnv() defaults to the `VITE_` prefix, which silently drops the
    // non-prefixed `AIFETCHLY_ALLOW_HTTP_HUB` from .env when vite runs
    // outside electron-forge (forge.config.js dotenv-loads .env without a
    // prefix filter, so forge builds were unaffected). That mismatch baked an
    // http hub URL into production with the allow flag empty, and the
    // fetcher's https guard then rejected every community catalog request at
    // runtime ("Plugin Hub URL must be https..."). The empty prefix loads ALL
    // .env vars (mirroring forge's dotenv behavior); only the keys referenced
    // by `define` below are baked into the bundle.
    process.env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
    warnOnUnreachableHttpHub(process.env);

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
            'process.env.AIFETCHLY_ALLOW_HTTP_HUB': JSON.stringify(
                process.env.AIFETCHLY_ALLOW_HTTP_HUB || ''
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
            // Per-worker temp-dir isolation (V01 / re-audit checkbox 1).
            // BaseDb/BaseModule fall back to `os.tmpdir()/aifetchly-test` when
            // constructed without a filepath; under the default forks pool two
            // workers running TypeORM `synchronize()` DDL against the SAME
            // shared file throw SQLITE_BUSY. This setupFile assigns each worker
            // process a unique TMPDIR (os.tmpdir() re-reads TMPDIR per call on
            // Node 22) so the fallback resolves to a per-worker-unique dir,
            // fixing every empty-dbpath user at once. Runs before test modules
            // import. See test/vitest/_setup/isolatedTmpDir.ts.
            setupFiles: ['./test/vitest/_setup/isolatedTmpDir.ts'],
        }
    })
}
