# Google Proxy Check Implementation Plan

## Overview
Add functionality to check if proxies can pass Google's bot detection when users click "Check Proxy". Display the Google pass status in a new column in the proxy table.

---

## 1. Database Schema Changes

### 1.1 Update ProxyCheck Entity
**File:** `src/entity/ProxyCheck.entity.ts`

**Changes:**
- Add new column `google_pass` (integer, nullable) to store Google pass status
- Values: `1` = Pass, `2` = Fail, `null` = Not checked

**Implementation:**
```typescript
@Column("integer", { nullable: true })
google_pass: number | null;
```

### 1.2 Update ProxyCheck Model
**File:** `src/model/ProxyCheck.model.ts`

**Changes:**
- Add enum for Google pass status
- Add method `updateGooglePassStatus(proxyId: number, status: number | null): Promise<void>`
- Update `getProxyCheck()` to return google_pass field

**New Enum:**
```typescript
export enum googlePassStatus {
    Pass = 1,
    Fail = 2,
}
```

---

## 2. Backend Implementation

### 2.1 Create Google Proxy Check Child Process
**File:** `src/childprocess/googleProxyCheck.ts` (NEW FILE)

**Purpose:** Run Puppeteer Google check in a separate process to avoid blocking the main Electron process.

**Implementation Strategy:**
1. Listen for messages from parent process via `process.parentPort` (Electron's utilityProcess IPC)
2. Receive proxy details and timeout configuration
3. Launch Puppeteer browser with stealth plugin in child process
4. Configure proxy settings (HTTP/HTTPS/SOCKS)
5. Navigate to `https://www.google.com/ncr` (no country redirect)
6. Wait for page load (timeout: 15 seconds default)
7. Check for Google blocking indicators:
   - "Our systems have detected unusual traffic from your computer network"
   - reCAPTCHA presence
   - Blocked/error pages
   - Successful search page load (indicates pass)
8. Clean up browser instance
9. Send result back to parent process via IPC
10. Exit child process

**Message Format:**
```typescript
// Request from parent (sent via child.postMessage)
{
  type: "CHECK_GOOGLE_PASS",
  proxy: ProxyParseItem,
  timeout?: number,
  requestId: string // Unique ID for this check
}

// Response to parent (sent via parentPort.postMessage)
{
  type: "CHECK_GOOGLE_PASS_RESULT",
  requestId: string,
  success: boolean,
  passed: boolean, // true = pass, false = fail
  error?: string
}
```

**Dependencies:**
- Use existing Puppeteer setup from `src/modules/browserManager.ts`
- Use stealth plugin from `puppeteer-extra-plugin-stealth`
- Use `@lem0-packages/puppeteer-page-proxy` for proxy configuration
- Follow pattern from `src/childprocess/searchScraper.ts` and `src/childprocess/googleScraper.ts`

**Key Implementation Details:**
- Use `addExtra(vanillaPuppeteer)` with `StealthPlugin()`
- Handle proxy authentication (username/password) correctly
- Support HTTP, HTTPS, and SOCKS proxies
- Always clean up browser in finally block
- Handle timeouts gracefully
- Log errors to stderr for parent process to capture

**Code Structure Example:**
```typescript
// src/childprocess/googleProxyCheck.ts
import puppeteer from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import useProxy from '@lem0-packages/puppeteer-page-proxy';
import { ProxyParseItem } from '@/entityTypes/proxyType';
import { convertProxyServertourl } from '@/modules/lib/function';

// Set up stealth plugin
const puppeteerExtra = addExtra(puppeteer);
puppeteerExtra.use(StealthPlugin());

// Get parentPort from Electron utilityProcess (following codebase pattern)
const parentPort = (process as unknown as { 
  parentPort?: { 
    on: (event: string, handler: (e: { data: string }) => void) => void;
    postMessage: (message: unknown) => void;
  } 
}).parentPort;

// Listen for messages from parent process
if (parentPort) {
  parentPort.on('message', async (e: { data: string }) => {
    let requestId = 'unknown';
    try {
      const message = JSON.parse(e.data);
      requestId = message.requestId || 'unknown';
      
      if (message.type === 'CHECK_GOOGLE_PASS') {
        const result = await checkGooglePass(message.proxy, message.timeout);
        if (parentPort) {
          parentPort.postMessage(JSON.stringify({
            type: 'CHECK_GOOGLE_PASS_RESULT',
            requestId: requestId,
            success: true,
            passed: result
          }));
        }
      }
    } catch (error) {
      if (parentPort) {
        parentPort.postMessage(JSON.stringify({
          type: 'CHECK_GOOGLE_PASS_RESULT',
          requestId: requestId,
          success: false,
          passed: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    }
  });
}

async function checkGooglePass(proxy: ProxyParseItem, timeout = 15000): Promise<boolean> {
  let browser;
  try {
    // Launch browser
    browser = await puppeteerExtra.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Configure proxy (convert proxy to URL format)
    const proxyUrl = convertProxyServertourl({
      server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      username: proxy.user,
      password: proxy.pass
    });
    await useProxy(page, proxyUrl);
    
    // Navigate to Google
    await page.goto('https://www.google.com/ncr', {
      waitUntil: 'networkidle2',
      timeout
    });
    
    // Check for blocking
    const content = await page.content();
    const isBlocked = content.includes('unusual traffic') || 
                     content.includes('detected unusual traffic') ||
                     content.includes('Sorry, we have detected unusual traffic');
    
    // Check for search input (indicates success)
    const searchInput = await page.$('input[name="q"], #search, textarea[name="q"]');
    const hasSearchInput = searchInput !== null;
    
    return !isBlocked && hasSearchInput;
  } catch (error) {
    console.error('Google check error:', error);
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
```

### 2.2 Add Google Check Method in ProxyController
**File:** `src/controller/proxy-controller.ts`

**New Method:** `checkGooglePass(proxyEntity: ProxyParseItem, timeout = 15000): Promise<boolean>`

**Implementation Strategy:**
1. Use Electron's `utilityProcess.fork()` to spawn child process
2. Create MessageChannel for IPC communication
3. Send proxy details and timeout to child process
4. Wait for result from child process (with timeout)
5. Clean up child process after completion
6. Return boolean: `true` = pass, `false` = fail

**Pattern to Follow:**
- Similar to `src/modules/SearchModule.ts` line 289-329
- Use `utilityProcess.fork()` with child process path
- Use `MessageChannelMain` for IPC
- Handle child process lifecycle (spawn, message, exit, error)
- Set up timeout to kill child process if it hangs

**Child Process Path:**
- Development: `path.join(__dirname, '../childprocess/googleProxyCheck.js')`
- Production: Compiled path in `dist/childprocess/googleProxyCheck.js`

**Code Structure Example:**
```typescript
// In ProxyController.checkGooglePass()
import { utilityProcess } from 'electron';
import * as path from 'path';

async checkGooglePass(proxyEntity: ProxyParseItem, timeout = 15000): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const childPath = path.join(__dirname, '../childprocess/googleProxyCheck.js');
    const requestId = `google-check-${Date.now()}-${Math.random()}`;
    
    const child = utilityProcess.fork(childPath, [], {
      stdio: 'pipe',
      execArgv: [],
      env: { ...process.env, NODE_OPTIONS: '' }
    });
    
    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error('Google check timeout'));
    }, timeout + 5000); // Add buffer to timeout
    
    child.on('spawn', () => {
      // Send message to child process
      child.postMessage(JSON.stringify({
        type: 'CHECK_GOOGLE_PASS',
        proxy: proxyEntity,
        timeout,
        requestId
      }));
    });
    
    const messageHandler = (message: { data: string }) => {
      try {
        const response = JSON.parse(message.data);
        if (response.type === 'CHECK_GOOGLE_PASS_RESULT' && response.requestId === requestId) {
          clearTimeout(timeoutId);
          child.removeListener('message', messageHandler);
          child.kill();
          if (response.success) {
            resolve(response.passed);
          } else {
            reject(new Error(response.error || 'Google check failed'));
          }
        }
      } catch (error) {
        clearTimeout(timeoutId);
        child.kill();
        reject(error);
      }
    };
    
    child.on('message', messageHandler);
    
    child.on('exit', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0 && code !== null) {
        reject(new Error(`Child process exited with code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      clearTimeout(timeoutId);
      child.kill();
      reject(error);
    });
  });
}
```

**Note:** This follows the simpler pattern used in `websiteContentScraper.ts` - direct message passing without MessageChannel. The child process listens on `parentPort` and responds directly.

**Error Handling:**
- If child process fails to spawn → return `false`
- If child process times out → kill process, return `false`
- If child process crashes → return `false`
- Always clean up child process reference

**Dependencies:**
- Import `utilityProcess` and `MessageChannelMain` from `electron`
- Import path utilities for child process file resolution

### 2.3 Update updateProxyStatus Method
**File:** `src/controller/proxy-controller.ts`

**Changes:**
- After basic proxy check succeeds, also run Google check via child process
- Update both `status` (basic check) and `google_pass` (Google check) in database
- Handle errors gracefully - if Google check fails, still update basic status
- Run Google check asynchronously to avoid blocking (can run in parallel with other operations)

**Flow:**
```typescript
1. Check basic proxy connectivity (existing logic)
2. Update basic status in database (existing logic)
3. If basic check passes:
   - Run checkGooglePass() via child process (non-blocking)
   - Update google_pass status in database when result is received
   - Handle child process errors gracefully (mark as fail if check fails)
