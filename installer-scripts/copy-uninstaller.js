const fs = require('fs');
const path = require('path');

function copyUninstaller(installDir) {
  try {
    console.log('Copying uninstaller...');
    console.log('Installation directory:', installDir);
    
    // Try multiple possible source locations
    const possibleSources = [
      path.join(__dirname, 'uninstall.exe'),
      path.join(process.cwd(), 'uninstall.exe'),
      path.join(process.cwd(), 'installer-scripts', 'uninstall.exe'),
      path.join(__dirname, '..', 'installer-scripts', 'uninstall.exe')
    ];
    
    let sourcePath = null;
    for (const source of possibleSources) {
      if (fs.existsSync(source)) {
        sourcePath = source;
        break;
      }
    }
    
    if (!sourcePath) {
      console.error('Uninstaller not found in any expected location:');
      possibleSources.forEach(src => console.log('  -', src));
      return false;
    }
    
    console.log('Found uninstaller at:', sourcePath);
    
    // Ensure destination directory exists
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }
    
    const destPath = path.join(installDir, 'uninstall.exe');
    fs.copyFileSync(sourcePath, destPath);
    
    // Verify the copy
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      console.log('✅ Uninstaller copied successfully to:', destPath);
      console.log('File size:', stats.size, 'bytes');
      return true;
    } else {
      console.error('❌ Failed to verify uninstaller copy');
      return false;
    }
  } catch (error) {
    console.error('❌ Error copying uninstaller:', error);
    return false;
  }
}

// Export for use in custom actions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { copyUninstaller };
}

// If running directly
if (require.main === module) {
  const installDir = process.argv[2] || process.cwd();
  const success = copyUninstaller(installDir);
  process.exit(success ? 0 : 1);
}
