# Custom Installer Configuration

This directory contains custom installer configurations and scripts for the aiFetchly Electron application. The installer provides users with options to choose installation location and automatically creates shortcuts in the appropriate system locations.

## Features

### 🎯 Installation Options
- **Custom Installation Directory**: Users can choose where to install the application
- **Desktop Shortcuts**: Automatic creation of desktop shortcuts
- **Start Menu/Applications Menu**: Integration with system application menus
- **Cross-Platform Support**: Windows, macOS, and Linux support

### 🖥️ Platform-Specific Features

#### Windows
- **Squirrel Installer**: Modern Windows installer with automatic updates
- **WiX Installer**: Traditional MSI installer with advanced UI options
- **Registry Integration**: Proper Windows registry entries
- **Start Menu Integration**: Full integration with Windows Start Menu
- **Desktop Shortcuts**: Optional desktop shortcut creation

#### macOS
- **DMG Installer**: Standard macOS disk image installer
- **Applications Folder**: Proper installation to `/Applications`
- **Dock Integration**: Optional dock icon addition
- **Spotlight Indexing**: Automatic Spotlight search integration
- **Launch Agents**: Optional auto-start functionality

#### Linux
- **DEB Package**: Debian/Ubuntu package installer
- **RPM Package**: Red Hat/Fedora package installer
- **Desktop Files**: Proper `.desktop` file integration
- **Menu Categories**: Integration with application menus
- **Dependencies**: Automatic dependency installation

## File Structure

```
installer-scripts/
├── README.md                    # This file
├── installer-config.json        # Configuration documentation
├── create-shortcuts.js          # Windows shortcut creation script
├── create-macos-shortcuts.sh    # macOS shortcut creation script
└── create-linux-shortcuts.sh    # Linux shortcut creation script
```

## Configuration

### Main Configuration (`forge.config.js`)

The main installer configuration is in `forge.config.js` at the project root. Key features:

```javascript
// Windows Squirrel Installer
{
  name: '@electron-forge/maker-squirrel',
  config: {
    allowDirectorySelection: true,        // Let users choose install location
    createDesktopIcon: true,              // Create desktop shortcut
    createStartMenuShortcut: true,        // Create start menu shortcut
    defaultInstallLocation: '%LOCALAPPDATA%\\aiFetchly', // Default location
    installForAllUsers: false,            // Install for current user only
  }
}

// Windows WiX Installer
{
  name: '@electron-forge/maker-wix',
  config: {
    ui: {
      chooseDirectory: true,              // Custom UI for directory selection
      createDesktopShortcut: true,        // Desktop shortcut option
      createStartMenuShortcut: true,      // Start menu shortcut option
      installDir: 'C:\\Program Files\\aiFetchly', // Default location
    }
  }
}

// Linux DEB/RPM Installers
{
  name: '@electron-forge/maker-deb',
  config: {
    options: {
      installDir: '/opt/aifetchly', // Installation directory
      desktop: {                          // Desktop file configuration
        Name: 'aiFetchly',
        Categories: 'Utility;Network;Web;Office;',
      }
    }
  }
}
```

## Usage

### Building Installers

```bash
# Build all platforms
yarn make

# Build specific platform
yarn make-win:test    # Windows
yarn make-mac:test    # macOS
yarn make-linux:test  # Linux
```

### Customizing Installation

#### 1. Change Default Installation Directory

**Windows:**
```javascript
// In forge.config.js
defaultInstallLocation: 'C:\\CustomPath\\aiFetchly'
```

**macOS:**
```javascript
// In forge.config.js
installDir: '/Applications/CustomFolder'
```

**Linux:**
```javascript
// In forge.config.js
installDir: '/usr/local/aifetchly'
```

#### 2. Enable/Disable Shortcuts

**Desktop Shortcuts:**
```javascript
// Windows
createDesktopIcon: true,        // Squirrel
createDesktopShortcut: true,    // WiX

// macOS (in create-macos-shortcuts.sh)
create_desktop_alias            // Function call

// Linux (in create-linux-shortcuts.sh)
create_desktop_shortcut         // Function call
```