```

**Async Considerations:**
- Google check can run asynchronously after basic check completes
- Don't block batch checking operations waiting for Google checks
- Consider running multiple Google checks in parallel (with concurrency limit)
- Use Promise.allSettled() for batch operations to handle individual failures

### 2.4 Update checkAllproxy Method
**File:** `src/controller/proxy-controller.ts`

**Changes:**
- Ensure Google check is called for each proxy during batch checking
- Handle child process lifecycle for multiple concurrent checks
- Consider concurrency limit for Google checks (e.g., max 3-5 concurrent child processes)
- Use Promise queue or similar pattern to manage child process spawning

**Concurrency Management:**
- Don't spawn unlimited child processes (memory/resource constraints)
- Queue Google checks if concurrency limit reached
- Clean up child processes promptly after completion
- Monitor child process count to prevent resource exhaustion

**Implementation Pattern:**
```typescript
// Pseudo-code for batch checking with concurrency limit
const MAX_CONCURRENT_GOOGLE_CHECKS = 3;
const googleCheckQueue = [];

for (const proxy of proxies) {
  // Basic check first
  await updateProxyStatus(proxy, proxyId);
  
  // Queue Google check if basic check passed
  if (basicCheckPassed) {
    googleCheckQueue.push(() => checkGooglePass(proxy));
  }
}

