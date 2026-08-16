# Master Push MSI Design

## Goal

When the release workflow runs for a push to `master`, produce an unsigned, production-configured Windows MSI for local installation testing in addition to the existing unsigned Microsoft Store MSIX package.

## Design

The Windows release job will continue to build the Store MSIX first with the existing `make-win:store` command and Store identity variables. For `master` push events only, it will then run the Electron Forge WiX maker against the Windows application package produced by that build.

The MSI pass will reuse the packaged application through Forge's `--skip-package` option. It will run with `NODE_ENV=production` and retain `WINDOWS_DISTRIBUTION=store`, which keeps Windows signing disabled while preserving the production application configuration. Manual Store builds will continue to create only the MSIX.

The WiX Toolset installation step will run for direct-distribution builds and `master` pushes. The existing artifact upload patterns already include both `*.msix` and `*.msi`, so both installers will be available in the same Windows workflow artifact. A validation step will explicitly require both formats on `master` pushes before the artifact is uploaded.

## Error Handling

The workflow will fail if WiX installation fails, the WiX maker fails, or either expected installer type is missing.

## Verification

The Windows Store packaging test will assert that the release workflow:

- retains the Store MSIX build for `master` pushes;
- installs WiX for `master` pushes;
- invokes the WiX maker with package reuse for `master` pushes; and
- validates that both installer formats were generated; and
- uploads both MSI and MSIX files.

The focused packaging test and a YAML parse check will be run after implementation.
