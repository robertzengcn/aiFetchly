const path = require('path');
const dotenv = require('dotenv');
const { readdirSync, rmdirSync, statSync } = require('node:fs');
const { join, normalize } = require('node:path');
const { Walker, DepType } = require('flora-colossus');
let nativeModuleDependenciesToPackage = [];
const EXTERNAL_DEPENDENCIES = [
  'realm',
  'electron-squirrel-startup',
  'better-sqlite3',
  'puppeteer-cluster',
  'lodash',
'winston',
'user-agents',
'puppeteer',
'puppeteer-extra',
'puppeteer-extra-plugin-stealth',
//'puppeteer-extra-plugin-adblocker',
'puppeteer-extra-plugin-recaptcha',
'@lem0-packages/puppeteer-page-proxy',
'nodemailer',
'@langchain/ollama',
'decamelize',
'camelcase',
'js-tiktoken',
'p-retry',
'langsmith',
'@cfworker/json-schema',
'mustache',
'openai',
'typeorm',
'cheerio',
'faiss-node'
];
//import { ForgeConfig } from '@electron-forge/shared-types';
// import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
// Determine the environment and load the corresponding .env file
const env = process.env.NODE_ENV || 'development';
const envFile = `.env.${env}`;
dotenv.config({ path: path.resolve(__dirname, envFile) });
module.exports={
  packagerConfig: {
    icon: './src/assets/images/icon',
    // asar: {
    //   // This ensures native modules are unpacked
    //   unpack: "**/node_modules/better-sqlite3/**",
     
    // },
    asar: { unpackDir: "**/node_modules/{better-sqlite3,sqlite3}/**", },
    ignore: (file) => {
      const filePath = file.toLowerCase();
      const KEEP_FILE = {
        keep: false,
        log: true,
      };
      // NOTE: must return false for empty string or nothing will be packaged
      if (filePath === '') KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath === '/package.json') KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath === '/node_modules') KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath === '/.vite') KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath.startsWith('/.vite/')) KEEP_FILE.keep = true;
      if (!KEEP_FILE.keep && filePath.startsWith('/node_modules/')) {
        // check if matches any of the external dependencies
        for (const dep of nativeModuleDependenciesToPackage) {
          if (
            filePath === `/node_modules/${dep}/` ||
            filePath === `/node_modules/${dep}`
          ) {
            KEEP_FILE.keep = true;
            break;
          }
          if (filePath === `/node_modules/${dep}/package.json`) {
            KEEP_FILE.keep = true;
            break;
          }
          if (filePath.startsWith(`/node_modules/${dep}/`)) {
            KEEP_FILE.keep = true;
            KEEP_FILE.log = false;
            break;
          }
        }
      }
      if (KEEP_FILE.keep) {
        if (KEEP_FILE.log) console.log('Keeping:', file);
        return false;
      }
      return true;
    },
    // ignore: [
    //   /node_modules\/(?!(better-sqlite3|bindings|file-uri-to-path)\/)/,
    // ],
    prune: true,
    overwrite: true,
    // extraResource: [
    //    // Only include these paths if they exist
    //    ...(() => {
    //     const resources:Array<string>= [];
    //     const sqlite3Path = path.join(__dirname, 'node_modules/sqlite3/lib/binding');
    //     const betterSqlitePath = path.join(__dirname, 'node_modules/better-sqlite3/build/Release');
        
    //     if (fsSync.existsSync(sqlite3Path)) {
    //       resources.push(sqlite3Path);
    //     }
        
    //     if (fsSync.existsSync(betterSqlitePath)) {
    //       resources.push(betterSqlitePath);
    //     }
        
    //     return resources;
    //   })()
    // ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: process.env.APP_NAME || 'aiFetchly',
        certificateFile: './cert.pfx',
        certificatePassword: process.env.CERTIFICATE_PASSWORD,
        // iconUrl should be a valid HTTP/HTTPS URL, not a local path
        // iconUrl: './src/assets/images/icon.png',
        setupIcon: './src/assets/images/icon.ico',
        // Custom installer options
        // loadingGif should be a valid HTTP/HTTPS URL, not a local path
        // loadingGif: './src/assets/images/installer-loading.gif', // Optional: Add a loading gif
        setupExe: 'aiFetchlySetup.exe',
        // Allow users to choose installation directory
        allowDirectorySelection: true,
        // Create desktop shortcut
        createDesktopIcon: true,
        // Create start menu shortcut
        createStartMenuShortcut: true,
        // Install for all users (requires admin)
        installForAllUsers: false,
        // Custom installation directory
        defaultInstallLocation: '%LOCALAPPDATA%\\aiFetchly',
        // Additional options
        noMsi: true,
        // Custom installer text
        title: 'aiFetchly Installer',
        description: 'Install aiFetchly application',
        authors: 'Robert Zeng',
        // Registry entries for uninstall
        registry: {
          key: 'Software\\aiFetchly',
          name: 'InstallLocation'
        },
        // Uninstall configuration
        uninstallIcon: './src/assets/images/icon.ico',
        // Custom uninstall script
        uninstallScript: './installer-scripts/uninstall-windows.js',
        // Include uninstaller in the installer
        extraFiles: [
          {
            src: './installer-scripts/uninstall.exe',
            dest: 'uninstall.exe'
          }
        ],
        // Post-installation script to copy uninstaller
        postInstallScript: './installer-scripts/copy-uninstaller.js',
        // Ensure uninstaller is accessible
        setupExe: 'aiFetchlySetup.exe',
        // Create uninstaller registry entry
        uninstallDisplayName: 'aiFetchly',
        uninstallString: '%LOCALAPPDATA%\\aiFetchly\\uninstall.exe'
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
        icon: './src/assets/images/icon.icns',
        background: './src/assets/images/dmg-background.png',
        contents: [
          {
            x: 130,
            y: 220
          },
          {
            x: 410,
            y: 220,
            type: 'link',
            path: '/Applications'
          }
        ],
        window: {
          width: 540,
          height: 380
        }
      }
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: './src/assets/images/icon.png',
          // Custom installer options for Linux
          maintainer: 'Robert Zeng',
          homepage: 'https://github.com/robertzengcn/aiFetchly',
          categories: ['Utility', 'Network', 'Web'],
          // Allow users to choose installation directory
          section: 'utils',
          priority: 'optional',
          // Create desktop shortcut
          desktop: {
            Name: 'aiFetchly',
            Comment: 'aiFetchly Application',
            GenericName: 'aiFetchly',
            Categories: 'Utility;Network;Web;',
            Keywords: 'ai;marketing;automation;'
          },
          // Custom installation directory
          installDir: '/opt/aifetchly',
          // Additional options
          depends: ['nodejs', 'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libdrm2', 'libxkbcommon0', 'libxcomposite1', 'libxdamage1', 'libxfixes3', 'libxrandr2', 'libgbm1', 'libasound2']
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          icon: './src/assets/images/icon.png',
          // Custom installer options for RPM
          maintainer: 'Robert Zeng',
          homepage: 'https://github.com/robertzengcn/aiFetchly',
          categories: ['Utility', 'Network', 'Web'],
          // Allow users to choose installation directory
          section: 'utils',
          priority: 'optional',
          // Create desktop shortcut
          desktop: {
            Name: 'aiFetchly',
            Comment: 'aiFetchly Application',
            GenericName: 'aiFetchly',
            Categories: 'Utility;Network;Web;',
            Keywords: 'social;marketing;automation;'
          },
          // Custom installation directory
          installDir: '/opt/aifetchly',
          // Additional options
          depends: ['nodejs', 'gtk3', 'libnotify', 'nss', 'libXScrnSaver', 'libXtst', 'xdg-utils', 'atk', 'libdrm', 'libxkbcommon', 'libXcomposite', 'libXdamage', 'libXfixes', 'libXrandr', 'mesa-libgbm', 'alsa-lib']
        }
      },
    },
    {
      name: '@electron-forge/maker-wix',
      config: {
        language: 1033,
        manufacturer: 'Robert Zeng',
        icon: './src/assets/images/icon.ico',
        // Custom UI template
        ui:{
          chooseDirectory: true,
          //template: './wix-ui-template.xml'
          // images:{
          //   infoIcon: './src/assets/images/icon.ico'
          // }
        },
        // Installation directory options
        installDir: 'C:\\Program Files\\aiFetchly',
        // Create desktop shortcut
        createDesktopShortcut: true,
        // Create start menu shortcut
        createStartMenuShortcut: true,
        // Install for all users
        //perMachine: false,
        // Custom images for installer
        images: {
          background: './src/assets/images/installer-background-493x312.bmp',
          banner: './src/assets/images/installer-banner-493x58.bmp'
        },
        // Additional features
        features: {
          // Main application feature
          main: {
            title: 'aiFetchly Application',
            description: 'Main application files',
            level: 1
          },
          // Desktop shortcut feature
          desktopShortcut: {
            title: 'Desktop Shortcut',
            description: 'Create a shortcut on the desktop',
            level: 1
          },
          // Start menu shortcut feature
          startMenuShortcut: {
            title: 'Start Menu Shortcut',
            description: 'Create a shortcut in the start menu',
            level: 1
          }
        }
      },
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be
        // Main process, Preload scripts, Worker process, etc.
        build: [
          {
            // `entry` is an alias for `build.lib.entry`
            // in the corresponding file of `config`.
            entry: 'src/background',
            config: 'vite.main.config.mjs'
          },
          {
            entry: 'src/preload.ts',
            config: 'vite.preload.config.mjs'
          },
          // {
          //   entry: 'src/utilityCode.ts',
          //   config: 'vite.utilityCode.config.mjs'
          // },
          {
            entry: 'src/taskCode.ts',
            config: 'vite.taskCode.config.mjs'
          },
          {
            entry: 'src/childprocess/yellowPagesScraper.ts',
            config: 'vite.yellowPages.config.mjs'
          },
          // {
          //   entry: 'src/buckEmail.ts',
          //   config: 'vite.buckEmail.config.mjs'
          // },

        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.render.config.mjs'
          }
        ]
      }
    }
  ],
  hooks: {
    postPackage: async (forgeConfig, options) => {
      // Copy uninstaller to the packaged application
      const { postInstallHook } = require('./installer-scripts/post-install-hook.js');
      
      console.log('Running post-package hook...');
      console.log('Output directory:', options.outputPaths[0]);
      
      // Set the installation directory to the output directory
      process.env.INSTALLDIR = options.outputPaths[0];
      
      const success = postInstallHook();
      if (success) {
        console.log('✅ Uninstaller copied to packaged application');
      } else {
        console.log('❌ Failed to copy uninstaller to packaged application');
      }
    },
    prePackage: async () => {
      const projectRoot = normalize(__dirname);
      const getExternalNestedDependencies = async (
        nodeModuleNames,
        includeNestedDeps = true
      ) => {
        const foundModules = new Set(nodeModuleNames);
        if (includeNestedDeps) {
          for (const external of nodeModuleNames) {
            /**
             * @template T
             * @typedef {Object.<keyof T, T[keyof T]>} MyPublicClass
             */
            /**
             * @typedef {MyPublicClass<Walker> & {modules: Module[], walkDependenciesForModule: (moduleRoot: string, depType: DepType) => Promise<void>}} MyPublicWalker
             */
            const moduleRoot = join(projectRoot, 'node_modules', external);
            const walker = new Walker(moduleRoot);
            walker.modules = [];
            await walker.walkDependenciesForModule(moduleRoot, DepType.PROD);
            walker.modules
              .filter((dep) => dep.nativeModuleType === DepType.PROD)
              // for a package like '@realm/fetch', need to split the path and just take the first part
              .map((dep) => dep.name.split('/')[0])
              .forEach((name) => foundModules.add(name));
          }
        }
        return foundModules;
      };
      const nativeModuleDependencies =
        await getExternalNestedDependencies(EXTERNAL_DEPENDENCIES);
      nativeModuleDependenciesToPackage = Array.from(nativeModuleDependencies);
    },
  //   packageAfterPrune: async (_config, buildPath) => {
  //     const gypPath = path.join(
  //       buildPath,
  //       'node_modules',
  //       'bufferutil',
  //       'build',
  //       'node_gyp_bins'
  //     );
  //     await fs.rm(gypPath, {recursive: true, force: true});
  //     const utfPaht=path.join(
  //       buildPath,
  //       'node_modules',
  //       'utf-8-validate',
  //       'build',
  //       'node_gyp_bins'
  //     );
  //     await fs.rm(utfPaht, {recursive: true, force: true});

  //  }
  packageAfterPrune: async (_forgeConfig, buildPath) => {
    function getItemsFromFolder(
      path,
      totalCollection = []
    ) {
      try {
        const normalizedPath = normalize(path);
        const childItems = readdirSync(normalizedPath);
        const getItemStats = statSync(normalizedPath);
        if (getItemStats.isDirectory()) {
          totalCollection.push({
            path: normalizedPath,
            type: 'directory',
            empty: childItems.length === 0,
          });
        }
        childItems.forEach((childItem) => {
          const childItemNormalizedPath = join(normalizedPath, childItem);
          const childItemStats = statSync(childItemNormalizedPath);
          if (childItemStats.isDirectory()) {
            getItemsFromFolder(childItemNormalizedPath, totalCollection);
          } else {
            totalCollection.push({
              path: childItemNormalizedPath,
              type: 'file',
              empty: false,
            });
          }
        });
      } catch {
        return;
      }
      return totalCollection;
    }

    const getItems = getItemsFromFolder(buildPath) ?? [];
    for (const item of getItems) {
      const DELETE_EMPTY_DIRECTORIES = true;
      if (item.empty === true) {
        if (DELETE_EMPTY_DIRECTORIES) {
          const pathToDelete = normalize(item.path);
          // one last check to make sure it is a directory and is empty
          const stats = statSync(pathToDelete);
          if (!stats.isDirectory()) {
            // SKIPPING DELETION: pathToDelete is not a directory
            return;
          }
          const childItems = readdirSync(pathToDelete);
          if (childItems.length !== 0) {
            // SKIPPING DELETION: pathToDelete is not empty
            return;
          }
          rmdirSync(pathToDelete);
        }
      }
    }
  },
  }
};

