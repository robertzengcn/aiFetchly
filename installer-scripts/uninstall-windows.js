const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Windows uninstall script for aiFetchly application
 * This script removes the application and all associated files/registry entries
 */

function uninstallApp(appName = 'aiFetchly', installDir = null) {
  try {
    console.log('Starting uninstall process for:', appName);
    
    // Get installation directory from registry if not provided
    if (!installDir) {
      installDir = getInstallDirFromRegistry(appName);
    }
    
    if (!installDir) {
      console.error('Could not determine installation directory');
      return false;
    }
    
    console.log('Installation directory:', installDir);
    
    // Remove shortcuts
    removeShortcuts(appName);
    
    // Remove registry entries
    removeRegistryEntries(appName);
    
    // Remove application files
    removeApplicationFiles(installDir);
    
    // Remove user data (optional)
    removeUserData(appName);
    
    console.log('Uninstall completed successfully');
    return true;
  } catch (error) {
    console.error('Error during uninstall:', error);
    return false;
  }
}

function getInstallDirFromRegistry(appName) {
  try {
    // Try to get installation directory from registry
    const regQuery = `reg query "HKEY_CURRENT_USER\\Software\\${appName}" /v InstallLocation`;
    const result = execSync(regQuery, { encoding: 'utf8', stdio: 'pipe' });
    const match = result.match(/InstallLocation\s+REG_SZ\s+(.+)/);
    if (match) {
      return match[1].trim();
    }
  } catch (error) {
    console.log('Could not read from registry, using default location');
  }
  
  // Default locations
  const defaultLocations = [
    path.join(process.env.LOCALAPPDATA, appName),
    path.join(process.env.PROGRAMFILES, appName),
    path.join(process.env['PROGRAMFILES(X86)'], appName)
  ];
  
  for (const location of defaultLocations) {
    if (fs.existsSync(location)) {
      return location;
    }
  }
  
  return null;
}

function removeShortcuts(appName) {
  try {
    console.log('Removing shortcuts...');
    
    // Remove desktop shortcut
    const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
    const desktopShortcut = path.join(desktopPath, `${appName}.lnk`);
    if (fs.existsSync(desktopShortcut)) {
      fs.unlinkSync(desktopShortcut);
      console.log('Removed desktop shortcut');
    }
    
    // Remove start menu shortcuts
    const startMenuPath = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const appFolderPath = path.join(startMenuPath, appName);
    if (fs.existsSync(appFolderPath)) {
      // Remove all files in the folder
      const files = fs.readdirSync(appFolderPath);
      files.forEach(file => {
        const filePath = path.join(appFolderPath, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
      
      // Remove the folder
      fs.rmdirSync(appFolderPath);
      console.log('Removed start menu shortcuts');
    }
    
    // Remove from all users start menu if exists
    const allUsersStartMenu = path.join(process.env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const allUsersAppFolder = path.join(allUsersStartMenu, appName);
    if (fs.existsSync(allUsersAppFolder)) {
      const files = fs.readdirSync(allUsersAppFolder);
      files.forEach(file => {
        const filePath = path.join(allUsersAppFolder, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
      fs.rmdirSync(allUsersAppFolder);
      console.log('Removed all users start menu shortcuts');
    }
    
  } catch (error) {
    console.error('Error removing shortcuts:', error);
  }
}

function removeRegistryEntries(appName) {
  try {
    console.log('Removing registry entries...');
    
    // Remove user registry entries
    const userRegKey = `HKEY_CURRENT_USER\\Software\\${appName}`;
    execSync(`reg delete "${userRegKey}" /f`, { stdio: 'pipe' });
    console.log('Removed user registry entries');
    
    // Remove machine registry entries (if running as admin)
    try {
      const machineRegKey = `HKEY_LOCAL_MACHINE\\SOFTWARE\\${appName}`;
      execSync(`reg delete "${machineRegKey}" /f`, { stdio: 'pipe' });
      console.log('Removed machine registry entries');
    } catch (error) {
      console.log('Could not remove machine registry entries (requires admin)');
    }
    
    // Remove uninstall registry entries
    const uninstallKey = `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appName}`;
    try {
      execSync(`reg delete "${uninstallKey}" /f`, { stdio: 'pipe' });
      console.log('Removed uninstall registry entries');
    } catch (error) {
      console.log('Could not remove uninstall registry entries');
    }
    
  } catch (error) {
    console.error('Error removing registry entries:', error);
  }
}

function removeApplicationFiles(installDir) {
  try {
    console.log('Removing application files...');
    
    if (fs.existsSync(installDir)) {
      // Remove the entire installation directory
      fs.rmSync(installDir, { recursive: true, force: true });
      console.log('Removed application files from:', installDir);
    } else {
      console.log('Installation directory not found:', installDir);
    }
    
  } catch (error) {
    console.error('Error removing application files:', error);
  }
}

function removeUserData(appName) {
  try {
    console.log('Removing user data...');
    
    // Remove user data directory
    const userDataPath = path.join(process.env.APPDATA, appName);
    if (fs.existsSync(userDataPath)) {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      console.log('Removed user data from:', userDataPath);
    }
    
    // Remove logs directory
    const logsPath = path.join(process.env.APPDATA, appName, 'logs');
    if (fs.existsSync(logsPath)) {
      fs.rmSync(logsPath, { recursive: true, force: true });
      console.log('Removed logs from:', logsPath);
    }
    
    // Remove cache directory
    const cachePath = path.join(process.env.LOCALAPPDATA, appName, 'Cache');
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { recursive: true, force: true });
      console.log('Removed cache from:', cachePath);
    }
    
  } catch (error) {
    console.error('Error removing user data:', error);
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { uninstallApp };
}

// If running directly
if (require.main === module) {
  const appName = process.argv[2] || 'aiFetchly';
  const installDir = process.argv[3] || null;
  
  console.log('Running Windows uninstall script...');
  uninstallApp(appName, installDir);
} 