# Mac App Store Sandbox Packaging Design

## Objective

Add a dedicated development-signed Mac App Store packaging path that produces
an Electron `mas` application for local sandbox compatibility testing. Preserve
the existing Developer ID, notarized ZIP/DMG distribution path unchanged.

This phase does not create a Transporter-ready installer package and does not
claim that every AiFetchly feature already works inside App Sandbox.

## Distribution Modes

AiFetchly will support two macOS distribution modes from the existing Electron
Forge configuration:

- Direct distribution remains the default. It packages Electron for `darwin`,
  signs with Developer ID, notarizes the application, and produces the existing
  ZIP/DMG artifacts.
- Mac App Store development packaging is selected with
  `MAC_DISTRIBUTION=store`. It packages Electron for `mas`, signs with an Apple
  Development identity and development provisioning profile, applies App
  Sandbox entitlements, and skips notarization.

The application bundle identifier is `com.aifetchly.desktop` in both modes.

## Command and Environment Contract

Add a `package-mac:store` package script that invokes Electron Forge packaging
with production application assets and the `mas` platform. The script selects
the store configuration through `MAC_DISTRIBUTION=store`.

The store packaging path requires:

- `MAC_STORE_SIGNING_IDENTITY`: the Apple Development identity available in the
  signing keychain.
- `MAC_STORE_PROVISIONING_PROFILE`: an absolute or repository-relative path to
  the macOS development provisioning profile for `com.aifetchly.desktop`.

Missing values fail configuration immediately with an actionable message. The
existing `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
notarization variables are not required for store development packaging.

## Entitlements

Add two committed property-list files under `build/`.

The main application entitlement file grants only:

- `com.apple.security.app-sandbox`
- `com.apple.security.network.client`
- `com.apple.security.files.user-selected.read-write`
- `com.apple.security.files.bookmarks.app-scope`

The child entitlement file grants:

- `com.apple.security.app-sandbox`
- `com.apple.security.inherit`

The files will not hardcode a Team ID or application group. The installed
`@electron/osx-sign` automation derives `ElectronTeamID`, the application
identifier, developer team identifier, and required application group from the
selected identity and provisioning profile.

Additional permissions such as network server, camera, microphone, USB, broad
filesystem access, or temporary sandbox exceptions are intentionally excluded.
They may be added later only after a locally reproduced sandbox failure proves
that a user-facing feature requires them.

## Forge Configuration

The existing `forge.config.js` remains the single source of packaging behavior.
It will:

1. Detect `MAC_DISTRIBUTION=store`.
2. Set `appBundleId` to `com.aifetchly.desktop`.
3. Configure MAS signing with the development identity, provisioning profile,
   and main/child entitlement selection.
4. Omit notarization for the MAS path.
5. Retain the current Developer ID signing and notarization behavior for direct
   production packaging.

No second Forge configuration will be introduced, avoiding duplicated maker,
hook, dependency-pruning, ASAR, and native-module logic.

## Verification

Automated configuration tests will load Forge under controlled environments and
prove that:

- The MAS path uses `com.aifetchly.desktop`.
- It selects the supplied development identity and provisioning profile.
- It selects the committed main and child entitlement files.
- It does not configure notarization.
- Direct production packaging still configures notarization and does not embed
  the store provisioning profile.
- The committed entitlement files contain the required keys and do not contain
  permissions excluded by this design.

A repository script will accept the path to a packaged `.app` and verify:

- `CFBundleIdentifier` equals `com.aifetchly.desktop`.
- The main signature contains `com.apple.security.app-sandbox=true`.
- The main signature contains outgoing network and user-selected read/write
  entitlements.
- Electron helpers contain the sandbox inheritance entitlement.

The verifier reports missing signing tools or malformed applications with
actionable errors and exits nonzero.

## Expected Local Workflow

1. Install an Apple Development certificate.
2. Create and download a macOS development provisioning profile for
   `com.aifetchly.desktop`.
3. Set `MAC_STORE_SIGNING_IDENTITY` and
   `MAC_STORE_PROVISIONING_PROFILE`.
4. Run `yarn package-mac:store`.
5. Run the MAS verification command against the generated `.app`.
6. Launch the development-signed application on a Mac included in the profile
   and exercise features to identify sandbox incompatibilities.

## Non-Goals

This phase does not:

- Create or sign a `.pkg` installer.
- Upload a build to App Store Connect or Transporter.
- Use an Apple Distribution or Mac Installer Distribution certificate.
- Add App Store metadata, privacy declarations, or review notes.
- Disable or repair every feature that may fail under App Sandbox.
- Add speculative sandbox permissions or temporary exception entitlements.

## Success Criteria

The implementation is complete when the configuration tests pass, the normal
macOS distribution configuration remains intact, and a correctly provisioned
Mac can use the new command to create an Electron `mas` application whose
signatures pass the repository's sandbox verifier.
