const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Custom action script for creating shortcuts during installation
 * This script is called by the WiX installer after the application is installed
 */

function createShortcuts(installDir, appName = 'aiFetchly') {
  try {
    console.log('Creating shortcuts for:', appName);
    console.log('Install directory:', installDir);

    // Get the executable path
    const exePath = path.join(installDir, `${appName}.exe`);
    
    if (!fs.existsSync(exePath)) {
      console.error('Executable not found:', exePath);
      return false;
    }

    // Create desktop shortcut
    createDesktopShortcut(exePath, appName);
    
    // Create start menu shortcut
    createStartMenuShortcut(exePath, appName);
    
    console.log('Shortcuts created successfully');
    return true;
  } catch (error) {
    console.error('Error creating shortcuts:', error);
    return false;
  }
}

function createDesktopShortcut(exePath, appName) {
  try {
    const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
    const shortcutPath = path.join(desktopPath, `${appName}.lnk`);
    
    // Create VBS script to create shortcut
    const vbsScript = `
      Set WshShell = WScript.CreateObject("WScript.Shell")
      Set oShellLink = WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
      oShellLink.TargetPath = "${exePath.replace(/\\/g, '\\\\')}"
      oShellLink.WorkingDirectory = "${path.dirname(exePath).replace(/\\/g, '\\\\')}"
      oShellLink.Description = "${appName}"
      oShellLink.IconLocation = "${exePath.replace(/\\/g, '\\\\')},0"
      oShellLink.Save
    `;
    
    const vbsPath = path.join(process.env.TEMP, 'create_shortcut.vbs');
    fs.writeFileSync(vbsPath, vbsScript);
    
    // Execute VBS script
    execSync(`cscript //nologo "${vbsPath}"`, { stdio: 'inherit' });
    
    // Clean up VBS script
    fs.unlinkSync(vbsPath);
    
    console.log('Desktop shortcut created:', shortcutPath);
  } catch (error) {
    console.error('Error creating desktop shortcut:', error);
  }
}

function createStartMenuShortcut(exePath, appName) {
  try {
    const startMenuPath = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const appFolderPath = path.join(startMenuPath, appName);
    
    // Create app folder in start menu if it doesn't exist
    if (!fs.existsSync(appFolderPath)) {
      fs.mkdirSync(appFolderPath, { recursive: true });
    }
    
    const shortcutPath = path.join(appFolderPath, `${appName}.lnk`);
    
    // Create VBS script to create shortcut
    const vbsScript = `
      Set WshShell = WScript.CreateObject("WScript.Shell")
      Set oShellLink = WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
      oShellLink.TargetPath = "${exePath.replace(/\\/g, '\\\\')}"
      oShellLink.WorkingDirectory = "${path.dirname(exePath).replace(/\\/g, '\\\\')}"
      oShellLink.Description = "${appName}"
      oShellLink.IconLocation = "${exePath.replace(/\\/g, '\\\\')},0"
      oShellLink.Save
    `;
    
    const vbsPath = path.join(process.env.TEMP, 'create_startmenu_shortcut.vbs');
    fs.writeFileSync(vbsPath, vbsScript);
    
    // Execute VBS script
    execSync(`cscript //nologo "${vbsPath}"`, { stdio: 'inherit' });
    
    // Clean up VBS script
    fs.unlinkSync(vbsPath);
    
    console.log('Start menu shortcut created:', shortcutPath);
  } catch (error) {
    console.error('Error creating start menu shortcut:', error);
  }
}

// Export for use in WiX custom actions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createShortcuts };
}

// If running directly (for testing)
if (require.main === module) {
  const installDir = process.argv[2] || 'C:\\Program Files\\aiFetchly';
  const appName = process.argv[3] || 'aiFetchly';
  
  console.log('Running shortcut creation script...');
  createShortcuts(installDir, appName);
} 