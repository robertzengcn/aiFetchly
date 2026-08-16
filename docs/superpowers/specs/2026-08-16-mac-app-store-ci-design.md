# Mac App Store CI Package Design

## Objective

Extend the existing sandboxed Electron `mas` packaging path so a manually
dispatched GitHub Actions `store` build produces a signed `.pkg` suitable for
upload to App Store Connect with Transporter.

## Chosen Approach

Use a dedicated `build-macos-store` job in `.github/workflows/release.yml`.
This is preferred over adding branches to the existing direct-distribution
macOS job because the two release paths use different certificates, signing
types, provisioning behavior, outputs, and verification rules. A reusable
workflow was also considered, but would add indirection without a second
consumer.

The job runs only for `workflow_dispatch` with `build_mode=store`. Existing
push, test, production, Windows Store, runtime, and GitHub Release behavior
remains unchanged.

## Credential Contract

The job consumes these GitHub Actions secrets:

- `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`
- `MAC_INSTALLER_DISTRIBUTION_CERTIFICATE_BASE64`
- `MAC_STORE_PROVISIONING_PROFILE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `MAC_STORE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

The two certificate secrets contain base64-encoded `.p12` files. Both files
use `APPLE_CERTIFICATE_PASSWORD`. The provisioning profile secret contains a
base64-encoded Mac App Store distribution profile for
`com.aifetchly.desktop`.

`APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` are validated for release
readiness but are not used to notarize or upload the build. Mac App Store
packages are validated by App Store Connect, not Apple's outside-store
notarization service. Upload remains a manual Transporter step.

## Build and Signing Flow

1. Set up the same Node, Python, Xcode, Homebrew, and native-module toolchain as
   the existing macOS job.
2. Validate every required secret before decoding credentials.
3. Decode both `.p12` files and the provisioning profile into runner-temporary
   paths.
4. Create a temporary keychain, import both certificates, grant Apple signing
   tools access, and make it available to the build.
5. Confirm the configured Apple Distribution identity exists and discover the
   imported `3rd Party Mac Developer Installer` or `Mac Installer Distribution`
   identity for the configured team.
6. Run `yarn package-mac:store` with the decoded profile path and distribution
   signing identity.
7. Locate the single generated top-level `.app` and run
   `yarn verify-mac:store` against it.
8. Build a signed flat installer with `productbuild --component`, installing
   the app into `/Applications`.
9. Verify the app signature with `codesign` and the installer signature with
   `pkgutil --check-signature`.
10. Upload the `.pkg` as a GitHub Actions artifact and always delete the
    temporary keychain.

## Forge Configuration

The `MAC_DISTRIBUTION=store` branch in `forge.config.js` uses
`type: "distribution"`. This is required for App Store Connect submissions;
development-signed MAS applications are only suitable for local testing and
are rejected for submission.

The existing bundle ID, provisioning profile, and App Sandbox entitlement
selection remain unchanged. The direct Developer ID signing and notarization
branch remains unchanged.

## Failure Handling and Security

The job fails before building if a secret is empty, base64 decoding fails, the
configured application identity is absent, the installer identity cannot be
found for `APPLE_TEAM_ID`, packaging produces zero or multiple top-level apps,
or either signature verification fails.

Credentials are written only below `RUNNER_TEMP`; no certificate, profile,
password, or generated package is committed. The temporary keychain is removed
under `always()` even when an earlier step fails.

## Automated Verification

A workflow contract test parses `release.yml` and verifies:

- the store job has the correct dispatch condition;
- all required secrets are wired into the credential step;
- the profile is exposed to Forge as a decoded file path;
- the job invokes `yarn package-mac:store`, `yarn verify-mac:store`, and
  `productbuild`;
- the uploaded artifact includes the generated `.pkg`;
- cleanup runs under `always()`.

The existing Forge test is updated to require distribution signing for the MAS
path. Focused module tests, YAML parsing, and `git diff --check` provide local
verification; the signed package itself can only be produced on GitHub's macOS
runner with the repository secrets.

## Success Criteria

Running **Actions → Manual Release Build → Run workflow → store** produces a
downloadable `AiFetchly-mac-app-store-<version>.pkg`. Its application and
installer signatures validate, and the package is ready to select in
Transporter for manual upload to App Store Connect.
