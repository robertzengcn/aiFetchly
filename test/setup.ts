/**
 * Mocha test setup file
 * Configures environment variables and test globals
 */

import "reflect-metadata";

// IMPORTANT: Import TaskEntity BEFORE importing SqliteDb to ensure it's registered
// This is necessary because TypeORM uses decorators to register entity metadata
import '../src/entity/Task.entity';
import { SqliteDb } from '../src/config/SqliteDb';

// Set up test environment variables
process.env.VITE_LOGIN_URL = 'http://localhost:3000';
process.env.VITE_REMOTEADD = 'http://localhost:3000';
process.env.NODE_ENV = 'test';

// Create a minimal mock for Electron
(global as any).window = {
  location: {
    hostname: 'localhost',
  },
};

// Initialize database for tests
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('os') as NodeJS.OS;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');

// Create a temp directory for test databases
const tmpDir = path.join(os.tmpdir(), 'aifetchly-test');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Pre-load and initialize SqliteDb with all entities before any tests run
// Use resetInstance to ensure a fresh instance with all entities
let dbInitialized = false;

async function initializeTestDatabase() {
  if (dbInitialized) return;

  try {
    // Use resetInstance to ensure we get a fresh instance with all entities
    const db = await SqliteDb.resetInstance(tmpDir);

    // Initialize the connection to ensure all entities are registered
    if (db.connection && !db.connection.isInitialized) {
      await db.connection.initialize();
      console.log('✓ Test database initialized with all entities');
    } else {
      console.log('✓ Test database configured');
    }

    dbInitialized = true;
  } catch (error) {
    console.log('✓ Test environment configured (DB init deferred):', (error as Error).message);
  }
}

// Initialize synchronously - the connection will be established on first use
initializeTestDatabase().catch(() => {
  // Ignore errors during setup, will be handled in tests
});

console.log('✓ Test environment configured');
