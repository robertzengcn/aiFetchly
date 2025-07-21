import { defineConfig, loadEnv } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills'
// import commonjs from 'vite-plugin-commonjs'
import ClosePlugin from './vite-plugin-close.js'
// import { esbuildCommonjs } from '@originjs/vite-plugin-commonjs'
import checker from 'vite-plugin-checker'
//import { nodeResolve } from '@rollup/plugin-node-resolve';
// import requireTransform from 'vite-plugin-require-transform';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy'
import { nodeResolve } from '@rollup/plugin-node-resolve';
// import typescript from 'rollup-plugin-typescript2'
import sourcemaps from 'rollup-plugin-sourcemaps';

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
        checker({
            // e.g. use TypeScript check
            typescript: true,
        }),
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
                "ws": './node_modules/ws/index.js',
                "bufferutil": path.resolve(__dirname, "./node_modules/bufferutil"),
                "utf-8-validate": path.resolve(__dirname, "./node_modules/utf-8-validate"),
            },
        },
        optimizeDeps: {    
                // disabled:false,
                include: ['winston-transport','bufferutil', 'utf-8-validate']          
        },
        build: {
            // target: 'es6',
            sourcemap: true,
            ssr:true,
            commonjsOptions:{
                transformMixedEsModules: true,
                // include:[]   
            },
            // commonjsOptions: {
            //     include: ["node_modules/@puppeteer/browsers/node_modules/yargs/build/index.cjs"],
            //   },
            // rollupOptions: {
            //     plugins: [
            //         alias({
            //             entries: [
            //               { find: '@', replacement: path.resolve(__dirname, 'src') }
            //             ]
            //           }),
            //         // nodeResolve({
            //         //     extensions: ['.js', '.jsx', '.ts', '.tsx', '.cjs']
            //         //   }), 
            //     ]
            // },
            external: [
                'sqlite3'
            ]

        },
        test: {
            include: ['test/vitest/utilitycode/*.test.ts'],
        }
      
    })
}