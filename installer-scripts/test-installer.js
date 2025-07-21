const fs = require('fs');
const path = require('path');

/**
 * Test script to validate installer configuration
 * This script checks if all required files and paths exist
 */

function testInstallerConfig() {
  console.log('🔍 Testing installer configuration...\n');
  
  const errors = [];
  const warnings = [];
  const success = [];
  
  // Test 1: Check if forge.config.js exists
  const forgeConfigPath = path.join(__dirname, '..', 'forge.config.js');
  if (fs.existsSync(forgeConfigPath)) {
    success.push('✅ forge.config.js exists');
  } else {
    errors.push('❌ forge.config.js not found');
  }
  
  // Test 2: Check icon files
  const iconDir = path.join(__dirname, '..', 'src', 'assets', 'images');
  const requiredIcons = ['icon.ico', 'icon.icns', 'icon.png'];
  
  requiredIcons.forEach(icon => {
    const iconPath = path.join(iconDir, icon);
    if (fs.existsSync(iconPath)) {
      success.push(`✅ ${icon} exists`);
    } else {
      warnings.push(`⚠️  ${icon} not found (optional for some platforms)`);
    }
  });
  
  // Test 3: Check installer scripts
  const scriptsDir = __dirname;
  const requiredScripts = [
    'create-shortcuts.js',
    'create-macos-shortcuts.sh',
    'create-linux-shortcuts.sh'
  ];
  
  requiredScripts.forEach(script => {
    const scriptPath = path.join(scriptsDir, script);
    if (fs.existsSync(scriptPath)) {
      success.push(`✅ ${script} exists`);
      
      // Check if shell scripts are executable
      if (script.endsWith('.sh')) {
        try {
          fs.accessSync(scriptPath, fs.constants.X_OK);
          success.push(`✅ ${script} is executable`);
        } catch (err) {
          warnings.push(`⚠️  ${script} is not executable (run: chmod +x ${script})`);
        }
      }
    } else {
      errors.push(`❌ ${script} not found`);
    }
  });
  
  // Test 4: Check package.json scripts
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const requiredScripts = [
      'make',
      'make-win:test',
      'make-mac:test',
      'make-linux:test',
      'make-win:prod',
      'make-mac:prod',
      'make-linux:prod',
      'make-installer'
    ];
    
    requiredScripts.forEach(script => {
      if (packageJson.scripts && packageJson.scripts[script]) {
        success.push(`✅ npm script '${script}' exists`);
      } else {
        warnings.push(`⚠️  npm script '${script}' not found`);
      }
    });
  }
  
  // Test 5: Check optional installer assets
  const optionalAssets = [
    'installer-banner.png',
    'installer-dialog.png',
    'installer-loading.gif'
  ];
  
  optionalAssets.forEach(asset => {
    const assetPath = path.join(iconDir, asset);
    if (fs.existsSync(assetPath)) {
      success.push(`✅ ${asset} exists`);
    } else {
      warnings.push(`ℹ️  ${asset} not found (optional for custom installer UI)`);
    }
  });
  
  // Test 6: Check certificate file (Windows)
  const certPath = path.join(__dirname, '..', 'cert.pfx');
  if (fs.existsSync(certPath)) {
    success.push('✅ Windows certificate (cert.pfx) exists');
  } else {
    warnings.push('⚠️  Windows certificate (cert.pfx) not found (required for code signing)');
  }
  
  // Test 7: Check LICENSE file
  const licensePath = path.join(__dirname, '..', 'LICENSE');
  if (fs.existsSync(licensePath)) {
    success.push('✅ LICENSE file exists');
  } else {
    warnings.push('⚠️  LICENSE file not found (optional for WiX installer)');
  }
  
  // Print results
  console.log('📋 Test Results:\n');
  
  if (success.length > 0) {
    console.log('✅ Success:');
    success.forEach(msg => console.log(`  ${msg}`));
    console.log('');
  }
  
  if (warnings.length > 0) {
    console.log('⚠️  Warnings:');
    warnings.forEach(msg => console.log(`  ${msg}`));
    console.log('');
  }
  
  if (errors.length > 0) {
    console.log('❌ Errors:');
    errors.forEach(msg => console.log(`  ${msg}`));
    console.log('');
  }
  
  // Summary
  console.log('📊 Summary:');
  console.log(`  ✅ Success: ${success.length}`);
  console.log(`  ⚠️  Warnings: ${warnings.length}`);
  console.log(`  ❌ Errors: ${errors.length}`);
  
  if (errors.length === 0) {
    console.log('\n🎉 Installer configuration is ready!');
    console.log('\n📝 Next steps:');
    console.log('  1. Run "yarn make-win:test" to build Windows installer');
    console.log('  2. Run "yarn make-mac:test" to build macOS installer');
    console.log('  3. Run "yarn make-linux:test" to build Linux installer');
    console.log('  4. Run "yarn make-installer" to build all production installers');
  } else {
    console.log('\n🔧 Please fix the errors above before building installers.');
  }
  
  return errors.length === 0;
}

// Run the test
if (require.main === module) {
  testInstallerConfig();
}

module.exports = { testInstallerConfig }; 