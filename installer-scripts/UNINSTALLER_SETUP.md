# Standalone Uninstaller Setup

This document explains how the standalone uninstaller is set up and built for the aiFetchly application.

## Overview

The standalone uninstaller (`uninstall.exe`) is automatically generated during the build process and provides users with a clean way to uninstall the application.

## Files

- `standalone-uninstaller.js` - Main uninstaller script
- `standalone-uninstaller-package.json` - Package configuration for building the executable
- `copy-uninstaller.js` - Script to copy uninstaller to installation directory
- `uninstall-windows.js` - Core uninstall logic (shared with other uninstall methods)

## Build Process

### Local Development

```bash
# Build uninstaller locally
npm run build-uninstaller

# Build Windows installer with uninstaller
yarn make-win:test
yarn make-win:prod
```

### CI/CD (GitHub Actions)

The uninstaller is automatically built as part of the GitHub Actions workflow:

1. **Build uninstaller step** - Creates the standalone executable
2. **Build application step** - Includes uninstaller in the main installer
3. **Upload artifacts** - Both main installer and standalone uninstaller are uploaded

## How It Works

### 1. Uninstaller Creation

The uninstaller is built using `pkg` to create a standalone executable:

```bash
pkg standalone-uninstaller.js --targets node18-win-x64 --output uninstall.exe
```

### 2. WiX Integration

The uninstaller is included in the WiX installer through:

- **extraFiles** - Includes uninstall.exe in the installer package
- **customActions** - Copies uninstaller to installation directory during install
- **uninstallCustomActions** - Runs cleanup during uninstall

### 3. User Experience

Users can uninstall the application in multiple ways:

1. **Windows Add/Remove Programs** - Standard Windows uninstall
2. **uninstall.exe** - Standalone executable in installation directory
3. **Command line** - Direct execution with parameters

## Configuration

### Package.json Scripts

```json
{
  "build-uninstaller": "cd installer-scripts && npm install --package-lock=false && npm run build",
  "make-win:test": "npm run build-uninstaller && cross-env NODE_ENV=test electron-forge make --platform=win32",
  "make-win:prod": "npm run build-uninstaller && cross-env NODE_ENV=production electron-forge make --platform=win32"
}
```

### Forge Configuration

The WiX maker is configured to include the uninstaller:

```javascript
{
  name: '@electron-forge/maker-wix',
  config: {
    extraFiles: [
      {
        src: './installer-scripts/uninstall.exe',
        dest: 'uninstall.exe'
      }
    ],
    customActions: [
      {
        name: 'CopyUninstaller',
        description: 'Copy uninstall.exe to installation directory',
        script: './installer-scripts/copy-uninstaller.js'
      }
    ]
  }
}
```

## Testing

### Local Testing

```bash
# Test uninstaller creation
npm run build-uninstaller

# Test uninstaller execution
cd installer-scripts
./uninstall.exe

# Test with parameters
./uninstall.exe aiFetchly "C:\Program Files\aiFetchly"
```

### CI Testing

The GitHub Actions workflow includes verification steps:

- Verifies uninstaller creation
- Checks installer output
- Uploads both artifacts for testing

## Troubleshooting

### Common Issues

1. **Uninstaller not created**
   - Check if `pkg` is installed globally
   - Verify Node.js version compatibility
   - Check for missing dependencies

2. **Uninstaller not included in installer**
   - Verify `extraFiles` configuration in forge.config.js
   - Check if uninstall.exe exists before building
   - Ensure custom actions are properly configured

3. **Uninstaller doesn't work**
   - Check if uninstall-windows.js is accessible
   - Verify registry permissions
   - Test with administrator privileges

### Debug Commands

```bash
# Check if uninstaller exists
ls -la installer-scripts/uninstall.exe

# Test uninstaller with verbose output
cd installer-scripts
node standalone-uninstaller.js

# Check installer contents
# (Use 7-Zip or similar to examine the MSI file)
```

## Maintenance

### Updating Uninstaller

1. Modify `standalone-uninstaller.js` for UI changes
2. Update `uninstall-windows.js` for core uninstall logic
3. Test locally with `npm run build-uninstaller`
4. Commit changes to trigger CI build

### Version Management

The uninstaller version is managed through:
- Package.json version in the main project
- GitHub Actions build number
- Uninstaller displays version from registry

## Security Considerations

- Uninstaller requires appropriate permissions to modify registry
- User data removal is optional and configurable
- Registry cleanup is comprehensive but safe
- File system operations are validated before execution
