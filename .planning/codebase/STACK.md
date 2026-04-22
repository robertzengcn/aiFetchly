# Technology Stack

**Analysis Date:** 2026-04-22

## Languages

**Primary:**
- TypeScript 5.x (`^5.1.3`) - All source code in `src/`, tests in `test/`, configs in root

**Secondary:**
- JavaScript (ES6+) - Config files (`forge.config.js`, `vue.config.js`, `babel.config.js`)
- HTML/CSS - Vue SFC templates and styles
- JSON - Data configs (`src/config/dependency-catalog.json`)

## Runtime

**Environment:**
- Node.js `>=20.19.3` (current: v22.19.0)
- Electron `^35.0.3` (desktop application runtime)
- Chromium embedded via Electron

**Package Manager:**
- Yarn (yarn.lock present)
- No package-lock.json (Yarn-only)

## Frameworks

**Desktop Application:**
- Electron `^35.0.3` - Desktop app framework with main/renderer process separation
- Electron Forge `^7.8.0` - Build, package, and distribution toolchain
  - Makers: Squirrel (Windows), DMG (macOS), DEB/RPM (Linux), WiX (Windows MSI), ZIP
  - Plugin: `@electron-forge/plugin-vite` for Vite-based builds

**Frontend:**
- Vue 3 `^3.3.4` - UI framework with Composition API
- Vuetify `3.5.15` - Material Design component library
- Pinia `^2.1.7` - State management (replacing Vuex)
- Vue Router `^4.2.5` - Client-side routing
- vue-i18n `9` - Internationalization (en, zh, es, fr, de, ja)
- ApexCharts `^3.44.0` via `vue3-apexcharts` - Data visualization

**Backend (Main Process):**
- TypeORM `^0.3.20` - Database ORM with decorator-based entities
- better-sqlite3 `^11.9.1` - SQLite native driver
- sqlite-vec `^0.1.7-alpha.2` - Vector similarity search extension for SQLite
- reflect-metadata `^0.2.2` - Required by TypeORM decorators

**Build/Dev:**
- Vite `^6.1.1` - Build tool and dev server (multiple config files per entry point)
- @vitejs/plugin-vue `^5.0.3` - Vue SFC support
- @vitejs/plugin-vue-jsx `^3.1.0` - JSX support in Vue
- vite-plugin-checker `^0.7.2` - TypeScript checking during dev
- vite-plugin-vuetify `^2.0.1` - Vuetify tree-shaking/auto-import
- Sass `^1.69.4` - CSS preprocessor

**Testing:**
- Mocha `^10.2.0` - Module/unit tests (CommonJS style with tsx/ts-node)
- Vitest `^1.2.2` - Main process and utility code tests
- Chai `^4.3.7` - Assertion library
- Sinon `^15.2.0` - Test spies/stubs/mocks
- nock `^14.0.1` - HTTP mocking

**Automation & Scraping:**
- Puppeteer `npm:rebrowser-puppeteer@^24.8.1` (aliased package - anti-detection fork)
- puppeteer-extra `^3.3.6` - Plugin system for Puppeteer
- puppeteer-extra-plugin-stealth `^2.11.2` - Anti-detection evasion
- puppeteer-extra-plugin-recaptcha `^3.6.8` - reCAPTCHA handling
- puppeteer-cluster `^0.23.0` - Concurrent browser tab management
- cheerio `^1.0.0-rc.3` - HTML parsing (jQuery-like API)

## Key Dependencies

**AI Integration:**
- openai `^4.87.3` - OpenAI API client (used indirectly via remote AI server)
- ai `^5.0.68` - Vercel AI SDK
- @xenova/transformers `^2.17.2` - Local embedding model inference (Hugging Face)

**Email:**
- nodemailer `^7.0.11` - SMTP email sending

**Data Processing:**
- xlsx `^0.18.5` - Excel file read/write
- papaparse `^5.4.1` - CSV parsing
- turndown `^7.2.1` - HTML to Markdown conversion
- mammoth `^1.11.0` - DOCX to HTML conversion
- pdf-lib `^1.17.1` - PDF manipulation
- pdf2md-ts `^1.1.1` - PDF to Markdown conversion
- diff `^5.2.0` - Text diff generation

**File Operations:**
- fast-glob `^3.3.2` - Fast file system globbing
- write-file-atomic `^5.0.1` - Atomic file writes
- isbinaryfile `^5.0.4` - Binary file detection
- picomatch `^4.0.2` - Glob pattern matching
- adm-zip `^0.5.17` - ZIP archive handling

