# Auto Release Workflow

This document explains how to set up and use the automatic release workflow for the Electron app.

## Overview

The auto-release workflow (`.github/workflows/release.yml`) automatically builds and releases your Electron app when you push to the `main` branch or create a tag starting with `v*`.

## How It Works

1. **Trigger**: Push to `main` branch or create a tag (e.g., `v1.0.12`)
2. **Build**: Creates builds for both Windows and macOS
3. **Release**: Automatically creates a GitHub release with the built artifacts

## Setup Requirements

### 1. GitHub Secrets

You need to set up the following secrets in your GitHub repository:

Go to your repository → Settings → Secrets and variables → Actions, then add:

- `VITE_REMOTEADD_TEST`: Your test environment remote address
- `VITE_LOGIN_URL_TEST`: Your test environment login URL

### 2. Repository Permissions

Make sure your repository has the following permissions enabled:

1. Go to Settings → Actions → General
2. Under "Workflow permissions", select "Read and write permissions"
3. Check "Allow GitHub Actions to create and approve pull requests"

## Version Management

The workflow automatically manages versioning:

- Extracts the base version from `package.json` (e.g., `1.0.11`)
- Appends the GitHub run number as build number (e.g., `1.0.123`)
- Creates a release tag (e.g., `v1.0.123`)

## Workflow Steps

### 1. Build Windows
- Sets up Node.js 20.18.3
- Installs dependencies with `yarn install`
- Rebuilds native modules (electron, sqlite3, better-sqlite)
- Builds the Windows installer using `yarn make-win:test`
- Uploads the build as an artifact

### 2. Build macOS
- Sets up C++20 environment
- Configures Xcode
- Installs dependencies and rebuilds native modules
- Builds the macOS app using `yarn make-mac:test`
- Uploads the build as an artifact

### 3. Create Release
- Downloads both Windows and macOS artifacts
- Creates a GitHub release with:
  - Tag name: `v{version}`
  - Release name: `Release v{version}`
  - Description with build info and download instructions
  - All build artifacts attached

## Usage

### Automatic Release (Recommended)
Simply push to the `main` branch:
```bash
git push origin main
```

The workflow will automatically:
1. Build both platforms
2. Create a new release
3. Upload the installers

### Manual Release with Tag
Create and push a tag:
```bash
git tag v1.0.12
git push origin v1.0.12
```

## Customization

### Adding Production Environment

To use production environment variables instead of test:

1. Add production secrets to GitHub:
   - `VITE_REMOTEADD_PROD`
   - `VITE_LOGIN_URL_PROD`

2. Create production build scripts in `package.json`:
   ```json
   {
     "scripts": {
       "make-mac:prod": "cross-env NODE_ENV=production electron-forge make --platform=darwin",
       "make-win:prod": "cross-env NODE_ENV=production electron-forge make --platform=win32"
     }
   }
   ```

3. Update the workflow to use production scripts and environment variables.

### Release Notes

To add custom release notes, you can:

1. Create a `CHANGELOG.md` file
2. Modify the workflow to read from it
3. Or manually edit the release description after creation

### Conditional Releases

The workflow only creates releases when pushing to `main` branch. To modify this behavior, edit the condition in the `create-release` job:

```yaml
if: github.ref == 'refs/heads/main'
```

## Troubleshooting

### Common Issues

1. **Build Fails**: Check that all dependencies are properly installed and native modules are rebuilt
2. **Permission Denied**: Ensure repository has proper workflow permissions
3. **Missing Secrets**: Verify all required secrets are set in GitHub repository settings

### Debugging

- Check the Actions tab in your GitHub repository for detailed logs
- Each job (build-windows, build-macos, create-release) has its own logs
- Failed steps will show detailed error messages

## Security Notes

- The workflow uses `GITHUB_TOKEN` for creating releases
- Environment variables are properly secured as GitHub secrets
- Build artifacts are automatically cleaned up after 90 days

## Next Steps

1. Set up the required GitHub secrets
2. Push to `main` branch to trigger the first release
3. Monitor the Actions tab to ensure everything works correctly
4. Consider setting up production environment variables for actual releases 