// Process Google checks with concurrency limit
await processQueue(googleCheckQueue, MAX_CONCURRENT_GOOGLE_CHECKS);
```

---

## 3. Type Definitions

### 3.1 Update ProxyListEntity
**File:** `src/entityTypes/proxyType.ts`

**Changes:**
- Add `googlePass?: number` field
- Add `googlePassName?: string` field (for display: "Pass", "Fail", "Not Checked")

**Updated Type:**
```typescript
export type ProxyListEntity={
    // ... existing fields ...
    googlePass?: number;
    googlePassName?: string;
}
```

### 3.2 Update ProxyCheckres (if needed)
**File:** `src/entityTypes/proxyType.ts`

**Optional:** Add Google check result to response type if needed for individual checks

---

## 4. Frontend Implementation

### 4.1 Update ProxyTable Component
**File:** `src/views/pages/proxy/widgets/ProxyTable.vue`

**Changes:**
1. **Add new column to headers array:**
   ```typescript
   {
       title: computed(_ => CapitalizeFirstLetter(t("proxy.google_pass"))),
       align: 'start',
       sortable: false,
       key: 'googlePassName',
   }
   ```

2. **Update data processing in loadItems():**
   - Map `googlePass` status to display name:
     - `1` → "Pass" (green)
     - `2` → "Fail" (red)
     - `null/undefined` → "Not Checked" (gray)

3. **Add translation keys** (in language files):
   - `proxy.google_pass`: "Google Pass"
   - `proxy.google_pass_pass`: "Pass"
   - `proxy.google_pass_fail`: "Fail"
   - `proxy.google_pass_not_checked`: "Not Checked"

### 4.2 Update ProxyController.getProxylist
**File:** `src/controller/proxy-controller.ts`

**Changes:**
- In `getProxylist()`, when fetching check info, also get `google_pass` status
- Map `google_pass` to `googlePass` and `googlePassName` in records

**Implementation:**
```typescript
const checkInfo = await checkDb.getProxyCheck(res.data.records[i].id!)
if (checkInfo) {
    res.data.records[i].status = checkInfo.status
    res.data.records[i].checktime = checkInfo.check_time
    res.data.records[i].googlePass = checkInfo.google_pass
    
    // Map to display name
    if (checkInfo.google_pass === 1) {
        res.data.records[i].googlePassName = "Pass"
    } else if (checkInfo.google_pass === 2) {
        res.data.records[i].googlePassName = "Fail"
    } else {
        res.data.records[i].googlePassName = "Not Checked"
    }
}
```

---

## 5. Translation Files

### 5.1 Add Translation Keys
**Files:** 
- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/ja.ts`
- `src/views/lang/de.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/es.ts`

