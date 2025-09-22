const fs = require('fs');
const path = require('path');

/**
 * Post-installation hook for Electron Forge
 * This runs after the application is installed to copy the uninstaller
 */

function postInstallHook() {
  try {
    console.log('Running post-installation hook...');
    
    // Get the installation directory from environment or registry
    const installDir = getInstallationDirectory();
    
    if (!installDir) {
      console.error('Could not determine installation directory');
      return false;
    }
    
    console.log('Installation directory:', installDir);
    
    // Copy uninstaller
    const { copyUninstaller } = require('./copy-uninstaller.js');
    const success = copyUninstaller(installDir);
    
    if (success) {
      console.log('✅ Post-installation hook completed successfully');
      return true;
    } else {
      console.error('❌ Post-installation hook failed');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error in post-installation hook:', error);
    return false;
  }
}

function getInstallationDirectory() {
  // Try to get from environment variables first
  const envInstallDir = process.env.INSTALLDIR || process.env.INSTALLFOLDER;
  if (envInstallDir && fs.existsSync(envInstallDir)) {
    return envInstallDir;
  }
  
  // Try common installation paths
  const commonPaths = [
    path.join(process.env.LOCALAPPDATA, 'aiFetchly'),
    path.join(process.env.PROGRAMFILES, 'aiFetchly'),
    path.join(process.env['PROGRAMFILES(X86)'], 'aiFetchly'),
    path.join(process.cwd(), '..'),
    process.cwd()
  ];
  
  for (const location of commonPaths) {
    if (fs.existsSync(location)) {
      return location;
    }
  }
  
  return null;
}

// Export for use in forge config
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { postInstallHook };
}

// If running directly
if (require.main === module) {
  const success = postInstallHook();
  process.exit(success ? 0 : 1);
}
