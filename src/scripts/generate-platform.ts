#!/usr/bin/env node

import { PlatformTemplateGenerator } from '@/modules/PlatformTemplateGenerator'

/**
 * CLI script for generating platform templates
 * 
 * Usage:
 * npm run generate-platform
 * or
 * npx ts-node src/scripts/generate-platform.ts
 */

async function main() {
  try {
    const generator = new PlatformTemplateGenerator()
    
    // Check for command line arguments
    const args = process.argv.slice(2)
    
    if (args.length > 0) {
      const command = args[0]
      
      switch (command) {
        case 'list':
          console.log('📋 Existing Platforms:')
          const platforms = generator.listExistingPlatforms()
          if (platforms.length === 0) {
            console.log('No platforms found.')
          } else {
            platforms.forEach(platform => console.log(`  - ${platform}`))
          }
          break
          
        case 'simple':
          if (args.length < 4) {
            console.log('Usage: npm run generate-platform simple <platform-id> <platform-name> <base-url>')
            process.exit(1)
          }
          
          const [platformId, platformName, baseUrl] = args.slice(1)
          const config = PlatformTemplateGenerator.generateSimpleTemplate(platformId, platformName, baseUrl)
          
          console.log('📄 Generated Simple Platform Configuration:')
          console.log(JSON.stringify(config, null, 2))
          break
          
        default:
          console.log('Unknown command. Available commands:')
          console.log('  list   - List existing platforms')
          console.log('  simple - Generate simple template with command line args')
          console.log('  (no args) - Interactive platform generation')
          process.exit(1)
      }
    } else {
      // Interactive mode
      await generator.generatePlatformTemplate()
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

// Run the script
if (require.main === module) {
  main()
}