**New Keys:**
```typescript
proxy: {
    // ... existing keys ...
    google_pass: "Google Pass",
    google_pass_pass: "Pass",
    google_pass_fail: "Fail",
    google_pass_not_checked: "Not Checked",
}
```

---

## 6. Implementation Details

### 6.1 Google Check Detection Logic

**Success Indicators:**
- Page loads successfully
- Search input field is visible (`#search`, `input[name="q"]`, etc.)
- No blocking messages in page content
- Page title contains "Google" (not error page)

**Failure Indicators:**
- "Our systems have detected unusual traffic from your computer network"
- reCAPTCHA challenge present
- "Sorry, we have detected unusual traffic" message
- Timeout after 15 seconds
- Network errors

**Implementation Notes:**
- **Child Process Architecture:** All Puppeteer operations run in separate child process to avoid blocking main process
- Use headless mode for performance (can be configurable)
- Set reasonable timeout (15 seconds default)
- Clean up browser instances properly in child process to avoid memory leaks
- Clean up child processes in main process after completion
- Handle proxy authentication (username/password) correctly
- Support HTTP, HTTPS, and SOCKS proxies
- Child process should exit cleanly after sending result
- Main process should handle child process crashes gracefully

### 6.2 Error Handling

**Scenarios:**
1. **Google check times out** → Mark as "Fail"
2. **Browser launch fails** → Log error, mark as "Fail"
3. **Proxy connection fails during Google check** → Mark as "Fail"
4. **Page loads but detection is uncertain** → Mark as "Fail" (conservative approach)

**Logging:**
- Log all Google check attempts with proxy ID
- Log failures with reason (timeout, blocking detected, etc.)
- Use existing logging infrastructure

---

## 7. Testing Considerations

