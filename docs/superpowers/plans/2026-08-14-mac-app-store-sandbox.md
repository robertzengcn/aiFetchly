# Mac App Store Sandbox Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a development-signed Electron `mas` packaging command and verifier for a sandboxed `com.aifetchly.desktop` app while preserving direct macOS notarization.

**Architecture:** `forge.config.js` selects direct or store behavior from `MAC_DISTRIBUTION`. Store signing uses committed minimal main and child entitlements plus a development provisioning profile; a standalone verifier inspects the generated app with `plutil` and `codesign`.

**Tech Stack:** Electron Forge 7, Electron Packager `mas`, `@electron/osx-sign`, Node.js CommonJS, Mocha/Chai, macOS `plutil` and `codesign`.

## Global Constraints

- Bundle ID is exactly `com.aifetchly.desktop` in both macOS modes.
- Store development packaging is selected only by `MAC_DISTRIBUTION=store`.
- Store development packaging requires `MAC_STORE_SIGNING_IDENTITY` and `MAC_STORE_PROVISIONING_PROFILE`.
- Store packaging never configures Apple notarization.
- Direct production packaging retains Developer ID signing and notarization.
- Main entitlements are limited to App Sandbox, outgoing networking, user-selected read/write, and app-scoped bookmarks.
- Child entitlements are limited to App Sandbox and inheritance.
- Do not add a `.pkg` maker, upload flow, Apple Distribution signing, or speculative sandbox permissions.

---

### Task 1: MAS configuration and entitlement contract

**Files:**
- Create: `build/entitlements.mas.plist`
- Create: `build/entitlements.mas.inherit.plist`
- Create: `test/modules/forgeMacStorePackaging.test.ts`
- Modify: `forge.config.js:330-520`
- Modify: `package.json:20-40`

**Interfaces:**
- Consumes: `NODE_ENV`, `MAC_DISTRIBUTION`, `MAC_STORE_SIGNING_IDENTITY`, `MAC_STORE_PROVISIONING_PROFILE`, and existing notarization variables.
- Produces: `packagerConfig.appBundleId`, store-specific `packagerConfig.osxSign`, and `yarn package-mac:store`.

- [ ] **Step 1: Write failing Forge configuration tests**

Create a helper that starts a fresh Node process, presents the host as `darwin`, loads `forge.config.js`, and prints this safe projection:

```typescript
interface MacConfigProjection {
  appBundleId?: string;
  osxNotarizeConfigured: boolean;
  identity?: string | null;
  type?: string;
  provisioningProfile?: string;
  mainEntitlements?: string;
  childEntitlements?: string;
}
```

Test the store projection:

```typescript
expect(store.appBundleId).to.equal("com.aifetchly.desktop");
expect(store.osxNotarizeConfigured).to.equal(false);
expect(store.identity).to.equal("Apple Development: Test Developer (TESTTEAM)");
expect(store.type).to.equal("development");
expect(store.provisioningProfile).to.equal(profilePath);
expect(store.mainEntitlements).to.equal(mainEntitlementsPath);
expect(store.childEntitlements).to.equal(childEntitlementsPath);
```

Also assert direct production still configures notarization without a provisioning profile, and missing store identity/profile values fail with the exact variable name.

- [ ] **Step 2: Run the test and verify RED**

```bash
PATH="/Users/cengjianze/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" yarn test test/modules/forgeMacStorePackaging.test.ts
```

Expected: FAIL because the MAS configuration and entitlement files do not exist.

- [ ] **Step 3: Add minimal entitlement files**

Main file keys:

```xml
<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.network.client</key><true/>
<key>com.apple.security.files.user-selected.read-write</key><true/>
<key>com.apple.security.files.bookmarks.app-scope</key><true/>
```

Child file keys:

```xml
<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.inherit</key><true/>
```

- [ ] **Step 4: Implement environment-driven MAS signing**

Add store detection, resolved entitlement paths, and this file classifier:

```javascript
function isMainApplicationBundle(filePath) {
  return filePath.endsWith(".app") && !filePath.includes(".app/Contents/");
}
```

Set `appBundleId: "com.aifetchly.desktop"`. For production macOS store builds, resolve and validate the profile path and configure:

```javascript
osxSign: {
  identity: requireProductionEnv("MAC_STORE_SIGNING_IDENTITY"),
  type: "development",
  provisioningProfile: macStoreProvisioningProfilePath,
  optionsForFile: (filePath) => ({
    entitlements: isMainApplicationBundle(filePath)
      ? macStoreEntitlementsPath
      : macStoreChildEntitlementsPath,
  }),
}
```

Keep the existing `osxSign: {}` plus `osxNotarize` only in the non-store branch.

- [ ] **Step 5: Add the local package command**

