---
quick_id: 260730-mqb
status: complete
commit: e83e961d
---

# Manual release workflow hardening summary

- Added manual test/production build selection while preserving test as the default.
- Replaced broad and error-swallowing native rebuilds with lockfile-based, targeted rebuilds.
- Added Windows signing and macOS signing/notarization for production builds with fail-closed secret validation.
- Removed Forge references to missing custom installer resources and retained standard installer behavior.
- Kept release publication manual and restricted artifacts to `.exe`, `.msi`, `.dmg`, and `.zip` installers.
- Updated the release workflow documentation and required-secret list.

Validation passed: `actionlint`, Ruby YAML parsing, Prettier, `git diff --check`, Forge test configuration checks, macOS production signing configuration check, and Windows missing-certificate fail-closed check.
