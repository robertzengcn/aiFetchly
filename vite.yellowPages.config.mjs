import { defineConfig, loadEnv } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';
import { builtinModules } from 'node:module';

import ClosePlugin from './vite-plugin-close.js'
import checker from 'vite-plugin-checker'
import { optionalChecker } from './vite-checker-toggle.mjs';
import { SANITIZE_HTML_SSR_NO_EXTERNAL } from './vite.workerSsrNoExternal.mjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import sourcemaps from 'rollup-plugin-sourcemaps';

const nodeBuiltins = [
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

function emptyModulesPlugin() {
    const emptyModules = [
        '@sap/hana-client/extension/Stream',
        '@sap/hana-client',
        'typeorm-aurora-data-api-driver',
        '@google-cloud/spanner',
        'mysql', 'mysql2',
        'pg', 'pg-query-stream', 'pg-native',
        'mongodb', 'mssql', 'oracledb',
        'hdb-pool', 'redis', 'ioredis', 'sql.js'
    ];

    return {
        name: 'empty-modules',
        resolveId(id) {
            if (emptyModules.includes(id) || emptyModules.some(m => id.startsWith(`${m}/`))) {
                return { id: 'virtual:empty-module', external: false };
            }
            return null;
        },
        load(id) {
            if (id === 'virtual:empty-module') {
                return 'export default {}; export const Stream = {}; export const Readable = {}; export const Writable = {}; export const PassThrough = {};';
            }
            return null;
        }
    };
}

export default ({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
    return defineConfig({
        plugins: [
            alias(),
            nodeResolve(),
            emptyModulesPlugin(),
            sourcemaps(),
            ClosePlugin(),
            ...optionalChecker(() => checker({ typescript: true })),
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
            conditions: ['node'],
        },
        optimizeDeps: {
            include: ['winston-transport', 'bufferutil', 'utf-8-validate']
        },
        // SSR builds externalize node_modules by default. Force-bundle
        // sanitize-html and its pure-JS dependency tree so packaged
        // YellowPagesScraper (loaded from app.asar.unpacked/.vite/build) does
        // not need runtime requires that fail with MODULE_NOT_FOUND on Windows.
        ssr: {
            noExternal: SANITIZE_HTML_SSR_NO_EXTERNAL,
        },
        build: {
            rollupOptions: {
                // input: {
                //     YellowPagesScraper: path.resolve(__dirname, 'src/childprocess/YellowPagesScraper.ts')
                // },
                // output: {
                //     dir: 'dist/childprocess',
                //     entryFileNames: 'YellowPagesScraper.js',
                //     format: 'cjs'
                // },
                external: [
                    ...nodeBuiltins,
                    'sqlite3',
                    'better-sqlite3',
                    'bindings',
                    'typeorm'
                ],
            },
            sourcemap: true,
            ssr: true,
            external: [
                'sqlite3'
            ]
        },
    })
}

