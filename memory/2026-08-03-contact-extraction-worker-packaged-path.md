# Contact Extraction Worker Packaged Path Debug

## Symptom

Windows packaged app repeatedly restarted the contact extraction worker. Node
reported `MODULE_NOT_FOUND` for:

`resources/app.asar/.vite/build/ContactExtractionWorker.js`

## Root Cause

The contact extraction IPC launcher built the worker path from `__dirname` and
passed the resulting `app.asar` path directly to plain Node. Forge unpacks
`.vite`, so the packaged worker is available from the mirror path under
`app.asar.unpacked`, not from inside `app.asar`.

## Fix

- Added an unpack-aware contact extraction worker path resolver.
- Updated the worker launcher to use the resolver before spawning Node.
- Added a regression test for local Vite output, packaged `app.asar`, and
  Windows `app.asar` path mirroring.
- Updated packaged child-process verification to require
  `.vite/build/ContactExtractionWorker.js`.

## Evidence

- `npx vitest --config vite.main.config.mjs run test/vitest/main/contactExtractionWorkerPath.test.ts test/vitest/main/WebsiteContentScrapeService.workerPath.test.ts test/vitest/main/ForgePackagingDependencies.test.ts`
  - 3 files passed, 9 tests passed.
- `git diff --check`
  - Passed.
- `scripts/verify-packaged-childprocess.js` was exercised against a temporary
  fake packaged resources folder and found
  `app.asar.unpacked/.vite/build/ContactExtractionWorker.js`.

## Status

DONE
