# Quick Start Guide: AI-Powered Contact Extraction

**Feature**: 001-ai-contact-extraction
**Created**: 2025-02-06
**Purpose**: Developer guide for setting up, testing, and using contact extraction

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Development Setup](#development-setup)
5. [Common Workflows](#common-workflows)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)
8. [Performance Tuning](#performance-tuning)

---

## Prerequisites

### Required Software

- **Node.js**: v18.x or later
- **Yarn**: 1.22.x or later
- **TypeScript**: 5.x
- **Electron**: Latest version (installed via yarn)

### Required APIs/Services

- **OpenAI API Key**: For GPT-4o-mini contact extraction
  - Get key from: https://platform.openai.com/api-keys
  - Cost: ~$0.001-0.005 per extraction
  - Alternative: Configure other AI providers (Anthropic, etc.)

### System Requirements

- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)
- **Memory**: 8GB RAM minimum (16GB recommended for batch processing)
- **Disk**: 500MB free space for browser binaries
- **Network**: Stable internet connection for Puppeteer and AI service

---

## Installation

### 1. Clone Repository

```bash
git clone <repository-url>
cd aiFetchly
git checkout 001-ai-contact-extraction
```

### 2. Install Dependencies

```bash
yarn install
```

### 3. Set Up Environment Variables

Create `.env` file in project root:

```bash
cp .env.example .env
```

Edit `.env` and add:

```env
# AI Service Configuration (choose one)
OPENAI_API_KEY=sk-proj-your-openai-api-key-here
# OR
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here

# Application Settings
NODE_ENV=development
```

### 4. Initialize Database

```bash
yarn init
```

This creates SQLite database at `userData/database.db` and runs migrations.

### 5. Build Application

```bash
yarn build
```

---

## Configuration

### AI Service Configuration

The contact extraction feature uses OpenAI GPT-4o-mini by default.

**Cost Estimate**:
- 10 websites: ~$0.01-0.05
- 100 websites: ~$0.10-0.50
- 1000 websites: ~$1-5

**Configure AI Service** in `.env`:

```env
# OpenAI (Recommended)
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_TEMPERATURE=0.3

# Anthropic Claude (Alternative)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-haiku-20240307
```

### Browser Configuration

Configure Puppeteer browser settings in `src/childprocess/contact-extraction/BrowserPool.ts`:

```typescript
const browserPool = new BrowserPool({
  maxInstances: 3,        // Max concurrent browsers
  headless: true,         // Run headless (no UI)
  useStealth: true        // Enable stealth mode (avoid bot detection)
});
```

### Concurrency Configuration

Adjust extraction concurrency in `src/childprocess/contact-extraction/ExtractionQueue.ts`:

```typescript
export const extractionQueue = new ContactExtractionQueue(
  3  // Max concurrent extractions (default: 3)
);
```

**Recommendations**:
- **Development**: 1-2 concurrent (slower, easier debugging)
- **Production**: 3-5 concurrent (faster, more resource usage)
- **High Performance**: 5-10 concurrent (requires 16GB+ RAM)

---

## Development Setup

### 1. Start Development Server

```bash
yarn dev
```

This starts:
- Electron main process
- Vite dev server (hot reload)
- Renderer process (Vue frontend)

### 2. Enable Debug Logging

Set environment variable:

```bash
DEBUG=contact-extraction:* yarn dev
```

Or add to `.env`:

```env
DEBUG=contact-extraction:*
```

### 3. Open Developer Tools

- **Main Process**: Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS)
- **Renderer Process**: Open from menu or use DevTools extension

### 4. View Database

Use SQLite browser tool:

```bash
# Install SQLite CLI
sudo apt-get install sqlite3  # Linux
brew install sqlite3          # macOS

# Open database
sqlite3 ~/Library/Application\ Support/aiFetchly/database.db  # macOS
sqlite3 ~/.config/aiFetchly/database.db                      # Linux
sqlite3 %APPDATA%/aiFetchly/database.db                      # Windows

# Query contact info
SELECT * FROM contact_info LIMIT 10;
```

---

## Common Workflows

### Workflow 1: Extract Contact Info from Single Search Result

**UI Steps**:
1. Navigate to **Search** → **Search Results** page
2. Click on a search task to view results
3. Select 1 search result checkbox
4. Click **"Get Contact Info with AI"** button
5. Monitor progress in real-time (status chips update automatically)
6. View extracted contact info in table columns

**Expected Results**:
- Extraction status: `pending` → `analyzing` → `completed`
- Duration: 5-30 seconds (depending on website complexity)
- Success rate: ~90%

### Workflow 2: Batch Extract from Multiple Search Results

**UI Steps**:
1. Navigate to **Search** → **Search Results** page
2. Click on a search task with multiple results
3. Select 10-20 search result checkboxes
4. Click **"Get Contact Info with AI"** button
5. Monitor progress dialog (shows X of Y items processed)
6. Navigate away if needed (extraction continues in background)
7. Return to page to view results

**Expected Results**:
- Concurrent processing (3 at a time by default)
- Total duration: ~2-5 minutes for 20 items
- Automatic retries for failed items (max 3 attempts)

### Workflow 3: Retry Failed Extractions

**UI Steps**:
1. Filter table to show only `failed` status items
2. Select failed items to retry
3. Click **"Retry Contact Extraction"** button (if available)
4. Monitor new extraction attempts

**Expected Results**:
- Old contact info deleted before retry
- Higher priority queue processing
- ~50% success rate on retry

### Workflow 4: Export Extracted Contact Info

**UI Steps**:
1. Filter for `completed` status items
2. Select all successful extractions
3. Click **"Export"** button
4. Choose export format (CSV, Excel, JSON)
5. Save file to disk

**Expected Output**:
- CSV with columns: `result_id`, `title`, `url`, `email`, `phone`, `address`, `social_links`, `extraction_date`

---

## Testing

### Unit Tests

Test contact discovery logic:

```bash
yarn test test/modules/contact-extraction/ContactDiscovery.test.ts
```

**Expected Output**:
```
  Contact Discovery
    ✓ should score contact page links correctly
    ✓ should extract email from mailto links
    ✓ should handle missing contact info gracefully
    ✓ should validate email format
    ✓ should validate phone format

  5 passing (100ms)
```

### Integration Tests

Test IPC handlers:

```bash
yarn testmain test/vitest/main/contactExtraction-ipc.test.ts
```

**Expected Output**:
```
  Contact Extraction IPC
    ✓ should start extraction with valid result IDs
    ✓ should reject extraction with empty result IDs
    ✓ should return contact info for valid result IDs
    ✓ should handle retry requests

  4 passing (250ms)
```

### End-to-End Tests

Test full extraction flow:

```bash
# Start test website server
cd test/fixtures/contact-websites
python -m http.server 8080

# Run E2E tests (in another terminal)
yarn test-e2e-contact-extraction
```

**Test Websites**:
- `localhost:8080/contact-homepage.html` - Contact info in footer
- `localhost:8080/contact-page.html` - Dedicated /contact page
- `localhost:8080/no-contact.html` - No contact info (should fail)
- `localhost:8080/multiple-emails.html` - Multiple emails/phones

### Manual Testing

**Test Single Extraction**:
1. Open Electron app (`yarn dev`)
2. Navigate to search results page
3. Select 1 result
4. Click "Get Contact Info with AI"
5. Verify status updates in real-time
6. Check database for extracted data

**Test Batch Extraction**:
1. Select 10 results
2. Click "Get Contact Info with AI"
3. Monitor progress dialog
4. Verify all items complete
5. Check browser pool stats (should max at 3 concurrent)

**Test Error Handling**:
1. Select result with invalid URL
2. Verify graceful error message
3. Verify status shows "failed"
4. Verify retry works

---

## Troubleshooting

### Issue 1: Extraction Stuck on "Analyzing"

**Symptoms**: Status shows "analyzing" for > 60 seconds

**Possible Causes**:
- Browser crash (check logs for crash reports)
- AI service timeout (network issues)
- Slow page load (heavy website)

**Solutions**:
```bash
# Check worker process logs
# (in Electron DevTools Console)
contact-extraction:worker Extraction job started for result 123

# Restart worker process
# (in main process)
worker.kill();
spawnContactExtractionWorker();

# Increase timeout in src/childprocess/contact-extraction/ContactDiscovery.ts
const timeout = 60000; // 60 seconds
```

### Issue 2: High Failure Rate (> 30%)

**Symptoms**: Most extractions fail with "No contact info found"

**Possible Causes**:
- Bot detection (websites blocking automated access)
- AI service unavailable
- Network connectivity issues

**Solutions**:
```bash
# Check stealth plugin is enabled
# (should see "StealthPlugin enabled" in logs)

# Test AI service manually
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Enable verbose logging
DEBUG=puppeteer-extra:*,contact-extraction:* yarn dev
```

### Issue 3: Memory Issues / Browser Crashes

**Symptoms**: Electron app crashes, high memory usage

**Possible Causes**:
- Too many concurrent browsers
- Memory leak in page cleanup
- Large page content

**Solutions**:
```typescript
// Reduce concurrency in ExtractionQueue.ts
export const extractionQueue = new ContactExtractionQueue(
  2  // Reduce from 3 to 2
);

// Enable garbage collection
// (start with --expose-gc flag)
node --expose-gc --loader tsx src/childprocess/contact-extraction/ContactExtractionWorker.ts

// Force cleanup between jobs
if (global.gc) {
  global.gc();
}
```

### Issue 4: AI Service Rate Limiting

**Symptoms**: 429 errors, "Rate limit exceeded" messages

**Possible Causes**:
- Too many concurrent requests
- Free API tier limits

**Solutions**:
```typescript
// Add delay between AI calls
await delay(1000); // 1 second delay

// Reduce concurrency
export const extractionQueue = new ContactExtractionQueue(1);

// Switch to paid API tier
// (at https://platform.openai.com/account/billing)
```

### Issue 5: Database Locked / Migration Errors

**Symptoms**: "Database is locked" error, migration fails

**Solutions**:
```bash
# Close all connections
yarn build  # Ensure no dev servers running

# Delete and recreate database
rm ~/Library/Application\ Support/aiFetchly/database.db  # macOS
rm ~/.config/aiFetchly/database.db                      # Linux
rm %APPDATA%/aiFetchly/database.db                      # Windows

# Re-run migrations
yarn init
```

---

## Performance Tuning

### Optimization 1: Adjust Concurrency

**For Faster Extraction** (more resources):
```typescript
// ExtractionQueue.ts
export const extractionQueue = new ContactExtractionQueue(5); // 5 concurrent

// BrowserPool.ts
const browserPool = new BrowserPool({ maxInstances: 5 });
```

**For Lower Resource Usage** (slower):
```typescript
export const extractionQueue = new ContactExtractionQueue(1); // 1 concurrent
const browserPool = new BrowserPool({ maxInstances: 1 });
```

### Optimization 2: Enable Caching

Cache extraction results by URL:

```typescript
// Add to ContactDiscovery.ts
const cache = new Map<string, ContactInfo>();

async function extractWithCache(url: string): Promise<ContactInfo> {
  const cacheKey = hashUrl(url);

  if (cache.has(cacheKey)) {
    console.log('Cache hit for:', url);
    return cache.get(cacheKey)!;
  }

  const result = await discoverAndExtractContactInfo(url);
  cache.set(cacheKey, result);
  return result;
}
```

### Optimization 3: Reduce AI Content Length

Limit page content before sending to AI:

```typescript
// Already implemented in ContactDiscovery.ts
const cleanedContent = await page.evaluate(() => {
  document.querySelectorAll('script, style, img, svg').forEach(e => e.remove());
  return document.body.innerText.substring(0, 15000); // Limit to 15k chars
});
```

**Adjust for Cost/Accuracy Trade-off**:
- 5,000 chars: Lower cost, slightly lower accuracy
- 15,000 chars: Balanced (recommended)
- 50,000 chars: Higher cost, marginally better accuracy

### Optimization 4: Batch Database Updates

Update database in batches instead of per-item:

```typescript
// Add to ExtractionQueue.ts
private pendingUpdates: Array<{ resultId: number, data: any }> = [];

private async flushUpdates(): Promise<void> {
  if (this.pendingUpdates.length === 0) return;

  await dataSource.getRepository(ContactInfoEntity).save(this.pendingUpdates);
  this.pendingUpdates = [];
}

// Call every 5 seconds
setInterval(() => this.flushUpdates(), 5000);
```

---

## Monitoring

### View Extraction Statistics

Query database for statistics:

```sql
-- Success rate
SELECT
  extraction_status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM contact_info), 2) as percentage
FROM contact_info
GROUP BY extraction_status;

-- Average extraction duration
SELECT
  AVG(CAST(extraction_metadata->>'extractionDuration' AS INTEGER)) as avg_duration_ms
FROM contact_info
WHERE extraction_status = 'completed';

-- Discovery method distribution
SELECT
  extraction_metadata->>'discoveryMethod' as method,
  COUNT(*) as count
FROM contact_info
WHERE extraction_status = 'completed'
GROUP BY method;
```

### Monitor Browser Pool Stats

```typescript
// Add logging to BrowserPool.ts
setInterval(() => {
  const stats = browserPool.getStats();
  console.log('Browser Pool Stats:', stats);
  // Output: { total: 3, available: 1, inUse: 2 }
}, 10000); // Every 10 seconds
```

### Monitor Queue Depth

```typescript
// Add logging to ExtractionQueue.ts
setInterval(() => {
  const queueLength = extractionQueue.getQueueLength();
  const activeCount = extractionQueue.getActiveCount();
  console.log(`Queue: ${queueLength} pending, ${activeCount} active`);
}, 5000); // Every 5 seconds
```

---

## Best Practices

### DO ✅

- Start with small batches (5-10 items) to test
- Monitor extraction progress in real-time
- Check failed extractions for patterns (e.g., same domain)
- Use retries for transient failures
- Keep AI service API key secure (use .env file)
- Close browsers after extraction completes

### DON'T ❌

- Extract from > 50 items at once (can overwhelm system)
- Ignore error messages (check logs)
- Run extractions with unstable network
- Share .env file with API keys
- Set concurrency too high (> 10 on 8GB RAM)
- Skip database backups before production use

---

## Getting Help

### Documentation

- **Research**: `specs/001-ai-contact-extraction/research.md`
- **Data Model**: `specs/001-ai-contact-extraction/data-model.md`
- **API Contracts**: `specs/001-ai-contact-extraction/contracts/`
- **Technical Advice**: `specs/001-ai-contact-extraction/technical-advice.md`

### Debugging

Enable detailed logging:

```bash
# All contact extraction logs
DEBUG=contact-extraction:* yarn dev

# Specific modules
DEBUG=contact-extraction:worker,contact-extraction:discovery yarn dev

# Puppeteer internals
DEBUG=puppeteer-extra:* yarn dev
```

### Support

For issues or questions:
1. Check logs (DevTools Console)
2. Review troubleshooting section above
3. Check existing GitHub issues
4. Create new issue with:
   - Error message
   - Steps to reproduce
   - System info (OS, Node version, RAM)
   - Debug logs (with DEBUG=contact-extraction:*)

---

## Next Steps

1. ✅ **Setup Complete**: You've completed the quick start guide
2. 📚 **Learn More**: Read `research.md` for technical details
3. 🧪 **Run Tests**: Execute test suite to verify setup
4. 🚀 **Start Extracting**: Try extracting from a small batch
5. 📊 **Monitor Performance**: Check statistics and optimize

---

**Status**: Quick start guide complete | **Last Updated**: 2025-02-06

**Happy Extracting! 🎉**
