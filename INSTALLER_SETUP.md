# Custom Installer Setup for aiFetchly

## 🎯 Overview

This project now includes a comprehensive custom installer system that allows users to:
- **Choose installation location** on all platforms
- **Create desktop shortcuts** automatically
- **Add to system menus** (Start Menu, Applications, etc.)
- **Cross-platform support** for Windows, macOS, and Linux

## 🚀 Quick Start

### 1. Test the Configuration
```bash
yarn test-installer
```

### 2. Build Installers
```bash
# Build for specific platform (test environment)
yarn make-win:test    # Windows
yarn make-mac:test    # macOS  
yarn make-linux:test  # Linux

# Build for production
yarn make-win:prod    # Windows
yarn make-mac:prod    # macOS
yarn make-linux:prod  # Linux

# Build all platforms for production
yarn make-installer
```

## 📁 File Structure

```
project/
├── forge.config.js                    # Main installer configuration
├── installer-scripts/                 # Custom installer scripts
│   ├── README.md                      # Detailed documentation
│   ├── installer-config.json          # Configuration reference
│   ├── create-shortcuts.js            # Windows shortcut creation
│   ├── create-macos-shortcuts.sh      # macOS shortcut creation
│   ├── create-linux-shortcuts.sh      # Linux shortcut creation
│   ├── uninstall-windows.js           # Windows uninstall script
│   ├── uninstall-macos.sh             # macOS uninstall script
│   ├── uninstall-linux.sh             # Linux uninstall script
│   ├── UNINSTALL_GUIDE.md             # Uninstall documentation
│   └── test-installer.js              # Configuration validation
└── src/assets/images/                 # Installer assets
    ├── icon.ico                       # Windows icon
    ├── icon.icns                      # macOS icon
    └── icon.png                       # Linux icon
```

## 🖥️ Platform-Specific Features

### Windows
- **Squirrel Installer**: Modern installer with auto-updates
- **WiX Installer**: Traditional MSI with advanced UI
- **Custom Installation Directory**: Users can choose where to install
- **Desktop & Start Menu Shortcuts**: Automatic shortcut creation
- **Registry Integration**: Proper Windows registry entries

### macOS
- **DMG Installer**: Standard macOS disk image
- **Applications Folder**: Proper `/Applications` installation
- **Desktop Alias**: Optional desktop shortcut
- **Spotlight Integration**: Automatic search indexing
- **Dock Integration**: Optional dock icon (disabled by default)

### Linux
- **DEB Package**: Debian/Ubuntu package manager
- **RPM Package**: Red Hat/Fedora package manager
- **Desktop Files**: Proper `.desktop` file integration
- **Menu Integration**: Application menu integration
- **Dependency Management**: Automatic dependency installation

## ⚙️ Configuration Options

### Installation Directory
```javascript
// Windows
defaultInstallLocation: '%LOCALAPPDATA%\\aiFetchly'

// macOS
installDir: '/Applications'

// Linux
installDir: '/opt/aifetchly'
```

### Shortcut Creation
```javascript
// Windows
createDesktopIcon: true,              // Squirrel
createDesktopShortcut: true,          // WiX
createStartMenuShortcut: true,        // Both

// macOS (in script)
create_desktop_alias()                // Desktop alias
create_menu_items()                   // Applications menu

// Linux (in script)
create_desktop_shortcut()             // Desktop shortcut
create_desktop_file()                 // Applications menu
```

### Install for All Users (Windows)
```javascript
installForAllUsers: true,             // Requires admin privileges
```

## 🔧 Customization

### 1. Change Default Installation Path
Edit `forge.config.js` and modify the `defaultInstallLocation` or `installDir` properties.

### 2. Enable/Disable Features
```javascript
// Windows WiX - Custom UI
ui: {
  chooseDirectory: true,              // Show directory selection
  createDesktopShortcut: true,        // Desktop shortcut option
  createStartMenuShortcut: true,      // Start menu shortcut option
  license: './LICENSE',               // Show license agreement
}
```

### 3. Add Custom Installer Images
Create custom images and reference them:
```javascript
// Windows WiX
ui: {
  banner: './src/assets/images/installer-banner.png',
  dialog: './src/assets/images/installer-dialog.png',
}

// Windows Squirrel
loadingGif: './src/assets/images/installer-loading.gif',
```

### 4. Custom Installation Actions
Add custom scripts to the WiX installer:
```javascript
customActions: [
  {
    name: 'CustomAction',
    description: 'Custom installation action',
    script: './installer-scripts/custom-action.js'
  }
]
```

## 📋 Available Scripts

| Script | Description |
|--------|-------------|
| `yarn test-installer` | Validate installer configuration |
| `yarn make` | Build all platforms (development) |
| `yarn make-win:test` | Build Windows installer (test) |
| `yarn make-mac:test` | Build macOS installer (test) |
| `yarn make-linux:test` | Build Linux installer (test) |
| `yarn make-win:prod` | Build Windows installer (production) |
| `yarn make-mac:prod` | Build macOS installer (production) |
| `yarn make-linux:prod` | Build Linux installer (production) |
| `yarn make-installer` | Build all platforms (production) |
| `yarn uninstall-win` | Uninstall Windows application |
| `yarn uninstall-mac` | Uninstall macOS application |
| `yarn uninstall-linux` | Uninstall Linux application |

## 🔍 Testing

### 1. Configuration Validation
```bash
yarn test-installer
```

### 2. Build Test Installers
```bash
# Test on your current platform
yarn make-win:test    # Windows
yarn make-mac:test    # macOS
yarn make-linux:test  # Linux
```

### 3. Test on Clean Systems
- **Windows**: Test on Windows 10/11 VMs
- **macOS**: Test on different macOS versions
- **Linux**: Test on different distributions

## 🛠️ Troubleshooting

### Common Issues

1. **Shortcuts Not Created**
   - Check installer permissions
   - Verify executable path
   - Review script execution logs

2. **Installation Directory Issues**
   - Ensure directory is writable
   - Check path length limitations (Windows)
   - Verify directory permissions (Linux/macOS)

3. **Dependencies Missing (Linux)**
   - Run dependency installation script manually
   - Check package manager availability
   - Verify package names for your distribution

### Debugging

Enable verbose logging:
```bash
# Linux/macOS scripts
set -x  # Add to script for verbose output

# Windows
# Check Windows Event Viewer for installer logs
```

## 📚 Documentation

- **Detailed Documentation**: `installer-scripts/README.md`
- **Configuration Reference**: `installer-scripts/installer-config.json`
- **Platform-Specific Scripts**: See individual script files

## 🎉 Success!

Your aiFetchly application now has a professional custom installer that:

✅ **Allows users to choose installation location**  
✅ **Creates desktop shortcuts automatically**  
✅ **Integrates with system menus**  
✅ **Works across Windows, macOS, and Linux**  
✅ **Follows platform conventions**  
✅ **Includes proper dependency management**  
✅ **Provides professional installation experience**  
✅ **Includes comprehensive uninstall functionality**  

## 🚀 Next Steps

1. **Test the installers** on clean virtual machines
2. **Customize the branding** (icons, banners, etc.)
3. **Add code signing** for production releases
4. **Set up automated builds** in your CI/CD pipeline
5. **Create distribution packages** for your users

---

**Note**: The installer configuration is production-ready but you may want to:
- Add code signing certificates for Windows
- Create custom installer UI images
- Configure auto-update servers
- Set up distribution channels 