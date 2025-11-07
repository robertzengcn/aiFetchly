const fs = require('fs');
const path = require('path');

function copyUninstaller(installDir) {
  try {
    const sourcePath = path.join(__dirname, 'uninstall.exe');
    const destPath = path.join(installDir, 'uninstall.exe');
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
      console.log('Uninstaller copied to installation directory');
    } else {
      console.log('Uninstaller not found, skipping copy');
    }
  } catch (error) {
    console.error('Error copying uninstaller:', error);
  }
}

// Export for use in WiX custom actions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { copyUninstaller };
}

// If running directly
if (require.main === module) {
  const installDir = process.argv[2] || process.cwd();
  copyUninstaller(installDir);
}
