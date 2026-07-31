/**
 * Test Runner Script for aiFetchly
 * 
 * This script runs the comprehensive unit and integration test suite
 */

import UnitAndIntegrationTestSuite from './unitAndIntegrationTestSuite';
import YellComAdapterTest from './yellComAdapterTest';
import * as Test192 from './192ComAdapterTest';
import { YellowPagesAdapterTest } from './yellowPagesAdapterTest';
import { YelpAdapterTest } from './yelpAdapterTest';

async function runTestSuite() {
    console.log('🚀 Starting aiFetchly Test Suite...');
    console.log('=' .repeat(80));

    const startTime = Date.now();
    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    // Run main test suite
    console.log('\n📋 Running Unit and Integration Test Suite...');
    const mainTestSuite = new UnitAndIntegrationTestSuite();
    const mainResults = await mainTestSuite.runAllTests();
    
    totalTests += mainResults.totalTests;
    totalPassed += mainResults.passedTests;
    totalFailed += mainResults.failedTests;

    // Run individual platform tests
    console.log('\n📋 Running Individual Platform Tests...');
    
    const platformTests = [
        { name: 'Yell.com Adapter', test: new YellComAdapterTest() },
        { name: '192.com Adapter', test: new (Test192 as any)['192ComAdapterTest']() },
        { name: 'YellowPages Adapter', test: new YellowPagesAdapterTest() },
        { name: 'Yelp Adapter', test: new YelpAdapterTest() }
    ];

    for (const platformTest of platformTests) {
        try {
            console.log(`\n🧪 Running ${platformTest.name} tests...`);
            await platformTest.test.runAllTests();
            totalPassed += 1; // Count each platform test as one test
        } catch (error) {
            console.error(`❌ ${platformTest.name} tests failed:`, error);
            totalFailed += 1;
        }
        totalTests += 1;
    }

    const totalDuration = Date.now() - startTime;
    const successRate = totalTests > 0 ? (totalPassed / totalTests) * 100 : 0;

    console.log('\n' + '=' .repeat(80));
    console.log('🎯 FINAL TEST RESULTS');
    console.log('=' .repeat(80));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${totalPassed}`);
    console.log(`Failed: ${totalFailed}`);
    console.log(`Total Duration: ${totalDuration}ms`);
    console.log(`Overall Success Rate: ${successRate.toFixed(2)}%`);

    if (successRate >= 80) {
        console.log('\n🎉 Test suite passed with high success rate!');
        process.exit(0);
    } else if (successRate >= 60) {
        console.log('\n⚠️ Test suite passed with moderate success rate. Some issues need attention.');
        process.exit(0);
    } else {
        console.log('\n❌ Test suite failed with low success rate. Critical issues need to be addressed.');
        process.exit(1);
    }
}

// Run the test suite if this file is executed directly
if (require.main === module) {
    runTestSuite().catch(error => {
        console.error('❌ Test suite execution failed:', error);
        process.exit(1);
    });
}

export { runTestSuite };
