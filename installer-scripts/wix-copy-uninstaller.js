const fs = require('fs');
const path = require('path');

/**
 * WiX Custom Action Script for copying uninstaller
 * This script is called during WiX installation to copy uninstall.exe to the installation directory
 */

// WiX passes the installation directory as a command line argument
const installDir = process.argv[1] || process.env.INSTALLDIR || process.cwd();

function copyUninstaller() {
  try {
    console.log('WiX Custom Action: Copying uninstaller...');
    console.log('Installation directory:', installDir);
    
    // Source path (where uninstall.exe is bundled)
    const sourcePath = path.join(__dirname, 'uninstall.exe');
    
    // Destination path (installation directory)
    const destPath = path.join(installDir, 'uninstall.exe');
    
    console.log('Source path:', sourcePath);
    console.log('Destination path:', destPath);
    
    // Check if source exists
    if (!fs.existsSync(sourcePath)) {
      console.error('Uninstaller source not found:', sourcePath);
      return 1; // Return error code for WiX
    }
    
    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    // Copy the uninstaller
    fs.copyFileSync(sourcePath, destPath);
    
    console.log('✅ Uninstaller copied successfully to:', destPath);
    
    // Verify the copy
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      console.log('Uninstaller file size:', stats.size, 'bytes');
      return 0; // Success
    } else {
      console.error('❌ Failed to verify uninstaller copy');
      return 1; // Error
    }
    
  } catch (error) {
    console.error('❌ Error copying uninstaller:', error);
    return 1; // Error
  }
}

// Run the function and exit with appropriate code
const exitCode = copyUninstaller();
process.exit(exitCode);
