import { defineConfig, loadEnv } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';

import ClosePlugin from './vite-plugin-close.js'
import checker from 'vite-plugin-checker'
import { nodeResolve } from '@rollup/plugin-node-resolve';
import sourcemaps from 'rollup-plugin-sourcemaps';

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
            checker({ typescript: true }),
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
        build: {
            rollupOptions: {
                input: {
                    websiteContentScraper: path.resolve(__dirname, 'src/childprocess/websiteContentScraper.ts')
                },
                output: {
                    dir: 'dist/childprocess',
                    entryFileNames: 'websiteContentScraper.js',
                    format: 'cjs'
                },
                external: [
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