### 7.1 Unit Tests
**File:** `test/modules/proxy-controller.test.ts` (create if doesn't exist)

**Test Cases:**
1. `checkGooglePass()` returns true for working proxy
2. `checkGooglePass()` returns false for blocked proxy
3. `checkGooglePass()` handles timeout correctly
4. `updateProxyStatus()` updates both basic and Google status
5. Database updates correctly store google_pass status

### 7.2 Integration Tests
- Test full check flow: basic check → Google check → database update
- Test batch checking with Google pass status
- Test frontend display of Google pass column

---

## 8. Performance Considerations

### 8.1 Optimization Strategies
1. **Parallel Checking:** Run basic check and Google check in parallel (if basic check is quick)
2. **Timeout Management:** Use reasonable timeout (15s) to avoid long waits
3. **Browser Reuse:** Consider reusing browser instances for batch checks (with caution)
4. **Skip Google Check:** If basic check fails, skip Google check (save time)

### 8.2 Resource Management
- Always close browser instances after check
- Limit concurrent Google checks (if batch processing)
- Monitor memory usage during batch operations

---

## 9. Migration Strategy

### 9.1 Database Migration
- Add `google_pass` column to existing `proxy_check` table
- Set existing records to `null` (not checked)
- No data loss - existing functionality remains intact

### 9.2 Backward Compatibility
- Existing proxy checks continue to work
- Google check is additive - doesn't break existing flows
- Frontend gracefully handles missing `googlePass` field (shows "Not Checked")

---

## 10. Implementation Order

### Phase 1: Database & Backend Core
1. ✅ Update `ProxyCheck.entity.ts` - Add `google_pass` column
2. ✅ Update `ProxyCheck.model.ts` - Add methods and enum
3. ✅ Create `googleProxyCheck.ts` child process file
4. ✅ Implement `checkGooglePass()` in `ProxyController` (using child process)
5. ✅ Update `updateProxyStatus()` to include Google check
6. ✅ Test backend functionality (child process communication)

### Phase 2: Data Flow
6. ✅ Update `getProxylist()` to include Google pass status
7. ✅ Update `ProxyListEntity` type definition
8. ✅ Test data retrieval and mapping

### Phase 3: Frontend
9. ✅ Add translation keys to all language files
10. ✅ Add Google Pass column to ProxyTable headers
11. ✅ Update data processing in `loadItems()`
12. ✅ Test frontend display

### Phase 4: Testing & Refinement
13. ✅ Write unit tests
14. ✅ Test with real proxies (passing and failing)
15. ✅ Performance testing with batch operations
16. ✅ UI/UX refinement

---

## 11. Future Enhancements (Optional)

1. **Separate Google Check Button:** Allow users to check Google pass status independently
2. **Google Check History:** Track Google pass status over time
3. **Filter by Google Pass:** Add filter to show only proxies that pass Google
4. **Auto-retry:** Automatically retry failed Google checks
5. **Detailed Error Messages:** Show specific reason for Google check failure
6. **Configurable Timeout:** Allow users to configure Google check timeout
7. **Multiple Test URLs:** Test against multiple Google domains (google.com, google.co.uk, etc.)

---

## 12. Risk Assessment

### Low Risk
- Database schema changes (additive, nullable column)
- Type definition updates
- Frontend display changes

### Medium Risk
- Puppeteer browser management in child process (memory leaks, resource cleanup)
- Child process lifecycle management (spawning, cleanup, error handling)
- Google detection logic (may need refinement based on testing)
- Performance impact of additional checks
- Child process concurrency management (resource limits)

### Mitigation
- Thorough testing with various proxy types
- Proper error handling and logging in both main and child processes
- Resource cleanup in finally blocks (browser in child, child process in main)
- Timeout management to prevent hanging (kill child process on timeout)
- Concurrency limits to prevent resource exhaustion
- Monitor child process count and memory usage
- Test child process crash scenarios

---

## Notes

- **Child Process Architecture:** All Puppeteer operations MUST run in child processes to avoid blocking the main Electron process. This is critical for application responsiveness.
- Google's detection mechanisms may change over time - implementation should be flexible
- Consider rate limiting if checking many proxies to avoid IP bans
- May want to add configuration option to enable/disable Google checking
- Consider caching Google check results for a period (e.g., 24 hours) to avoid redundant checks
- Child processes should be lightweight and exit quickly after completing their task
- Monitor child process spawn/kill cycles to ensure proper cleanup
- Consider using a child process pool for better resource management in future iterations