// Simple test script to verify Streamable HTTP server works
const { StandaloneStreamableAiFetchlyMCPServer } = require('./dist/mcp-server/streamable-standalone.js');

async function testServer() {
    try {
        console.log('Starting Streamable HTTP MCP Server test...');
        
        const server = new StandaloneStreamableAiFetchlyMCPServer({
            port: 3000,
            enableLogging: true,
            logLevel: 'debug'
        });
        
        await server.start();
        console.log('✅ Server started successfully!');
        
        // Test health endpoint
        const response = await fetch('http://localhost:3000/health');
        const health = await response.json();
        console.log('✅ Health check:', health);
        
        // Test info endpoint
        const infoResponse = await fetch('http://localhost:3000/info');
        const info = await infoResponse.json();
        console.log('✅ Server info:', info);
        
        console.log('🎉 All tests passed! Streamable HTTP server is working correctly.');
        
        // Keep server running for manual testing
        console.log('Server is running. Press Ctrl+C to stop.');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testServer();