**Networking:**
- ws `^8.19.0` - WebSocket client (server connection)
- got `^14.4.7` - HTTP client
- node-fetch `^3.3.2` - Fetch API polyfill
- http-proxy-agent `^7.0.2` - HTTP proxy support
- https-proxy-agent `^7.0.4` - HTTPS proxy support
- fetch-socks `^1.3.0` - SOCKS proxy support
- @lem0-packages/puppeteer-page-proxy `^1.4.1` - Per-page proxy in Puppeteer

**Sandboxing & Security:**
- isolated-vm `^6.1.2` - Secure JavaScript sandbox for skill execution
- zod `^3.24.0` - Schema validation

**Authentication:**
- keytar `^7.9.0` - OS-native credential storage
- jwt-decode `3.1.2` - JWT token decoding
- electron-store `8.2.0` - Encrypted local storage

**Scheduling:**
- cron `^2.3.0` - Cron expression parsing and scheduling
- cron-validator `^1.3.1` - Cron expression validation

**Logging:**
- winston `^3.2.1` - Structured logging (file-based)
- electron-log `^5.1.2` - Electron-specific logging
- debug `^4.3.4` - Debug namespaced logging

**Internationalization:**
- iconv-lite `^0.7.2` - Character encoding conversion
- chardet `^2.1.1` - Character encoding detection

**Other:**
- uuid `^9.0.1` - UUID generation
- lodash `^4.17.23` - Utility functions
- date-fns `^4.1.0` - Date formatting
- js-yaml `^4.1.0` - YAML parsing
- @napi-rs/canvas `^0.1.82` - Server-side canvas (replaces node-canvas)

## Configuration

**TypeScript:** `tsconfig.json`
- Target: ES6, Module: ESNext
- Strict mode enabled, `noImplicitAny: false`, `strictPropertyInitialization: false`
- Experimental decorators enabled (TypeORM requirement)
- Path alias: `@/*` maps to `./src/*`
- Test mocks for Electron modules via path aliases (`electron`, `electron-log`, `electron-store`)

**Electron Forge:** `forge.config.js`
- ASAR packaging with unpack for native modules (better-sqlite3, sqlite3, sqlite-vec)
- Platform-specific icon handling (ico/icns/png)
- Custom installer configs per platform (Squirrel, DMG, DEB, RPM, WiX)
- Pre/post package hooks for native module handling
- Flora-colossus walker for transitive native dependency discovery

**Vite Configs (multiple entry points):**
- `vite.render.config.mjs` - Renderer (Vue 3 frontend)
- `vite.main.config.mjs` - Main Electron process
- `vite.preload.config.mjs` - Preload script
- `vite.taskCode.config.mjs` - Task code worker
- `vite.yellowPages.config.mjs` - Yellow Pages scraper worker
- `vite.websiteContentScraper.config.mjs` - Website scraper worker
- `vite.googleProxyCheck.config.mjs` - Google proxy checker worker
- `vite.skillWorker.config.mjs` - Skill execution worker
- `vite.pythonRuntimeWorker.config.mjs` - Python runtime worker
- `vite.contactExtractionWorker.config.mjs` - Contact extraction worker
- `vite.utilityCode.config.mjs` - Utility code testing
- `vite.buckEmail.config.mjs` - Bulk email worker

**Linting:** ESLint (inline config in package.json)
- Extends: `eslint:recommended`, `@vue/typescript`, `plugin:vue/vue3-essential`
- Parser: `@typescript-eslint/parser`
- Husky `^9.1.7` + lint-staged `^16.2.7` for pre-commit hooks

**Environment Variables:**
- `.env` file present (contains secrets - never read contents)
- `.env.example` present (documents required env vars)
- `VITE_LOGIN_URL` - Backend API base URL (embedded at build time via Vite `define`)
- `UPDATESERVER` - Auto-updater server URL
- Build-time mode-specific overrides: `.env.${NODE_ENV}`

## Platform Requirements

**Development:**
- Node.js >= 20.19.3
- Yarn package manager
- Native module compilation toolchain (for better-sqlite3, keytar, isolated-vm)
- Chromium (via Puppeteer/Electron)

**Production Deployment:**
- Cross-platform desktop app: Windows, macOS, Linux
- Electron Forge makers for platform-specific installers
- Custom protocol registration (`aiFetchly://`)
- Auto-update support via electron-updater

---

*Stack analysis: 2026-04-22*
