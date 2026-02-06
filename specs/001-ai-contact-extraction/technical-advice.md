# Technical Advice: AI-Powered Contact Information Extraction

**Feature**: 001-ai-contact-extraction
**Created**: 2025-02-06
**Purpose**: Architecture and implementation recommendations for achieving the specification goals

## Table of Contents

1. [Sub-Process Architecture for Puppeteer](#1-sub-process-architecture-for-puppeteer)
2. [Remote AI Server Integration](#2-remote-ai-server-integration)
3. [Contact Page Discovery Strategy](#3-contact-page-discovery-strategy)
4. [Database Schema Updates](#4-database-schema-updates)
5. [Frontend Integration](#5-frontend-integration-search-detail-page)
6. [Batch Processing & Concurrency](#6-batch-processing--concurrency)
7. [Error Handling & Edge Cases](#7-error-handling--edge-cases)
8. [Testing Strategy](#8-testing-strategy)
9. [Specific Technology Recommendations](#9-specific-technology-recommendations)
10. [Implementation Order (MVP Approach)](#10-implementation-order-mvp-approach)

---

## 1. Sub-Process Architecture for Puppeteer

### Recommended Approach: Worker Process Pattern

Create a dedicated **worker process** (`contact-extraction-worker.ts`) similar to your existing `worker.ts`.

**Architecture**:
```
[Main Process]
    ↓ IPC
[Worker Process - contact-extraction-worker.ts]
    ↓
[Puppeteer Browser Instances]
    ↓
[Remote AI Server]
    ↓
[Local Database]
```

**Why**:
- **Isolation**: If Puppeteer crashes, it doesn't crash your main Electron app
- **Resource Management**: Worker processes can be terminated/restarted independently
- **Your codebase already has this pattern**: See `worker.ts` for reference

### Technical Options

**Option A: Node.js `child_process.spawn()` with IPC messaging** ✅ **RECOMMENDED**
- You already use this pattern in your codebase
- Puppeteer requires a full process context
- Full control over worker lifecycle

```typescript
import { spawn } from 'child_process';

const worker = spawn('node', ['path/to/contact-extraction-worker.js'], {
  stdio: ['pipe', 'pipe', 'pipe', 'ipc']
});

worker.send({ type: 'extract-contact', resultIds: [1, 2, 3] });
```

**Option B: `electron.utilityProcess` (Electron 20+)**
- More secure, runs in separate process
- Better security context
- Only available in newer Electron versions

**Option C: `worker_threads`**
- Better for CPU-intensive tasks
- Not suitable for Puppeteer (needs full process)

**Recommendation**: **Option A** since you already use this pattern and Puppeteer requires a full process context.

---

## 2. Remote AI Server Integration

### Recommended Pattern: Bidirectional Communication

**Architecture Flow**:
```
[Renderer Vue Component]
    ↓ IPC invoke
[Main Process Handler]
    ↓ IPC send
[Worker Process]
    ↓ Puppeteer
[Web Browser Instance]
    ↓ Extract page text
[Remote AI Server]
    ↓ Structured JSON
[Worker Process]
    ↓ Save to Database
[Main Process]
    ↓ IPC event
[Renderer UI Update]
```

### Communication Options

**Option A: WebSocket** ✅ **RECOMMENDED for Real-Time Updates**
- Real-time progress updates back to the frontend
- Bidirectional communication for streaming large page content
- Your codebase already has WebSocket integration (see `websocket-ipc.test.ts`)

**Option B: REST API with Polling**
- Simpler to implement
- Worse UX (no real-time updates)
- Higher latency

### Data Flow Example

```typescript
// 1. Renderer sends request
await ipcRenderer.invoke('start-contact-extraction', {
  resultIds: [1, 2, 3]
});

// 2. Main process forwards to worker
worker.send({
  type: 'extract-contact',
  resultIds: [1, 2, 3],
  batchId: 'unique-batch-id'
});

// 3. Worker extracts content and sends to AI
const pageContent = await extractPageContent(url);
const aiResponse = await fetch(AI_SERVICE_URL, {
  method: 'POST',
  body: JSON.stringify({
    url,
    entity: derivedEntityName,
    content: pageContent,
    fields: ['email', 'phone', 'address', 'social_links']
  })
});

// 4. Worker saves to database and sends progress
await saveToDatabase(resultId, aiResponse.data);
worker.send({
  type: 'extraction-progress',
  batchId: '...',
  resultId: 123,
  status: 'completed',
  data: { email: '...', phone: '...', address: '...' }
});

// 5. Main process forwards to renderer
mainWindow.webContents.send('contact-extraction-progress', {
  resultId: 123,
  data: { email: '...', phone: '...', address: '...' },
  status: 'completed'
});
```

---

## 3. Contact Page Discovery Strategy

Based on your documentation (`Find_contact_page.md` and `find_contact_in_page.md`), implement a **multi-stage discovery pipeline**:

### Stage 1: Homepage Direct Scan (Fastest)

```typescript
async function scanHomepageForContactInfo(page: Page) {
  const content = await page.content();

  // Regex patterns for common contact formats
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const phonePattern = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

  const emails = content.match(emailPattern);
  const phones = content.match(phonePattern);

  if (emails || phones) {
    return { emails, phones };
  }
  return null; // Fall through to next stage
}
```

### Stage 2: Heuristic Link Scoring (From Your Docs)

```typescript
async function findContactPageHeuristic(page: Page) {
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a'));
    return anchors.map(a => ({
      href: a.href,
      text: a.innerText.toLowerCase().trim(),
      aria: (a.getAttribute('aria-label') || '').toLowerCase(),
      visible: a.offsetWidth > 0 && a.offsetHeight > 0
    })).filter(link => link.href && !link.href.startsWith('javascript'));
  });

  const keywords = [
    { word: 'contact', score: 10 },
    { word: 'get in touch', score: 8 },
    { word: 'support', score: 6 },
    { word: 'about', score: 4 },
    { word: 'help', score: 2 }
  ];

  let bestLink = null;
  let highestScore = 0;

  for (const link of links) {
    let score = 0;

    // Score visible text (higher weight)
    keywords.forEach(k => {
      if (link.text.includes(k.word)) score += k.score;
    });

    // Score URL (lower weight)
    keywords.forEach(k => {
      if (link.href.includes(k.word)) score += (k.score / 2);
    });

    // Check for mailto links (direct email)
    if (link.href.startsWith('mailto:')) {
      return { email: link.href.replace('mailto:', '') };
    }

    if (score > highestScore) {
      highestScore = score;
      bestLink = link.href;
    }
  }

  return bestLink;
}
```

### Stage 3: Fallback Standard Routes

```typescript
async function checkStandardRoutes(baseUrl: string) {
  const commonPaths = ['/contact', '/contact-us', '/about', '/about-us', '/support'];

  for (const path of commonPaths) {
    const url = new URL(path, baseUrl).toString();
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        return url;
      }
    } catch (e) {
      // Continue to next path
    }
  }
  return null;
}
```

### Stage 4: AI-Assisted Extraction

```typescript
async function extractWithAI(page: Page, url: string) {
  // Derive entity name (from your docs)
  const pageTitle = await page.title();
  const hostname = new URL(url).hostname.replace('www.', '').split('.')[0];
  const derivedEntity = pageTitle.includes(hostname) ? pageTitle : hostname;

  // Clean page content
  const cleanedContent = await page.evaluate(() => {
    document.querySelectorAll('script, style, img, svg').forEach(e => e.remove());
    return document.body.innerText.substring(0, 15000);
  });

  // Send to AI with context
  const aiResponse = await fetch(AI_SERVICE_URL, {
    method: 'POST',
    body: JSON.stringify({
      entity: derivedEntity,
      content: cleanedContent,
      fields: ['email', 'phone', 'address', 'social_links']
    })
  });

  return await aiResponse.json();
}
```

### Complete Discovery Pipeline

```typescript
async function discoverAndExtractContactInfo(url: string) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try {
    // Stage 1: Direct scan
    await page.goto(url, { waitUntil: 'networkidle0' });
    const directResult = await scanHomepageForContactInfo(page);
    if (directResult) return directResult;

    // Stage 2: Heuristic discovery
    const contactPageUrl = await findContactPageHeuristic(page);
    if (contactPageUrl) {
      await page.goto(contactPageUrl, { waitUntil: 'networkidle0' });
      const content = await page.content();
      const directResult = await scanHomepageForContactInfo(page);
      if (directResult) return directResult;
    }

    // Stage 3: Fallback routes
    const fallbackUrl = await checkStandardRoutes(url);
    if (fallbackUrl) {
      await page.goto(fallbackUrl, { waitUntil: 'networkidle0' });
    }

    // Stage 4: AI extraction
    const aiResult = await extractWithAI(page, url);
    return aiResult;

  } finally {
    await browser.close();
  }
}
```

---

## 4. Database Schema Updates

### ✅ RECOMMENDED: Independent Contact Information Table

Create a separate `ContactInfo` entity to maintain proper data normalization and separation of concerns.

#### Entity Relationship

```
SearchResEntity (1:1) ContactInfo
```

#### New Entity: ContactInfo

```typescript
// src/entity/ContactInfo.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  Index
} from 'typeorm';
import { SearchResEntity } from './SearchResEntity';

@Entity('contact_info')
@Index(['resultId']) // For faster lookups
export class ContactInfo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'result_id' })
  resultId: number; // Foreign key to SearchResEntity

  @OneToOne(() => SearchResEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'result_id' })
  searchResult: SearchResEntity;

  @Column({ name: 'email', nullable: true, type: 'text' })
  email: string | null;

  @Column({ name: 'phone', nullable: true, type: 'text' })
  phone: string | null;

  @Column({ name: 'address', nullable: true, type: 'text' })
  address: string | null;

  @Column({ name: 'social_links', nullable: true, type: 'json' })
  socialLinks: string[] | null; // Array of social media URLs

  @Column({
    name: 'extraction_status',
    type: 'enum',
    enum: ['pending', 'analyzing', 'completed', 'failed'],
    default: 'pending'
  })
  extractionStatus: string;

  @Column({ name: 'extraction_error', nullable: true, type: 'text' })
  extractionError: string | null;

  @CreateDateColumn({ name: 'extraction_date' })
  extractionDate: Date;

  @Column({ name: 'extraction_metadata', nullable: true, type: 'json' })
  extractionMetadata: {
    discoveredPageUrl?: string;
    discoveryMethod?: string;
    aiServiceVersion?: string;
    retryCount?: number;
  } | null;
}
```

#### Update Existing Entity: SearchResEntity

```typescript
// src/entity/SearchResEntity.ts

import { Entity, PrimaryGeneratedColumn, Column, OneToOne } from 'typeorm';
import { ContactInfo } from './ContactInfo';

@Entity()
export class SearchResEntity {
  @PrimaryGeneratedColumn()
  id: number;

  // ... existing fields (link, title, keyword, record_time, etc.)

  @OneToOne(() => ContactInfo, contactInfo => contactInfo.searchResult, {
    nullable: true,
    eager: false // Load on demand to avoid unnecessary queries
  })
  contactInfo: ContactInfo | null;
}
```

#### Migration Script

```typescript
// src/migrations/CreateContactInfoTable.ts

import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateContactInfoTable1234567890123 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'contact_info',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'result_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'email',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'phone',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'address',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'social_links',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'extraction_status',
            type: 'enum',
            enum: ['pending', 'analyzing', 'completed', 'failed'],
            default: "'pending'",
          },
          {
            name: 'extraction_error',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'extraction_date',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'extraction_metadata',
            type: 'json',
            isNullable: true,
          },
        ],
      }),
      true
    );

    // Create foreign key constraint
    await queryRunner.createForeignKey(
      'contact_info',
      new TableForeignKey({
        columnNames: ['result_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'search_res_entity',
        onDelete: 'CASCADE', // Delete contact info when search result is deleted
      })
    );

    // Create index for faster queries
    await queryRunner.createIndex(
      'contact_info',
      new TableIndex({
        columnNames: ['result_id'],
        isUnique: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('contact_info');
  }
}
```

#### Database Operations

**Create Contact Info**:
```typescript
const contactInfo = new ContactInfo();
contactInfo.resultId = searchResultId;
contactInfo.email = extractedData.email;
contactInfo.phone = extractedData.phone;
contactInfo.address = extractedData.address;
contactInfo.socialLinks = extractedData.social_links;
contactInfo.extractionStatus = 'completed';

await dataSource.getRepository(ContactInfo).save(contactInfo);
```

**Query with Contact Info**:
```typescript
const results = await dataSource.getRepository(SearchResEntity)
  .createQueryBuilder('searchResult')
  .leftJoinAndSelect('searchResult.contactInfo', 'contactInfo')
  .where('searchResult.id IN (:...ids)', { ids: [1, 2, 3] })
  .getMany();
```

**Update Extraction Status**:
```typescript
await dataSource.getRepository(ContactInfo)
  .update({ resultId }, { extractionStatus: 'analyzing' });
```

### Why Independent Table?

| Aspect | Independent Table ✅ | Adding Columns to Existing |
|--------|---------------------|---------------------------|
| **Data Normalization** | Clean separation, follows 3NF | Violates normalization |
| **Query Performance** | Only load when needed | Always loaded (waste) |
| **Flexibility** | Easy to extend contact fields | Clutters main entity |
| **Re-extraction** | Easy to delete/recreate | Messy with nulls |
| **Relationship Clarity** | Explicit 1:1 relationship | Implicit coupling |
| **Migration Safety** | Minimal risk to existing data | Risky schema change |

---

## 5. Frontend Integration (Search Detail Page)

Looking at your existing `SearchDetailTable.vue`, you already have similar functionality with the "AI Analyze" button. Follow the same pattern.

### UI Components Needed

#### 1. New Button: "Get Contact Info with AI"

Add button next to the "AI Analyze" button (around line 11-16 in your Vue file):

```vue
<v-btn
  class="btn mr-2"
  variant="flat"
  color="purple"
  prepend-icon="mdi-robot-love"
  @click="handleGetContactInfo"
  :disabled="selectedCount === 0"
  :loading="extractingContact"
>
  <span>{{ t('contactExtraction.extract_button') || 'Get Contact Info' }} {{ selectedCount > 0 ? `(${selectedCount})` : '' }}</span>
</v-btn>
```

#### 2. New Table Columns

Add columns for extracted contact info (around line 267 in headers):

```typescript
{
  title: computed(_ => CapitalizeFirstLetter(t("contactExtraction.email") || 'Email')),
  align: 'start',
  sortable: false,
  key: 'contact_email',
  width: '200px',
},
{
  title: computed(_ => CapitalizeFirstLetter(t("contactExtraction.phone") || 'Phone')),
  align: 'start',
  sortable: false,
  key: 'contact_phone',
  width: '150px',
},
{
  title: computed(_ => CapitalizeFirstLetter(t("contactExtraction.extraction_status") || 'Status')),
  align: 'start',
  sortable: false,
  key: 'extraction_status',
  width: '150px',
},
```

#### 3. Template Slots for Display

```vue
<template v-slot:[`item.contact_email`]="{ item }">
  <div class="contact-cell">
    <v-chip v-if="item.contact_email" size="small" color="success" variant="outlined">
      {{ item.contact_email }}
    </v-chip>
    <span v-else class="text-grey">-</span>
  </div>
</template>

<template v-slot:[`item.extraction_status`]="{ item }">
  <div class="extraction-status-cell">
    <v-chip
      v-if="item.extraction_status"
      size="small"
      :color="getExtractionStatusColor(item.extraction_status)"
      variant="flat"
    >
      {{ getExtractionStatusText(item.extraction_status) }}
    </v-chip>
    <span v-else class="text-grey">-</span>
  </div>
</template>
```

#### 4. Status Helper Functions

```typescript
function getExtractionStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'success';
    case 'analyzing': return 'info';
    case 'failed': return 'error';
    case 'pending': return 'warning';
    default: return 'grey';
  }
}

function getExtractionStatusText(status: string): string {
  switch (status) {
    case 'completed': return t('contactExtraction.status_completed') || 'Completed';
    case 'analyzing': return t('contactExtraction.status_analyzing') || 'Analyzing';
    case 'failed': return t('contactExtraction.status_failed') || 'Failed';
    case 'pending': return t('contactExtraction.status_pending') || 'Pending';
    default: return status;
  }
}
```

### IPC Communication Pattern

#### API Layer (Frontend)

Create `src/views/api/contact-extraction.ts`:

```typescript
import { ipcRenderer } from 'electron';

export interface ContactExtractionRequest {
  resultIds: number[];
}

export interface ContactExtractionProgress {
  resultId: number;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  data?: {
    email?: string;
    phone?: string;
    address?: string;
    social_links?: string[];
  };
  error?: string;
}

export async function startContactExtraction(request: ContactExtractionRequest): Promise<void> {
  return ipcRenderer.invoke('start-contact-extraction', request);
}

export function onContactExtractionProgress(
  callback: (progress: ContactExtractionProgress) => void
): () => void {
  const handler = (_event: any, progress: ContactExtractionProgress) => callback(progress);
  ipcRenderer.on('contact-extraction-progress', handler);

  // Return cleanup function
  return () => ipcRenderer.removeListener('contact-extraction-progress', handler);
}
```

#### Main Process Handler

Create `src/main-process/communication/contactExtraction.ts`:

```typescript
import { ipcMain } from 'electron';
import { contactExtractionWorker } from '../workers/contactExtractionWorker';

export function registerContactExtractionHandlers(): void {
  ipcMain.handle('start-contact-extraction', async (event, request) => {
    const { resultIds } = request;

    // Send to worker process
    contactExtractionWorker.send({
      type: 'extract-contact',
      resultIds,
      batchId: generateBatchId()
    });

    return { success: true };
  });
}
```

#### Vue Component Integration

```typescript
import { startContactExtraction, onContactExtractionProgress } from '@/views/api/contact-extraction';

const extractingContact = ref(false);

// Handle button click
async function handleGetContactInfo() {
  if (selectedItems.value.length === 0) {
    alert('Please select at least one item');
    return;
  }

  extractingContact.value = true;

  try {
    await startContactExtraction({ resultIds: selectedItems.value });
  } catch (error) {
    console.error('Failed to start contact extraction:', error);
    alert('Failed to start contact extraction');
  }
}

// Listen for progress updates
onMounted(() => {
  const cleanup = onContactExtractionProgress((progress) => {
    const { resultId, status, data, error } = progress;

    // Update serverItems with new data
    const item = serverItems.value.find(i => i.id === resultId);
    if (item) {
      item.extraction_status = status;
      if (data) {
        item.contact_email = data.email;
        item.contact_phone = data.phone;
        item.contact_address = data.address;
      }
      if (error) {
        item.extraction_error = error;
      }
    }

    // Clear loading state when all items complete
    if (status === 'completed' || status === 'failed') {
      extractingContact.value = false;
    }
  });

  onUnmounted(() => {
    cleanup();
  });
});
```

---

## 6. Batch Processing & Concurrency

### Queue System Implementation

Create a job queue to manage concurrent extractions:

```typescript
// src/modules/contact-extraction/ExtractionQueue.ts

interface ExtractionJob {
  resultId: number;
  url: string;
  title: string;
  retryCount: number;
}

class ContactExtractionQueue {
  private concurrency: number;
  private queue: ExtractionJob[] = [];
  private active = 0;
  private maxRetries = 3;

  constructor(concurrency: number = 3) {
    this.concurrency = concurrency;
  }

  async add(job: ExtractionJob): Promise<void> {
    this.queue.push(job);
    this.process();
  }

  async addBatch(jobs: ExtractionJob[]): Promise<void> {
    this.queue.push(...jobs);
    this.process();
  }

  private async process(): Promise<void> {
    while (this.queue.length > 0 && this.active < this.concurrency) {
      const job = this.queue.shift();
      if (!job) break;

      this.active++;

      this.processJob(job)
        .catch(error => {
          console.error(`Job failed for result ${job.resultId}:`, error);

          // Retry logic
          if (job.retryCount < this.maxRetries) {
            job.retryCount++;
            setTimeout(() => {
              this.queue.push(job);
              this.process();
            }, Math.pow(2, job.retryCount) * 1000); // Exponential backoff
          }
        })
        .finally(() => {
          this.active--;
          this.process();
        });
    }
  }

  private async processJob(job: ExtractionJob): Promise<void> {
    // Update status to analyzing
    await updateExtractionStatus(job.resultId, 'analyzing');

    // Perform extraction
    const result = await extractContactInfo(job.url);

    if (result.success) {
      // Save to database
      await saveContactInfo(job.resultId, result.data);
      await updateExtractionStatus(job.resultId, 'completed');

      // Send progress update
      sendProgressUpdate({
        resultId: job.resultId,
        status: 'completed',
        data: result.data
      });
    } else {
      // Mark as failed
      await updateExtractionStatus(job.resultId, 'failed', result.error);
      sendProgressUpdate({
        resultId: job.resultId,
        status: 'failed',
        error: result.error
      });
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.active;
  }
}

export const extractionQueue = new ContactExtractionQueue(3); // Max 3 concurrent
```

### Resource Management

```typescript
// Browser pool management

class BrowserPool {
  private maxInstances: number;
  private browsers: Browser[] = [];
  private available: Browser[] = [];

  constructor(maxInstances: number = 3) {
    this.maxInstances = maxInstances;
  }

  async acquire(): Promise<Browser> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }

    if (this.browsers.length < this.maxInstances) {
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check'
        ]
      });
      this.browsers.push(browser);
      return browser;
    }

    // Wait for available browser
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.available.length > 0) {
          clearInterval(checkInterval);
          resolve(this.available.pop()!);
        }
      }, 100);
    });
  }

  release(browser: Browser): void {
    this.available.push(browser);
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.browsers.map(b => b.close()));
    this.browsers = [];
    this.available = [];
  }
}

export const browserPool = new BrowserPool(3);
```

---

## 7. Error Handling & Edge Cases

### Critical Edge Cases

#### 1. Invalid/Unreachable URLs

```typescript
async function validateUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Before extraction
if (!await validateUrl(url)) {
  await updateExtractionStatus(resultId, 'failed', 'Invalid URL');
  return;
}
```

#### 2. Bot Detection/CAPTCHAs

```typescript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

// Rotate user agents
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...',
  // Add more variations
];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox']
});

const page = await browser.newPage();
await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
```

#### 3. AI Service Unavailable

```typescript
async function callAIServiceWithRetry(content: string, maxRetries = 3): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(AI_SERVICE_URL, {
        method: 'POST',
        body: JSON.stringify({ content }),
        timeout: 30000
      });

      if (!response.ok) {
        throw new Error(`AI service returned ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`AI service call failed (attempt ${i + 1}/${maxRetries}):`, error);

      if (i === maxRetries - 1) {
        throw new Error('AI service temporarily unavailable');
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}
```

#### 4. Non-English Content

```typescript
async function detectPageLanguage(page: Page): Promise<string> {
  const lang = await page.evaluate(() => {
    return document.documentElement.lang || 'en';
  });
  return lang;
}

// Send language hint to AI
const language = await detectPageLanguage(page);
const aiResponse = await callAIService({
  content: pageText,
  language, // Pass detected language
  entity: derivedEntity
});
```

#### 5. Multiple Businesses on Page

```typescript
// AI should return array or indicate ambiguity
interface AIResponse {
  contacts: {
    entity: string;
    email?: string;
    phone?: string;
    address?: string;
  }[];
  ambiguous: boolean;
}

// Handle in UI
if (aiResponse.ambiguous && aiResponse.contacts.length > 1) {
  // Show user a dialog to select the correct business
  const selected = await showBusinessSelectionDialog(aiResponse.contacts);
  // Save selected contact
}
```

#### 6. Slow/Heavy Pages

```typescript
async function navigateWithTimeout(page: Page, url: string, timeout = 30000): Promise<boolean> {
  try {
    await Promise.race([
      page.goto(url, { waitUntil: 'networkidle0' }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Navigation timeout')), timeout)
      )
    ]);
    return true;
  } catch (error) {
    console.error('Navigation timeout:', url);
    return false;
  }
}
```

#### 7. Already Extracted

```typescript
async function checkIfExtracted(resultId: number): Promise<boolean> {
  const contactInfo = await dataSource.getRepository(ContactInfo).findOne({
    where: { resultId }
  });

  return contactInfo && contactInfo.extractionStatus === 'completed';
}

// Before extraction
if (await checkIfExtracted(resultId)) {
  // Prompt user
  const userChoice = await showAlreadyExtractedDialog();
  if (!userChoice.reextract) {
    return; // Skip
  }
  // Delete old contact info and proceed
  await dataSource.getRepository(ContactInfo).delete({ resultId });
}
```

### Error Recovery Strategy

```typescript
async function extractWithErrorHandling(resultId: number, url: string): Promise<void> {
  let browser: Browser | null = null;

  try {
    // Validate URL
    if (!isValidUrl(url)) {
      throw new Error('Invalid URL format');
    }

    // Acquire browser
    browser = await browserPool.acquire();

    // Navigate with timeout
    const page = await browser.newPage();
    const navigated = await navigateWithTimeout(page, url, 30000);

    if (!navigated) {
      throw new Error('Page load timeout');
    }

    // Extract content
    const content = await extractPageContent(page);
    await page.close();

    // Call AI service
    const aiResult = await callAIServiceWithRetry(content);

    // Save to database
    await saveContactInfo(resultId, aiResult);

  } catch (error) {
    console.error(`Extraction failed for ${resultId}:`, error);

    // Save error to database
    await updateExtractionStatus(
      resultId,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );

  } finally {
    // Always release browser
    if (browser) {
      await browserPool.release(browser);
    }
  }
}
```

---

## 8. Testing Strategy

### Unit Tests (Vitest/Mocha)

**Contact Page Discovery Logic**:
```typescript
// test/modules/contact-extraction/discovery.test.ts

describe('Contact Page Discovery', () => {
  it('should score links correctly', () => {
    const links = [
      { href: '/contact', text: 'Contact Us' },
      { href: '/about', text: 'About Us' },
      { href: '/support', text: 'Help Center' }
    ];

    const bestLink = findBestContactLink(links);
    expect(bestLink.href).toBe('/contact');
  });

  it('should find direct email in mailto links', () => {
    const links = [
      { href: 'mailto:info@company.com', text: 'Email us' }
    ];

    const email = extractEmailFromLink(links[0]);
    expect(email).toBe('info@company.com');
  });
});
```

**AI Response Parsing**:
```typescript
describe('AI Response Parser', () => {
  it('should parse valid contact info', () => {
    const response = {
      email: 'test@example.com',
      phone: '+1-555-1234',
      address: '123 Main St'
    };

    const parsed = parseAIResponse(response);
    expect(parsed.email).toBe('test@example.com');
    expect(parsed.phone).toBe('+1-555-1234');
  });

  it('should handle missing fields', () => {
    const response = {
      email: 'test@example.com'
      // phone and address missing
    };

    const parsed = parseAIResponse(response);
    expect(parsed.email).toBe('test@example.com');
    expect(parsed.phone).toBeNull();
  });
});
```

### Integration Tests

**Full Extraction Flow**:
```typescript
// test/vitest/taskCode/contact-extraction.integration.test.ts

describe('Contact Extraction Integration', () => {
  it('should extract contact info from test website', async () => {
    const testUrl = 'http://localhost:8080/test-contact-page.html';

    const result = await extractContactInfo(testUrl);

    expect(result.success).toBe(true);
    expect(result.data.email).toBeTruthy();
    expect(result.extractionStatus).toBe('completed');
  });

  it('should handle batch extraction', async () => {
    const urls = [
      'http://localhost:8080/test1.html',
      'http://localhost:8080/test2.html',
      'http://localhost:8080/test3.html'
    ];

    const results = await extractBatch(urls);

    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
  });
});
```

### End-to-End Tests

**Real Website Extraction**:
```typescript
// Use a test website you control
describe('E2E Contact Extraction', () => {
  it('should extract from real website', async () => {
    const realUrl = 'https://your-test-site.com';

    const result = await extractContactInfo(realUrl);

    expect(result.success).toBe(true);
    // Verify database records
    const dbRecord = await getRepository(ContactInfo).findOne({
      where: { resultId: result.id }
    });
    expect(dbRecord).toBeTruthy();
    expect(dbRecord.extractionStatus).toBe('completed');
  });
});
```

### Performance Tests

```typescript
describe('Performance Tests', () => {
  it('should complete extraction within 30 seconds', async () => {
    const start = Date.now();
    await extractContactInfo('https://test-site.com');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(30000);
  });

  it('should handle 50 concurrent extractions', async () => {
    const urls = Array(50).fill('https://test-site.com');
    const start = Date.now();

    const results = await Promise.all(
      urls.map(url => extractContactInfo(url))
    );

    const duration = Date.now() - start;
    expect(results.every(r => r.success)).toBe(true);
    expect(duration).toBeLessThan(300000); // 5 minutes for all
  });

  it('should not leak memory', async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < 10; i++) {
      await extractContactInfo('https://test-site.com');
    }

    global.gc(); // Force garbage collection
    const finalMemory = process.memoryUsage().heapUsed;

    const memoryGrowth = (finalMemory - initialMemory) / initialMemory;
    expect(memoryGrowth).toBeLessThan(0.5); // Less than 50% growth
  });
});
```

---

## 9. Specific Technology Recommendations

### Puppeteer Configuration

```typescript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

export async function createBrowser() {
  return await puppeteer.launch({
    headless: 'new', // New headless mode (faster)
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Reduce memory usage
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled', // Avoid detection
      '--disable-features=IsolateOrigins,site-per-process'
    ],
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });
}
```

### AI Service Interface

Assuming OpenAI-based remote service (based on your codebase):

```typescript
interface AIContactExtractionRequest {
  url: string;
  entity: string;
  content: string;
  language?: string;
  fields: ('email' | 'phone' | 'address' | 'social_links')[];
  temperature?: number;
}

interface AIContactExtractionResponse {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  social_links?: string[] | null;
  confidence?: number;
}

export async function callAIContactExtraction(
  request: AIContactExtractionRequest
): Promise<AIContactExtractionResponse> {
  const response = await fetch(`${AI_SERVICE_BASE_URL}/extract-contact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_SERVICE_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract contact information for ${request.entity} from the following website content.`
        },
        {
          role: 'user',
          content: request.content
        }
      ],
      response_format: { type: 'json_object' },
      temperature: request.temperature || 0.7
    }),
    timeout: 30000
  });

  if (!response.ok) {
    throw new Error(`AI service error: ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}
```

### Progress Tracking via WebSocket

You already have WebSocket in your codebase. Use it for real-time updates:

```typescript
// Worker sends progress
export function sendExtractionProgress(progress: {
  batchId: string;
  resultId: number;
  status: string;
  data?: any;
  error?: string;
}) {
  ws.send(JSON.stringify({
    type: 'extraction-progress',
    ...progress
  }));
}

// Main process receives and forwards
ws.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'extraction-progress') {
    mainWindow?.webContents.send('contact-extraction-progress', message);
  }
});
```

### TypeORM Repository Pattern

```typescript
// src/repository/ContactInfoRepository.ts

import { EntityRepository, Repository } from 'typeorm';
import { ContactInfo } from '../entity/ContactInfo';

@EntityRepository(ContactInfo)
export class ContactInfoRepository extends Repository<ContactInfo> {
  async findByResultId(resultId: number): Promise<ContactInfo | null> {
    return this.findOne({ where: { resultId } });
  }

  async updateStatus(resultId: number, status: string, error?: string): Promise<void> {
    await this.update(
      { resultId },
      {
        extractionStatus: status,
        extractionError: error || null,
        ...(status === 'completed' && { extractionDate: new Date() })
      }
    );
  }

  async findByStatus(status: string): Promise<ContactInfo[]> {
    return this.find({ where: { extractionStatus: status } });
  }

  async findPendingExtractions(limit: number = 10): Promise<ContactInfo[]> {
    return this.find({
      where: { extractionStatus: 'pending' },
      take: limit,
      order: { id: 'ASC' }
    });
  }
}
```

---

## 10. Implementation Order (MVP Approach)

### Phase 1: Core Extraction (P1 - 2-3 days)

**Goal**: Extract contact info from a single URL and save to database

**Tasks**:
1. ✅ Create `ContactInfo` entity and migration
2. ✅ Create `contact-extraction-worker.ts` process
3. ✅ Implement basic Puppeteer navigation
4. ✅ Connect to remote AI service
5. ✅ Save extracted data to database
6. ✅ Add "Get Contact Info" button to UI
7. ✅ Implement IPC communication (main ↔ worker ↔ renderer)
8. ✅ Test single-item extraction

**Acceptance**: User can select one search result, click button, and see extracted contact info in the table.

### Phase 2: Intelligent Discovery (P2 - 3-4 days)

**Goal**: Automatically find contact pages on diverse websites

**Tasks**:
1. ✅ Implement contact page discovery algorithm (multi-stage)
2. ✅ Add heuristic link scoring
3. ✅ Add fallback standard routes
4. ✅ Test on 20+ diverse website structures
5. ✅ Add retry logic for failed attempts
6. ✅ Log discovery method to database

**Acceptance**: System successfully finds and extracts contact info from 90% of test websites.

### Phase 3: Batch Processing (P2 - 2-3 days)

**Goal**: Process multiple URLs concurrently

**Tasks**:
1. ✅ Implement extraction queue with concurrency limits
2. ✅ Create browser pool management
3. ✅ Add progress tracking across batch
4. ✅ Test with 10+ simultaneous extractions
5. ✅ Add cancel/pause functionality

**Acceptance**: User can select 10 items, extract all concurrently, and see real-time progress.

### Phase 4: Real-Time Updates (P3 - 2-3 days)

**Goal**: Polish user experience with live updates

**Tasks**:
1. ✅ Implement WebSocket/IPC progress events
2. ✅ Auto-refresh table on progress updates
3. ✅ Add progress indicator widget
4. ✅ Show status chips for each item
5. ✅ Add extraction metadata to database

**Acceptance**: User sees status changes in real-time without manual refresh.

### Phase 5: Error Handling & Edge Cases (P3 - 2-3 days)

**Goal**: Robust error recovery

**Tasks**:
1. ✅ Handle invalid/unreachable URLs
2. ✅ Add bot detection evasion
3. ✅ Handle AI service failures
4. ✅ Add timeout handling
5. ✅ Implement exponential backoff retries
6. ✅ Log all errors to database
7. ✅ Show user-friendly error messages

**Acceptance**: System gracefully handles all edge cases with appropriate error messages.

### Phase 6: Performance Optimization (P3 - 2-3 days)

**Goal**: Optimize for speed and resource usage

**Tasks**:
1. ✅ Profile memory usage
2. ✅ Implement proper browser cleanup
3. ✅ Optimize page load timeouts
4. ✅ Add connection pooling for AI service
5. ✅ Implement caching for repeated URLs
6. ✅ Performance testing (50+ concurrent extractions)

**Acceptance**: System can process 50 items in under 5 minutes without memory leaks.

### Phase 7: Testing & Documentation (1-2 days)

**Tasks**:
1. ✅ Write unit tests for discovery logic
2. ✅ Write integration tests for full flow
3. ✅ Write E2E tests with real websites
4. ✅ Document API and architecture
5. ✅ Create user guide

**Acceptance**: All tests pass, comprehensive documentation available.

---

## Summary of Key Recommendations

| Aspect | Recommendation | Rationale |
|--------|---------------|-----------|
| **Process Architecture** | Separate worker process via `child_process` | Isolation, existing pattern in codebase |
| **AI Communication** | WebSocket or REST API | Real-time updates, you already have WebSocket |
| **Contact Discovery** | Multi-stage: Direct → Heuristic → Fallback → AI | Covers diverse website structures |
| **Database Schema** | **Independent `ContactInfo` table** | Clean separation, better normalization, easier to maintain |
| **Concurrency** | Limit to 3-5 Puppeteer instances | Resource management, prevent crashes |
| **UI Pattern** | Follow existing "AI Analyze" button pattern | Consistency, proven to work |
| **Error Handling** | Retry with exponential backoff, graceful degradation | Better UX, handles transient failures |
| **Testing** | Unit → Integration → E2E → Performance | Comprehensive coverage |
| **Implementation Order** | Phase 1 → 7 (MVP → Polish) | Incremental value delivery |

---

## Next Steps

1. **Review and approve** this technical advice
2. **Create database migration** for `ContactInfo` table
3. **Set up worker process** structure
4. **Implement Phase 1** (Core Extraction)
5. **Test with real websites** and iterate

Would you like me to elaborate on any specific aspect, such as:
- Detailed worker process implementation?
- Contact discovery algorithm refinement?
- Database migration script?
- Frontend component integration?
