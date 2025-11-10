const { LocalIndex } = require('vectra');
const path = require('path');
const fs = require('fs');

async function testVectraDirect() {
    console.log('Testing Vectra directly...');
    
    try {
        // Create test directory
        const testDir = path.join(__dirname, 'test-data', 'vectra-direct');
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        
        // Create Vectra LocalIndex instance
        const index = new LocalIndex(testDir);
        
        // Create index if it doesn't exist
        if (!await index.isIndexCreated()) {
            await index.createIndex();
            console.log('✅ Vectra index created successfully');
        }
        
        // Add test items
        await index.insertItem({
            vector: [1, 2, 3],
            metadata: { id: 'doc1', chunkId: 1 }
        });
        
        await index.insertItem({
            vector: [4, 5, 6],
            metadata: { id: 'doc2', chunkId: 2 }
        });
        
        await index.insertItem({
            vector: [7, 8, 9],
            metadata: { id: 'doc3', chunkId: 3 }
        });
        
        console.log('✅ Test items added successfully');
        
        // Search
        const results = await index.queryItems([1, 2, 3], 2);
        console.log('Search results:', results);
        console.log('✅ Search completed successfully');
        
        // Cleanup
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        
        console.log('🎉 Vectra direct test passed!');
        
    } catch (error) {
        console.error('❌ Vectra direct test failed:', error);
        throw error;
    }
}

// Run test
testVectraDirect().catch(console.error);