```json
"package-mac:store": "yarn rebuild-native && cross-env NODE_ENV=production MAC_DISTRIBUTION=store electron-forge package --platform=mas"
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run the Task 1 test again. Expected: all cases pass.

- [ ] **Step 7: Commit**

```bash
git add build/entitlements.mas.plist build/entitlements.mas.inherit.plist forge.config.js package.json test/modules/forgeMacStorePackaging.test.ts
git commit -m "feat: add sandboxed Mac App Store packaging path"
```

### Task 2: Packaged MAS application verifier

**Files:**
- Create: `scripts/verify-mac-store-app.js`
- Create: `test/modules/verifyMacStoreApp.test.ts`
- Modify: `package.json:20-50`

**Interfaces:**
- Consumes: one `.app` path, `Contents/Info.plist`, and signatures readable through `codesign`.
- Produces: `verifyMacStoreApp(appPath, dependencies?)`, exit status 0 on success, and actionable exceptions on failure.

- [ ] **Step 1: Write failing verifier tests**

Create a filesystem fixture with `Contents/Info.plist` and nested Electron helper `.app` directories. Inject command execution so tests can provide deterministic `plutil` and `codesign` output without a checked-in signed binary.

Test separately:

```typescript
expect(() => verifyMacStoreApp(appPath, validDependencies)).not.to.throw();
expect(() => verifyMacStoreApp(wrongBundleApp, dependencies)).to.throw(/Expected bundle ID/);
expect(() => verifyMacStoreApp(appPath, missingSandbox)).to.throw(/app-sandbox/);
expect(() => verifyMacStoreApp(appPath, helperWithoutInheritance)).to.throw(/security.inherit/);
```

- [ ] **Step 2: Run verifier tests and verify RED**

```bash
PATH="/Users/cengjianze/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" yarn test test/modules/verifyMacStoreApp.test.ts
```

Expected: FAIL because `scripts/verify-mac-store-app.js` does not exist.

- [ ] **Step 3: Implement the verifier**

Implement these algorithms (with `fs`, `path`, and `plist` imported at module
scope and `runCommand(command, args)` returning stdout when present, otherwise
stderr because `codesign -d` writes its property list to stderr):

```javascript
function findElectronHelperApps(appPath) {
  const frameworksPath = path.join(appPath, "Contents", "Frameworks");
  return fs.readdirSync(frameworksPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && / Helper.*\.app$/.test(entry.name))
    .map((entry) => path.join(frameworksPath, entry.name));
}

function readBundleIdentifier(appPath, runCommand) {
  return runCommand("plutil", [
    "-extract", "CFBundleIdentifier", "raw",
    path.join(appPath, "Contents", "Info.plist"),
  ]).trim();
}

function readEntitlements(targetPath, runCommand) {
  return plist.parse(runCommand("codesign", [
    "-d", "--entitlements", ":-", targetPath,
  ]));
}

function requireBooleanEntitlement(entitlements, key, targetPath) {
  if (entitlements[key] !== true) {
    throw new Error(`${targetPath} is missing required entitlement ${key}.`);
  }
}

function verifyMacStoreApp(appPath, dependencies = defaultDependencies) {
  if (!dependencies.existsSync(appPath)) {
    throw new Error(`Application bundle does not exist: ${appPath}`);
  }
  const bundleIdentifier = readBundleIdentifier(appPath, dependencies.runCommand);
  if (bundleIdentifier !== "com.aifetchly.desktop") {
    throw new Error(`Expected bundle ID com.aifetchly.desktop, received ${bundleIdentifier}.`);
  }
  const mainEntitlements = readEntitlements(appPath, dependencies.runCommand);
  for (const key of MAIN_REQUIRED_ENTITLEMENTS) {
    requireBooleanEntitlement(mainEntitlements, key, appPath);
  }
  const helpers = findElectronHelperApps(appPath);
  if (helpers.length === 0) {
    throw new Error(`No Electron helper applications found in ${appPath}.`);
  }
  for (const helperPath of helpers) {
    const helperEntitlements = readEntitlements(helperPath, dependencies.runCommand);
    requireBooleanEntitlement(helperEntitlements, "com.apple.security.app-sandbox", helperPath);
    requireBooleanEntitlement(helperEntitlements, "com.apple.security.inherit", helperPath);
  }
}
```

Use `spawnSync` with arrays and `shell: false`, and parse entitlements with `plist`. Require the four main entitlements. Require every nested helper app to contain sandbox and inheritance. Fail if no helpers are found. Add a `require.main === module` CLI boundary.

- [ ] **Step 4: Add the verifier command**

```json
"verify-mac:store": "node scripts/verify-mac-store-app.js"
```

Usage:

```bash
yarn verify-mac:store "out/aiFetchly-mas-arm64/aiFetchly.app"
```

- [ ] **Step 5: Run both focused tests and verify GREEN**

Expected: all MAS configuration and verifier cases pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-mac-store-app.js test/modules/verifyMacStoreApp.test.ts package.json
git commit -m "test: verify Mac App Store sandbox signatures"
```

### Task 3: Cross-check and project verification

**Files:**
- Modify only files required to fix failures directly caused by Tasks 1-2.

**Interfaces:**
- Consumes: committed implementation and repository verification commands.
- Produces: fresh evidence for focused tests, type checks, lint, and repository integrity.

- [ ] **Step 1: Run focused tests together**

```bash
PATH="/Users/cengjianze/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" yarn test test/modules/forgeMacStorePackaging.test.ts test/modules/verifyMacStoreApp.test.ts
```

Expected: all cases pass.

- [ ] **Step 2: Run static verification**

```bash
yarn lint
yarn typecheck
yarn vue-typecheck
git diff --check
```

Expected: zero errors. Existing warnings may remain.

- [ ] **Step 3: Inspect final repository state**

Confirm only the design, plan, entitlements, MAS configuration, verifier, and tests were added. Confirm no certificate, provisioning profile, Apple password, Team ID secret, or generated `.app` is tracked.

- [ ] **Step 4: Report the credential boundary**

State that an actual MAS package requires an Apple Development identity and development provisioning profile. Report the two environment variables and exact build/verification commands.