**Start Menu/Applications Menu:**
```javascript
// Windows
createStartMenuShortcut: true,  // Squirrel & WiX

// macOS
create_menu_items               // Function call

// Linux
create_desktop_file             // Function call
```

#### 3. Install for All Users (Windows)

```javascript
// In forge.config.js
installForAllUsers: true,       // Requires admin privileges
```

#### 4. Custom Installer UI (Windows WiX)

```javascript
// In forge.config.js
ui: {
  chooseDirectory: true,        // Show directory selection dialog
  license: './LICENSE',         // Show license agreement
  banner: './banner.png',       // Custom banner image
  dialog: './dialog.png',       // Custom dialog image
}
```

## Scripts

### Windows Shortcut Creation (`create-shortcuts.js`)

This script creates Windows shortcuts using VBScript:

```javascript
// Usage
node installer-scripts/create-shortcuts.js [installDir] [appName]

// Example
node installer-scripts/create-shortcuts.js "C:\Program Files\aiFetchly" "aiFetchly"
```

**Features:**
- Desktop shortcut creation
- Start menu shortcut creation
- Proper icon association
- Working directory setup

### macOS Shortcut Creation (`create-macos-shortcuts.sh`)

This script handles macOS-specific shortcuts:

```bash
# Usage
./installer-scripts/create-macos-shortcuts.sh

# Features
- Desktop alias creation
- Applications folder integration
- Spotlight indexing
- Optional dock integration
- Optional launch agent creation
```

### Linux Shortcut Creation (`create-linux-shortcuts.sh`)

This script handles Linux desktop integration:

```bash
# Usage
./installer-scripts/create-linux-shortcuts.sh

# Features
- Desktop file creation
- Menu integration
- Dependency installation
- MIME type setup (optional)
- Autostart configuration (optional)
```

## Customization Examples

### 1. Add Custom Installer Images

Create custom installer images and reference them in `forge.config.js`:

```javascript
// Windows WiX
ui: {
  banner: './src/assets/images/installer-banner.png',
  dialog: './src/assets/images/installer-dialog.png',
}

// Windows Squirrel
loadingGif: './src/assets/images/installer-loading.gif',
```

### 2. Custom Installation Actions

Add custom actions to the WiX installer:

```javascript
customActions: [
  {
    name: 'CustomAction',
    description: 'Custom installation action',
    script: './installer-scripts/custom-action.js'
  }
]
```

### 3. Platform-Specific Dependencies

Configure dependencies for different Linux distributions:

```javascript
// DEB (Debian/Ubuntu)
depends: ['libgtk-3-0', 'libnotify4', 'libnss3']

// RPM (Red Hat/Fedora)
depends: ['gtk3', 'libnotify', 'nss']
```

## Troubleshooting

### Common Issues

1. **Shortcuts Not Created**
   - Check if the installer has proper permissions
   - Verify the application executable path
   - Check script execution logs

2. **Installation Directory Issues**
   - Ensure the directory is writable
   - Check for path length limitations (Windows)
   - Verify directory permissions (Linux/macOS)

3. **Dependencies Missing (Linux)**
   - Run the dependency installation script manually
   - Check package manager availability
   - Verify package names for your distribution

### Debugging

Enable verbose logging in the installer scripts:

```bash
# Linux/macOS
set -x  # Add to script for verbose output

# Windows
# Check Windows Event Viewer for installer logs
```

### Testing

Test the installer on clean virtual machines:

1. **Windows**: Test on Windows 10/11 VMs
2. **macOS**: Test on different macOS versions
3. **Linux**: Test on different distributions (Ubuntu, Fedora, etc.)

## Best Practices

1. **Always test on clean systems** before releasing
2. **Use relative paths** in scripts when possible
3. **Handle errors gracefully** in installation scripts
4. **Provide clear user feedback** during installation
5. **Follow platform conventions** for each OS
6. **Document custom configurations** for team members

## Support

For issues with the custom installer:

1. Check the Electron Forge documentation
2. Review platform-specific installer documentation
3. Test with minimal configuration first
4. Check for updates to Electron Forge makers

## License

This installer configuration is part of the aiFetchly project and follows the same license terms. 