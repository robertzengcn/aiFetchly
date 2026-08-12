# Publish AiFetchly through the Microsoft Store

AiFetchly uses the Microsoft Store MSIX distribution path. The GitHub workflow
creates an **unsigned** `.msix` submission package. Microsoft re-signs that
package after Store certification, so this path does not use a PFX certificate
or certificate password.

The existing signed MSI path remains available for direct downloads. Microsoft
does not sign MSI or EXE installers, so a direct-download production build still
requires `WINDOWS_CERTIFICATE_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`.

## One-time Partner Center setup

1. Create a Microsoft Partner Center developer account and reserve the AiFetchly
   product name.
2. Open the product in Partner Center and go to **Product management > Product
   identity**.
3. Copy these values exactly as Partner Center displays them:
   - Package/Identity/Name
   - Package/Identity/Publisher
   - Publisher display name
4. In the GitHub repository, open **Settings > Secrets and variables > Actions >
   Variables** and create:
   - `WINDOWS_STORE_PACKAGE_IDENTITY` = Package/Identity/Name
   - `WINDOWS_STORE_PUBLISHER` = Package/Identity/Publisher (normally starts
     with `CN=`)
   - `WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` = Publisher display name

These values are public package metadata, so repository variables are preferred
over encrypted secrets.

## Build and submit

1. Open the **Manual Release Build** workflow in GitHub Actions.
2. Choose **Run workflow**, select `store`, and start the run. A push to
   `master` also creates the Store package.
3. Download the `electron-app-windows-store-...` workflow artifact and extract
   the `.msix` file.
4. Upload the unsigned `.msix` on the submission's **Packages** page in Partner
   Center. Do not sign it with a self-signed certificate first.
5. Complete the Store listing, pricing/availability, age ratings, privacy URL,
   declarations, and certification notes, then submit for certification.

The unsigned workflow artifact is for Partner Center submission, not direct
installation. After certification, customers receive Microsoft's signed copy
through the Store, and Store updates are managed by Microsoft. AiFetchly already
detects `process.windowsStore` at runtime and disables its GitHub updater for
the MSIX build.

## References

- [Microsoft: code signing options for Windows apps](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Electron Forge: MSIX maker](https://www.electronforge.io/config/makers/msix)
- [Microsoft Partner Center](https://partner.microsoft.com/dashboard)
