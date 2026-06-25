# WiX UI Template for aiFetchly Installer

This document describes the custom WiX UI template created for the aiFetchly Windows installer.

## Overview

The `wix-ui-template.xml` file provides a custom user interface for the Windows installer, replacing the default WiX dialogs with branded, user-friendly screens.

## Features

### Custom Dialogs

1. **Custom Welcome Dialog** (`CustomWelcomeDlg`)
   - Branded welcome screen with aiFetchly logo
   - Custom welcome message
   - Navigation to license agreement

2. **Custom License Agreement Dialog** (`CustomLicenseDlg`)
   - License text display with scrollable area
   - Checkbox for license acceptance
   - Print functionality for license
   - Navigation controls

3. **Custom Installation Directory Dialog** (`CustomInstallDirDlg`)
   - Default installation path: `C:\Program Files\aiFetchly`
   - Browse button for custom directory selection
   - Path validation
   - Disk cost calculation

4. **Custom Features Selection Dialog** (`CustomFeaturesDlg`)
   - Feature selection tree
   - Main application files
   - Desktop shortcut option
   - Start menu shortcut option

5. **Custom Progress Dialog** (`CustomProgressDlg`)
   - Installation progress bar
   - Status messages
   - Action descriptions
   - Cancel option

6. **Custom Exit Dialog** (`CustomExitDlg`)
   - Installation completion message
   - Launch application checkbox
   - Finish button

### UI Flow

```
WelcomeDlg → CustomWelcomeDlg → CustomLicenseDlg → CustomInstallDirDlg → CustomFeaturesDlg → CustomProgressDlg → CustomExitDlg
```

### Required Image Assets

The template expects the following image files in `src/assets/images/`:

- `installer-banner-493x58.bmp` - Banner image (493x58 pixels)
- `installer-background-493x312.bmp` - Background image (493x312 pixels)
- `installer-dialog.bmp` - Dialog background image
- `installer-up.bmp` - Up arrow image
- `installer-new.bmp` - New folder image
- `icon.ico` - Application icon

### Configuration in forge.config.js

The WiX maker configuration has been updated to use the custom UI template:

```javascript
{
  name: '@electron-forge/maker-wix',
  config: {
    language: 1033,
    manufacturer: 'Robert Zeng',
    icon: './src/assets/images/icon.ico',
    uiTemplate: './wix-ui-template.xml',
    installDir: 'C:\\Program Files\\aiFetchly',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    perMachine: false,
    images: {
      background: './src/assets/images/installer-background-493x312.bmp',
      banner: './src/assets/images/installer-banner-493x58.bmp'
    },
    features: {
      main: {
        title: 'aiFetchly Application',
        description: 'Main application files',
        level: 1
      },
      desktopShortcut: {
        title: 'Desktop Shortcut',
        description: 'Create a shortcut on the desktop',
        level: 1
      },
      startMenuShortcut: {
        title: 'Start Menu Shortcut',
        description: 'Create a shortcut in the start menu',
        level: 1
      }
    }
  }
}
```

## Customization

### Text and Messages

All text strings are defined in the localization section of the template. You can modify:

- Dialog titles
- Button text
- Status messages
- Descriptions
- Error messages

### Images and Branding

Replace the image files in `src/assets/images/` with your custom branding:

- **Banner**: 493x58 pixels, BMP format
- **Background**: 493x312 pixels, BMP format
- **Dialog**: 493x312 pixels, BMP format
- **Icons**: ICO format for Windows compatibility

### Installation Options

Modify the installation behavior by changing:

- Default installation directory
- Feature selection options
- Shortcut creation
- Per-machine vs per-user installation

### License Agreement

The template references a `LICENSE` file in the project root. Ensure this file exists and contains your software license text.

## Building the Installer

To build the Windows installer with the custom UI:

```bash
npm run make
```

The installer will be generated in the `out/make/wix/x64/` directory.

## Troubleshooting

### Common Issues

1. **Missing Image Files**: Ensure all required BMP and ICO files exist in the specified paths
2. **License File**: Make sure the `LICENSE` file exists in the project root
3. **Path Issues**: Verify all file paths in the configuration are correct
4. **Image Dimensions**: Ensure images match the required dimensions exactly

### Validation

The WiX template includes validation for:
- License acceptance
- Installation path
- Feature selection
- File conflicts

## Advanced Features

### Custom Actions

The template includes a custom action to launch the application after installation:

```xml
<CustomAction Id="LaunchApplication" FileKey="WixShellExecTarget" ExeCommand="[#aiFetchly.exe]" Return="asyncNoWait" />
```

### Error Handling

Comprehensive error handling for:
- File conflicts
- Disk space issues
- Permission problems
- Installation failures

### Progress Tracking

Detailed progress information with:
- File installation progress
- Registry updates
- Shortcut creation
- Component installation

## Support

For issues with the WiX UI template, check:

1. WiX documentation: https://wixtoolset.org/documentation/
2. Electron Forge documentation: https://www.electronforge.io/
3. Project-specific configuration in `forge.config.js`

## License

This WiX UI template is part of the aiFetchly project and follows the same license terms.
