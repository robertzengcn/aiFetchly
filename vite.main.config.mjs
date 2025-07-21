/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import alias from "@rollup/plugin-alias";
import * as path from 'path';
import copy from 'rollup-plugin-copy'
import fs from 'fs';
// import { viteStaticCopy } from 'vite-plugin-static-copy'
import ClosePlugin from './vite-plugin-close'
import checker from 'vite-plugin-checker'
import sourcemaps from 'rollup-plugin-sourcemaps';
// import { compile } from "ejs";
// import {ViteEjsPlugin} from "vite-plugin-ejs";
// import commonjs from '@rollup/plugin-commonjs';
//import { nodeResolve } from '@rollup/plugin-node-resolve';

// import vue from '@vitejs/plugin-vue'
// import vuetify from 'vite-plugin-vuetify'
// import { nodeResolve } from '@rollup/plugin-node-resolve';

// Create an empty module plugin
function emptyModulesPlugin() {
    // console.log('platform is', process.platform);
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

// Custom platform-aware copy plugin
function platformCopyPlugin() {
    return {
        name: 'platform-copy',
        buildStart() {
            console.log('Platform detected:', process.platform);

            // Ensure templates directory exists
            const templatesDir = '.vite/build/templates';
            if (!fs.existsSync(templatesDir)) {
                fs.mkdirSync(templatesDir, { recursive: true });
            }
            // Copy icons to build folder
            console.log('Copying icons to build folder...');
            const iconSourceDir = 'src/assets/images';
            const iconDestDir = '.vite/build';

            // Ensure icon destination directory exists
            if (!fs.existsSync(iconDestDir)) {
                fs.mkdirSync(iconDestDir, { recursive: true });
            }

            
            // Copy platform-specific icons
            if (process.platform === 'win32') {
                // Copy Windows icon (.ico)
                if (fs.existsSync(`${iconSourceDir}/icon.ico`)) {
                    fs.copyFileSync(`${iconSourceDir}/icon.ico`, `${iconDestDir}/icon.ico`);
                    console.log('Copied Windows icon (icon.ico)');
                }
            } else if (process.platform === 'darwin') {
                // Copy macOS icon (.icns)
                if (fs.existsSync(`${iconSourceDir}/icon.icns`)) {
                    fs.copyFileSync(`${iconSourceDir}/icon.icns`, `${iconDestDir}/icon.icns`);
                    console.log('Copied macOS icon (icon.icns)');
                }
            } else if (process.platform === 'linux') {
                // Copy PNG icon for Linux
                if (fs.existsSync(`${iconSourceDir}/icon.png`)) {
                    fs.copyFileSync(`${iconSourceDir}/icon.png`, `${iconDestDir}/icon.png`);
                    console.log('Copied Linux icon (icon.png)');
                }
            }


            // Copy platform-specific files
            if (process.platform === 'linux') {
                console.log('Copying Linux templates...');
                // Copy Linux templates
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/linux/templates/desktop.ejs',
                    '.vite/build/templates/desktop.ejs'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/linux/templates/script.ejs',
                    '.vite/build/templates/script.ejs'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/linux/index.js',
                    '.vite/build/index.js'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/linux/postinstall.js',
                    '.vite/build/postinstall.js'
                );
            } else if (process.platform === 'darwin') {
                console.log('Copying macOS templates...');
                // Copy macOS templates
                // fs.copyFileSync(
                //     'node_modules/protocol-registry/src/macos/templates/desktop.ejs',
                //     '.vite/build/templates/desktop.ejs'
                // );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/macos/templates/script.ejs',
                    '.vite/build/templates/script.ejs'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/macos/templates/app.ejs',
                    '.vite/build/templates/app.ejs'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/macos/templates/url-app.ejs',
                    '.vite/build/templates/url-app.ejs'
                );

                // Copy macOS scripts
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/macos/defaultAppExist.sh',
                    '.vite/build/defaultAppExist.sh'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/macos/index.js',
                    '.vite/build/index.js'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/macos/plistMutator.js',
                    '.vite/build/plistMutator.js'
                );
            } else if (process.platform === 'win32') {
                console.log('Copying Windows templates...');
                // Copy Windows templates
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/windows/templates/app-script.ejs',
                    '.vite/build/templates/app-script.ejs'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/windows/index.js',
                    '.vite/build/index.js'
                );
                fs.copyFileSync(
                    'node_modules/protocol-registry/src/windows/registry.js',
                    '.vite/build/registry.js'
                );

            }
        }
    };
}

// Custom plugin to process EJS templates and add variable checks
// function ejsTemplateProcessorPlugin() {
//     return {
//         name: 'ejs-template-processor',
//         writeBundle() {
//             console.log('Processing EJS templates for platform:', process.platform);

