const fs = require('fs');
const path = require('path');

/**
 * Test script to verify uninstaller setup
 * This script checks if all required files are in place for the uninstaller to work
 */

console.log('🔍 Testing uninstaller setup...\n');

// Check for required files
const requiredFiles = [
  'uninstall.exe',
  'uninstall-windows.js',
  'standalone-uninstaller.js',
  'copy-uninstaller.js',
  'post-install-hook.js'
];

let allFilesPresent = true;

console.log('Checking required files:');
requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  const exists = fs.existsSync(filePath);
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allFilesPresent = false;
});

console.log('\nChecking uninstaller executable:');
if (fs.existsSync(path.join(__dirname, 'uninstall.exe'))) {
  const stats = fs.statSync(path.join(__dirname, 'uninstall.exe'));
  console.log(`  ✅ uninstall.exe found (${stats.size} bytes)`);
  console.log(`  📅 Last modified: ${stats.mtime}`);
} else {
  console.log('  ❌ uninstall.exe not found');
  allFilesPresent = false;
}

console.log('\nChecking project root for uninstaller:');
const rootUninstaller = path.join(__dirname, '..', 'uninstall.exe');
if (fs.existsSync(rootUninstaller)) {
  const stats = fs.statSync(rootUninstaller);
  console.log(`  ✅ uninstall.exe found in project root (${stats.size} bytes)`);
} else {
  console.log('  ❌ uninstall.exe not found in project root');
}

console.log('\nTesting copy-uninstaller script:');
try {
  const { copyUninstaller } = require('./copy-uninstaller.js');
  const testDir = path.join(__dirname, 'test-install-dir');
  
  // Create test directory
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Test copying
  const success = copyUninstaller(testDir);
  console.log(`  ${success ? '✅' : '❌'} Copy test ${success ? 'passed' : 'failed'}`);
  
  // Clean up test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
} catch (error) {
  console.log(`  ❌ Copy test failed: ${error.message}`);
  allFilesPresent = false;
}

console.log('\n' + '='.repeat(50));
if (allFilesPresent) {
  console.log('✅ All uninstaller files are present and working!');
  console.log('The uninstaller should be included in the installer.');
} else {
  console.log('❌ Some uninstaller files are missing or not working.');
  console.log('Please check the build process and ensure all files are created.');
}
console.log('='.repeat(50));
