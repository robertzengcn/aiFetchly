# Uninstall Guide for aiFetchly

This guide explains how to completely uninstall the aiFetchly application from your system.

## 🖥️ Platform-Specific Uninstall Methods

### Windows

#### Method 1: Using Control Panel (Recommended)
1. Open **Control Panel** → **Programs and Features**
2. Find **aiFetchly** in the list
3. Click **Uninstall** and follow the wizard
4. The uninstaller will automatically:
   - Remove application files
   - Remove desktop and start menu shortcuts
   - Remove registry entries
   - Remove user data

#### Method 2: Using Command Line
```cmd
# Run the uninstall script directly
node installer-scripts/uninstall-windows.js

# Or with custom parameters
node installer-scripts/uninstall-windows.js aiFetchly "C:\Program Files\aiFetchly"
```

#### Method 3: Manual Uninstall
If the automatic uninstall fails, you can manually remove:

1. **Application Files**:
   - `%LOCALAPPDATA%\aiFetchly\`
   - `C:\Program Files\aiFetchly\`

2. **Shortcuts**:
   - Desktop: `%USERPROFILE%\Desktop\aiFetchly.lnk`
   - Start Menu: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\aiFetchly\`

3. **Registry Entries**:
   - `HKEY_CURRENT_USER\Software\aiFetchly`
   - `HKEY_LOCAL_MACHINE\SOFTWARE\aiFetchly` (if installed for all users)

4. **User Data**:
   - `%APPDATA%\aiFetchly\`
   - `%LOCALAPPDATA%\aiFetchly\Cache\`

### macOS

#### Method 1: Using Applications Folder
1. Open **Applications** folder
2. Find **aiFetchly.app**
3. Drag it to the **Trash** or right-click → **Move to Trash**
4. Empty the Trash

#### Method 2: Using Terminal
```bash
# Run the uninstall script
./installer-scripts/uninstall-macos.sh

# Or with sudo for system-wide removal
sudo ./installer-scripts/uninstall-macos.sh
```

#### Method 3: Manual Uninstall
If automatic uninstall fails, manually remove:

1. **Application**:
   - `/Applications/aiFetchly.app`
   - `~/Applications/aiFetchly.app`

2. **User Data**:
   - `~/Library/Application Support/aiFetchly/`
   - `~/Library/Preferences/com.aifetchly.plist`
   - `~/Library/Caches/aiFetchly/`
   - `~/Library/Logs/aiFetchly/`

3. **Shortcuts**:
   - Desktop: `~/Desktop/aiFetchly`
   - Dock: (remove manually from dock)

4. **Launch Agents**:
   - `~/Library/LaunchAgents/com.aifetchly.plist`

### Linux

#### Method 1: Using Package Manager
```bash
# For DEB-based systems (Ubuntu, Debian)
sudo apt remove aifetchly

# For RPM-based systems (Fedora, CentOS)
sudo yum remove aifetchly
```

#### Method 2: Using Uninstall Script
```bash
# Run the uninstall script
./installer-scripts/uninstall-linux.sh

# Or with sudo for system-wide removal
sudo ./installer-scripts/uninstall-linux.sh
```

#### Method 3: Manual Uninstall
If automatic uninstall fails, manually remove:

1. **Application Files**:
   - `/opt/aifetchly/`
   - `/usr/local/bin/aifetchly`
   - `/usr/bin/aifetchly`

2. **Desktop Files**:
   - `~/.local/share/applications/aifetchly.desktop`
   - `/usr/share/applications/aifetchly.desktop`

3. **User Data**:
   - `~/.local/share/SocialMarketing/`
   - `~/.config/SocialMarketing/`
   - `~/.cache/SocialMarketing/`

4. **Menu Entries**:
   - `~/.config/menus/applications-merged/aifetchly.menu`

## 🔧 Advanced Uninstall Options

### Windows Advanced Options

#### Remove All User Data
```cmd
# Remove user data only
node installer-scripts/uninstall-windows.js aiFetchly --user-data-only
```

#### Remove System-Wide Installation
```cmd
# Run as Administrator to remove system-wide installation
node installer-scripts/uninstall-windows.js aiFetchly --system-wide
```

### macOS Advanced Options

#### Remove System-Wide Installation
```bash
# Remove system-wide installation (requires sudo)
sudo ./installer-scripts/uninstall-macos.sh --system-wide
```

#### Remove User Data Only
```bash
# Remove user data only
./installer-scripts/uninstall-macos.sh --user-data-only
```

### Linux Advanced Options

#### Remove System-Wide Installation
```bash
# Remove system-wide installation (requires sudo)
sudo ./installer-scripts/uninstall-linux.sh --system-wide
```

#### Remove Package Manager Entries
```bash
# Check for package manager entries
./installer-scripts/uninstall-linux.sh --check-packages

# Remove package manager entries
sudo ./installer-scripts/uninstall-linux.sh --remove-packages
```

## 🚨 Troubleshooting

### Common Issues

#### 1. "Permission Denied" Errors
- **Windows**: Run as Administrator
- **macOS/Linux**: Use `sudo` for system-wide removal

#### 2. Files Still Remain
- Check for running instances of the application
- Close all related processes before uninstalling
- Use the manual uninstall method

#### 3. Shortcuts Not Removed
- Manually delete shortcuts from desktop and start menu
- Clear application cache and restart

#### 4. Registry Entries Remain (Windows)
- Use Registry Editor to manually remove entries
- Search for "aiFetchly" in registry

### Verification Steps

After uninstalling, verify complete removal:

#### Windows
```cmd
# Check for remaining files
dir "%LOCALAPPDATA%\aiFetchly" 2>nul
dir "C:\Program Files\aiFetchly" 2>nul

# Check registry
reg query "HKEY_CURRENT_USER\Software\aiFetchly" 2>nul
```

#### macOS
```bash
# Check for remaining files
ls -la /Applications/aiFetchly.app 2>/dev/null
ls -la ~/Library/Application\ Support/aiFetchly/ 2>/dev/null
```

#### Linux
```bash
# Check for remaining files
ls -la /opt/aifetchly/ 2>/dev/null
ls -la ~/.local/share/SocialMarketing/ 2>/dev/null
```