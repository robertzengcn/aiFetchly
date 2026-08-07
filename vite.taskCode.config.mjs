import { defineConfig, loadEnv } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';

import ClosePlugin from './vite-plugin-close.js'

import checker from 'vite-plugin-checker'
import { optionalChecker } from './vite-checker-toggle.mjs';

//import commonjs from '@rollup/plugin-commonjs';
//import copy from 'rollup-plugin-copy'
import { nodeResolve } from '@rollup/plugin-node-resolve';
//import typescript from 'rollup-plugin-typescript2'
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
// import {nodePolyfills} from 'vite-plugin-node-polyfills';
export default ({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
    // Object.defineProperty(process, 'stdout', {
    //     get: function() {
    //         return null; // Set the desired number of columns
    //     }
    // });
    return defineConfig({
        //include: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs'],
        plugins: [alias(),
        // nodePolyfills(
        //     {globals: { global: true, process: true }}
        // ),
        nodeResolve(),
        // commonjs({}),
        // commonjs({
        //             //strictRequires:true,
        //             //  include: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs',
        //             //  ],
        //         }),
        emptyModulesPlugin(),
        //typescript(),
        // commonjs({
        //     //strictRequires:true,
        //     //dynamicRequireTargets: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs'],
        //      include: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs',
        //      ],
        //     //include: 'node_modules/**',
        //     // exclude: ['node_modules/@colors/colors/lib/colors.js','node_modules/winston/dist/winston/config/index.js'],
        // }),
        //requireTransform({fileRegex:/.ts$|.tsx$|.js$|.cjs$/}),
        // copy({
        //     targets: [
        //         { src: 'node_modules/@puppeteer/browsers/node_modules/yargs/build', dest: '.vite/build/' }   
        //     ]  
        // }),
        sourcemaps(),
        ClosePlugin(),
        ...optionalChecker(() => checker({
            // e.g. use TypeScript check
            typescript: true,
        })),
            // nodePolyfills()
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
                "@sap/hana-client/extension/Stream": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "@sap/hana-client": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "typeorm-aurora-data-api-driver": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "@google-cloud/spanner": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "mysql": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "mysql2": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "pg": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "pg-query-stream": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "mongodb": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "mssql": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "oracledb": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                //"better-sqlite3": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "hdb-pool": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),
                "pg-native": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),  // Add this line
                "redis": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),  // Add this line
                "ioredis": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),  // Add this line
                "sql.js": path.resolve(__dirname, "./src/utils/typeorm-shim.ts"),  // Add this line
            },
            conditions: ['node'],
        },
        optimizeDeps: {
            // disabled:false,
            include: ['winston-transport', 'bufferutil', 'utf-8-validate', 'puppeteer-cluster']
        },
        // SSR builds externalize node_modules by default. Force-bundle
        // electron-store (and its pure-JS dependency tree) so packaged
        // taskCode (loaded from app.asar.unpacked/.vite/build) does not
        // need a runtime require that fails with MODULE_NOT_FOUND on Windows.
        // taskCode must use the real store (Token / USER_AI_ENABLED), so do
        // NOT alias electron-store to the ContactExtractionWorker shim.
        ssr: {
            noExternal: [
                // Token / settings store
                'electron-store',
                'conf',
                'type-fest',
                'ajv',
                'ajv-formats',
                'atomically',
                'debounce-fn',
                'dot-prop',
                'env-paths',
                'fast-deep-equal',
                'fast-uri',
                'find-up',
                'is-obj',
                'json-schema-traverse',
                'json-schema-typed',
                'locate-path',
                'mimic-fn',
                'onetime',
                'p-limit',
                'p-locate',
                'p-try',
                'path-exists',
                'pkg-up',
                'require-from-string',
                'semver',
                // HTML helpers (pure JS; fail from app.asar.unpacked without NODE_PATH)
                'sanitize-html',
                'htmlparser2',
                'escape-string-regexp',
                'is-plain-object',
                'deepmerge',
                'parse-srcset',
                'postcss',
                'launder',
                'entities',
                'domhandler',
                'domutils',
                'domelementtype',
                'dom-serializer',
                'nanoid',
                'picocolors',
                'source-map-js',
                'dayjs',
                'uuid',
            ],
        },
        build: {
            rollupOptions: {
                external: [
                    'sqlite3',  // Mark sqlite3 as external
                    'better-sqlite3',
                    'bindings',
                    // 'realm',
                    // 'puppeteer-cluster',
                    // 'winston',
                    // 'puppeteer',
                    // '@lem0-packages/puppeteer-page-proxy',
                    // 'nodemailer',
                
                ],
            },
            // target: 'es6',
            sourcemap: true,
            ssr: true,
            // commonjsOptions: {
            //     transformMixedEsModules: true,
            //     // include:[]   
            // },

            external: [
                'sqlite3'
            ]

        },
        test: {
            include: ['test/vitest/taskCode/*.test.ts'],
        }

    })
}
