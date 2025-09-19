const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Import the uninstall functions
const { uninstallApp } = require('./uninstall-windows.js');

class StandaloneUninstaller {
  constructor() {
    this.appName = 'aiFetchly';
    this.installDir = null;
  }

  async run() {
    try {
      console.log('aiFetchly Uninstaller v1.0.0');
      console.log('================================');
      
      // Get installation directory
      this.installDir = this.getInstallDirFromRegistry();
      
      if (!this.installDir) {
        console.error('Could not find aiFetchly installation directory.');
        console.log('Please run this uninstaller from the installation directory.');
        process.exit(1);
      }

      console.log(`Found installation at: ${this.installDir}`);
      
      // Confirm uninstall
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise((resolve) => {
        rl.question('Are you sure you want to uninstall aiFetchly? (y/N): ', resolve);
      });
      
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('Uninstall cancelled.');
        process.exit(0);
      }

      // Run uninstall
      const success = uninstallApp(this.appName, this.installDir);
      
      if (success) {
        console.log('\n✅ aiFetchly has been successfully uninstalled.');
        console.log('You can now close this window.');
      } else {
        console.log('\n❌ Uninstall failed. Please try running as Administrator.');
        process.exit(1);
      }

    } catch (error) {
      console.error('Error during uninstall:', error);
      process.exit(1);
    }
  }

  getInstallDirFromRegistry() {
    try {
      const regQuery = `reg query "HKEY_CURRENT_USER\\Software\\${this.appName}" /v InstallLocation`;
      const result = execSync(regQuery, { encoding: 'utf8', stdio: 'pipe' });
      const match = result.match(/InstallLocation\s+REG_SZ\s+(.+)/);
      if (match) {
        return match[1].trim();
      }
    } catch (error) {
      // Try common installation paths
      const commonPaths = [
        path.join(process.env.LOCALAPPDATA, this.appName),
        path.join(process.env.PROGRAMFILES, this.appName),
        path.join(process.env['PROGRAMFILES(X86)'], this.appName),
        path.join(process.cwd(), '..') // If running from app directory
      ];
      
      for (const location of commonPaths) {
        if (fs.existsSync(location)) {
          return location;
        }
      }
    }
    
    return null;
  }
}

// Run the uninstaller
if (require.main === module) {
  const uninstaller = new StandaloneUninstaller();
  uninstaller.run();
}