//             // Process script.ejs based on platform
//             const scriptPath = '.vite/build/templates/script.ejs';
//             if (fs.existsSync(scriptPath)) {
//                 let content = fs.readFileSync(scriptPath, 'utf8');

//                 if (process.platform === 'linux') {
//                     console.log('Processing Linux script.ejs...');
//                     // Linux template uses different variables - only add checks for Linux variables
//                     content = content.replace(/<%- desktopFilePath %>/g, '<%- typeof desktopFilePath !== "undefined" ? desktopFilePath : "" %>');
//                     content = content.replace(/<%- desktopFileName %>/g, '<%- typeof desktopFileName !== "undefined" ? desktopFileName : "" %>');
//                     content = content.replace(/<%= protocol %>/g, '<%= typeof protocol !== "undefined" ? protocol : "" %>');
//                 } else if (process.platform === 'darwin') {
//                     console.log('Processing macOS script.ejs...');
//                     // macOS template processing - only apply macOS-specific replacements
//                     content = content.replace(/<%if \(terminal > 0\) { %>/g, '<%if (typeof terminal !== \'undefined\' && terminal > 0) { %>');
//                     content = content.replace(/<%- appPath %>/g, '<%- typeof appPath !== "undefined" ? appPath : "" %>');
//                     content = content.replace(/<%- appSource %>/g, '<%- typeof appSource !== "undefined" ? appSource : "" %>');
//                     content = content.replace(/<%- urlAppPath %>/g, '<%- typeof urlAppPath !== "undefined" ? urlAppPath : "" %>');
//                     content = content.replace(/<%- urlAppSource %>/g, '<%- typeof urlAppSource !== "undefined" ? urlAppSource : "" %>');
//                     content = content.replace(/<%- plistMutator %>/g, '<%- typeof plistMutator !== "undefined" ? plistMutator : "" %>');
//                     content = content.replace(/<%= protocol %>/g, '<%= typeof protocol !== "undefined" ? protocol : "" %>');
//                 }

//                 fs.writeFileSync(scriptPath, content);
//             }

//             // Process url-app.ejs (macOS only)
//             const urlAppPath = '.vite/build/templates/url-app.ejs';
//             if (fs.existsSync(urlAppPath) && process.platform === 'darwin') {
//                 console.log('Processing macOS url-app.ejs...');
//                 let content = fs.readFileSync(urlAppPath, 'utf8');
//                 // Add variable checks to prevent ReferenceError
//                 content = content.replace(/<%if \(terminal > 0\) { %>/g, '<%if (typeof terminal !== \'undefined\' && terminal > 0) { %>');
//                 content = content.replace(/<%- protocol %>/g, '<%- typeof protocol !== "undefined" ? protocol : "" %>');
//                 content = content.replace(/<%- application %>/g, '<%- typeof application !== "undefined" ? application : "" %>');
//                 content = content.replace(/<%- command %>/g, '<%- typeof command !== "undefined" ? command : "" %>');
//                 content = content.replace(/<%- process\.env\.PATH %>/g, '<%- typeof process !== "undefined" && process.env && process.env.PATH ? process.env.PATH : "" %>');
//                 fs.writeFileSync(urlAppPath, content);
//             }

//             // Process app.ejs (macOS only)
//             const appPath = '.vite/build/templates/app.ejs';
//             if (fs.existsSync(appPath) && process.platform === 'darwin') {
//                 console.log('Processing macOS app.ejs...');
//                 let content = fs.readFileSync(appPath, 'utf8');
//                 // Add variable checks to prevent ReferenceError
//                 content = content.replace(/<%- protocol %>/g, '<%- typeof protocol !== "undefined" ? protocol : "" %>');
//                 content = content.replace(/<%- command %>/g, '<%- typeof command !== "undefined" ? command : "" %>');
//                 fs.writeFileSync(appPath, content);
//             }
//         }
//     };
// }

export default ({ mode }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

    return defineConfig({
        plugins: [
            // vuetify({
            //     autoImport: true,
            //   }),

            alias(),
            // ViteEjsPlugin(),
            emptyModulesPlugin(),
            sourcemaps(),
            ClosePlugin(),
            checker({
                // e.g. use TypeScript check
                typescript: true,
            }),
            platformCopyPlugin(),
            // ejsTemplateProcessorPlugin(),

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
            // mainFields: ['main', 'module', 'browser']
        },
        build: {
            rollupOptions: {
                external: [
                    'sqlite3',  // Mark sqlite3 as external
                    'better-sqlite3',
                    'bindings',
                    'typeorm'
                ]
            },
            sourcemap: true,
        },
        test: {
            include: ['test/vitest/main/*.test.ts'],
        }
    })
}