import { defineConfig, loadEnv } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';
import { builtinModules } from 'node:module';

import ClosePlugin from './vite-plugin-close.js'
import checker from 'vite-plugin-checker'
import { optionalChecker } from './vite-checker-toggle.mjs';
import { ZOD_SSR_NO_EXTERNAL } from './vite.workerSsrNoExternal.mjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const nodeBuiltins = [
    ...builtinModules,
    ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default ({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
    return defineConfig({
        plugins: [
            alias(),
            nodeResolve(),
            ClosePlugin(),
            ...optionalChecker(() => checker({ typescript: true })),
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
            conditions: ['node'],
        },
        ssr: {
            noExternal: ZOD_SSR_NO_EXTERNAL,
        },
        build: {
            rollupOptions: {
                input: {
                    SkillInstallationWorker: path.resolve(
                        __dirname,
                        'src/childprocess/skill-installation/SkillInstallationWorker.ts'
                    ),
                },
                output: {
                    entryFileNames: 'SkillInstallationWorker.js',
                    chunkFileNames: 'assets/[name]-[hash].js',
                    format: 'cjs',
                },
                external: [
                    ...nodeBuiltins,
                    'sqlite3',
                    'better-sqlite3',
                    'bindings',
                    'typeorm',
                    'electron',
                    'chokidar',
                ],
            },
            sourcemap: true,
            ssr: true,
        },
    });
};
