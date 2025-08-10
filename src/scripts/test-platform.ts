#!/usr/bin/env node

const { PlatformTestingFramework } = require('../modules/PlatformTestingFramework')
const { PlatformRegistry } = require('../modules/PlatformRegistry')
const fs = require('fs')
const path = require('path')

/**
 * CLI script for testing platform configurations
 * 
 * Usage:
 * npm run test-platform <platform-id> <target-url> [options]
 * or
 * npx ts-node src/scripts/test-platform.ts <platform-id> <target-url> [options]
 */

interface TestOptions {
  headless?: boolean
  timeout?: number
  screenshot?: boolean
  verbose?: boolean
  output?: string
  saveReport?: boolean
}

async function main() {
  try {
    const args = process.argv.slice(2)
    
    if (args.length < 2) {
      console.log('🧪 Platform Testing Framework CLI')
      console.log('==================================')
      console.log('')
      console.log('Usage:')
      console.log('  npm run test-platform <platform-id> <target-url> [options]')
      console.log('')
      console.log('Arguments:')
      console.log('  platform-id    Platform configuration ID to test')
      console.log('  target-url     URL to test the platform against')
      console.log('')
      console.log('Options:')
      console.log('  --headless     Run browser in headless mode (default: true)')
      console.log('  --timeout      Page load timeout in milliseconds (default: 30000)')
      console.log('  --screenshot   Take screenshot of the page')
      console.log('  --verbose      Show detailed test results')
      console.log('  --output       Output directory for reports (default: test-reports)')
      console.log('  --save-report  Save test report to file')
      console.log('')
      console.log('Examples:')
      console.log('  npm run test-platform yellowpages-com "https://www.yellowpages.com/search?search_terms=restaurants&geo_location_terms=New+York"')
      console.log('  npm run test-platform yelp-com "https://www.yelp.com/search?find_desc=restaurants&find_loc=New+York" --verbose --save-report')
      console.log('')
      console.log('Available Platforms:')
      const registry = new PlatformRegistry()
      const platforms = registry.getAllPlatforms()
      if (platforms.length === 0) {
        console.log('  No platforms found. Use "npm run generate-platform" to create one.')
      } else {
        platforms.forEach(platform => {
          console.log(`  - ${platform.id}: ${platform.name}`)
        })
      }
      process.exit(1)
    }

    const [platformId, targetUrl] = args
    const options = parseOptions(args.slice(2))

    // Validate platform exists
    const registry = new PlatformRegistry()
    const platform = registry.getPlatformConfig(platformId)
    if (!platform) {
      console.error(`❌ Platform not found: ${platformId}`)
      console.log('Available platforms:')
      registry.getAllPlatforms().forEach(p => console.log(`  - ${p.id}: ${p.name}`))
      process.exit(1)
    }

    // Validate URL
    try {
      new URL(targetUrl)
    } catch {
      console.error(`❌ Invalid URL: ${targetUrl}`)
      process.exit(1)
    }

    console.log('🚀 Starting platform tests...')
    console.log('')

    // Run tests
    const framework = new PlatformTestingFramework()
    const report = await framework.runTests(platformId, targetUrl, options)

    // Save report if requested
    if (options.saveReport) {
      // await framework.saveReport(report, options.output)
      console.log('📄 Report saving feature temporarily disabled')
    }

    // Exit with appropriate code
    if (report.passedTests === report.totalTests) {
      console.log('✅ All tests passed!')
      process.exit(0)
    } else {
      console.log('❌ Some tests failed.')
      process.exit(1)
    }

  } catch (error) {
    console.error('❌ Test execution failed:', error)
    process.exit(1)
  }
}

/**
 * Parse command line options
 */
function parseOptions(args: string[]): TestOptions {
  const options: TestOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    switch (arg) {
      case '--headless':
        options.headless = true
        break
      case '--no-headless':
        options.headless = false
        break
      case '--timeout':
        if (i + 1 < args.length) {
          options.timeout = parseInt(args[i + 1])
          i++ // Skip next argument
        }
        break
      case '--screenshot':
        options.screenshot = true
        break
      case '--verbose':
        options.verbose = true
        break
      case '--output':
        if (i + 1 < args.length) {
          options.output = args[i + 1]
          i++ // Skip next argument
        }
        break
      case '--save-report':
        options.saveReport = true
        break
      default:
        if (arg.startsWith('--')) {
          console.warn(`⚠️  Unknown option: ${arg}`)
        }
    }
  }

  return options
}

// Run the script
if (require.main === module) {
  main()
}

