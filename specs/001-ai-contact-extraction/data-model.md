# Data Model: AI-Powered Contact Information Extraction

**Feature**: 001-ai-contact-extraction
**Created**: 2025-02-06
**Purpose**: Entity definitions, relationships, validation rules, and database schema

## Table of Contents

1. [Entity Relationship Diagram](#entity-relationship-diagram)
2. [ContactInfo Entity](#contactinfo-entity)
3. [SearchResult Entity Modifications](#searchresult-entity-modifications)
4. [Database Migration](#database-migration)
5. [Repository Pattern](#repository-pattern)
6. [TypeScript Type Definitions](#typescript-type-definitions)
7. [State Transitions](#state-transitions)
8. [Validation Rules](#validation-rules)
9. [Query Patterns](#query-patterns)

---

## Entity Relationship Diagram

```
┌─────────────────────┐         1:1         ┌─────────────────────┐
│  SearchResult       │ ────────────────── │  ContactInfo        │
├─────────────────────┤                     ├─────────────────────┤
│ id (PK)             │                     │ id (PK)             │
│ task_id             │                     │ result_id (FK)      │
│ keyword_id          │                     │ email               │
│ title               │                     │ phone               │
│ link                │                     │ address             │
│ snippet             │                     │ social_links        │
│ domain              │                     │ extraction_status   │
│ record_time         │                     │ extraction_error    │
│ ai_industry         │                     │ extraction_date     │
│ ai_match_score      │                     │ extraction_metadata │
│ ai_analysis_status  │                     └─────────────────────┘
│ ai_reasoning        │
│ ai_client_business  │
│ ai_analysis_time    │
└─────────────────────┘
```

**Relationship**: One-to-One (1:1)
- Each `SearchResult` can have at most one `ContactInfo`
- Each `ContactInfo` belongs to exactly one `SearchResult`
- Cascade delete: When SearchResult is deleted, ContactInfo is also deleted

---

## ContactInfo Entity

### Entity Definition

**File**: `src/entity/ContactInfo.entity.ts`

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SearchResultEntity } from './SearchResult.entity';

@Entity('contact_info')
@Index(['resultId']) // For faster lookups
export class ContactInfoEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'result_id' })
  resultId: number; // Foreign key to SearchResult

  @OneToOne(() => SearchResultEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'result_id' })
  searchResult: SearchResultEntity;

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
    discoveryMethod?: string; // 'stage1_homepage', 'stage2_heuristic', 'stage3_fallback', 'stage4_ai'
    aiServiceVersion?: string;
    retryCount?: number;
    confidence?: number; // 0-1
    extractionDuration?: number; // milliseconds
  } | null;
}
```

### Field Descriptions

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | integer | No | Primary key (auto-increment) |
| `result_id` | integer | No | Foreign key to `search_result.id` |
| `email` | text | Yes | Primary email address extracted |
| `phone` | text | Yes | Primary phone number extracted |
| `address` | text | Yes | Physical address extracted |
| `social_links` | json | Yes | Array of social media URLs (Twitter, LinkedIn, etc.) |
| `extraction_status` | enum | No | One of: `pending`, `analyzing`, `completed`, `failed` |
| `extraction_error` | text | Yes | Error message if extraction failed |
| `extraction_date` | timestamp | No | Timestamp when extraction completed |
| `extraction_metadata` | json | Yes | Additional extraction metadata (method, confidence, etc.) |
| `created_at` | timestamp | No | Record creation timestamp (inherited from AuditableEntity) |
| `updated_at` | timestamp | No | Record update timestamp (inherited from AuditableEntity) |

### Extraction Status Values

| Status | Description | Typical Duration |
|--------|-------------|------------------|
| `pending` | Extraction queued but not started | 0-60 seconds |
| `analyzing` | Currently extracting (navigating pages, calling AI) | 5-30 seconds |
| `completed` | Successfully extracted contact info | N/A (final state) |
| `failed` | Extraction failed (error message in `extraction_error`) | N/A (final state) |

### Extraction Metadata Schema

```typescript
interface ExtractionMetadata {
  discoveredPageUrl?: string;        // URL where contact info was found
  discoveryMethod?: string;          // Which stage succeeded: 'stage1_homepage', 'stage2_heuristic', 'stage3_fallback', 'stage4_ai'
  aiServiceVersion?: string;         // e.g., 'gpt-4o-mini-2024-07-18'
  retryCount?: number;               // Number of retry attempts (0-3)
  confidence?: number;               // Confidence score 0-1 (AI extraction only)
  extractionDuration?: number;       // Total extraction time in milliseconds
}
```

---

## SearchResult Entity Modifications

### Existing Entity

**File**: `src/entity/SearchResult.entity.ts`

```typescript
import { Entity, Column, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("search_result")
export class SearchResultEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column("integer", { default: 0 })
    task_id: number;

    @Column("integer", { default: 0 })
    keyword_id: number;

    @Column("text", { nullable: true })
    title: string;

    @Column("text", { nullable: true })
    link: string;

    @Column("text", { nullable: true })
    snippet: string;

    @Column("text", { nullable: true })
    domain: string;

    @Column("text", { nullable: true })
    record_time: string;

    @Column("text", { nullable: true })
    ai_industry: string;

    @Column("integer", { nullable: true })
    ai_match_score: number;

    @Column("text", { nullable: true })
    ai_reasoning: string;

    @Column("text", { nullable: true })
    ai_client_business: string;

    @Column("text", { nullable: true })
    ai_analysis_time: string;

    @Column("text", { nullable: true, default: null })
    ai_analysis_status: string; // 'pending', 'analyzing', 'completed', 'failed'
}
```

### Proposed Addition

Add a OneToOne relationship to ContactInfo:

```typescript
import { Entity, Column, PrimaryGeneratedColumn, OneToOne } from "typeorm";
import { ContactInfoEntity } from "./ContactInfo.entity";

@Entity("search_result")
export class SearchResultEntity extends AuditableEntity {
    // ... existing fields ...

    @OneToOne(() => ContactInfoEntity, contactInfo => contactInfo.searchResult, {
        nullable: true,
        eager: false, // Load on demand to avoid unnecessary queries
        cascade: false // Don't cascade operations (handled manually)
    })
    contactInfo: ContactInfoEntity | null;
}
```

**Note**: No migration needed for SearchResult entity (only relationship definition)

---

## Database Migration

### Migration Script

**File**: `src/migrations/CreateContactInfoTable.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateContactInfoTable1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create contact_info table
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
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
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
        referencedTableName: 'search_result',
        onDelete: 'CASCADE', // Delete contact info when search result is deleted
      })
    );

    // Create unique index for faster lookups
    await queryRunner.createIndex(
      'contact_info',
      new TableIndex({
        name: 'IDX_contact_info_result_id',
        columnNames: ['result_id'],
        isUnique: true,
      })
    );

    // Create composite index for status queries
    await queryRunner.createIndex(
      'contact_info',
      new TableIndex({
        name: 'IDX_contact_info_status_date',
        columnNames: ['extraction_status', 'extraction_date'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraint (implicit with table drop)
    await queryRunner.dropTable('contact_info');
  }
}
```

### Running Migration

```bash
# Run migration
yarn init

# Or manually
ts-node src/runcli.ts -a sqlinit
```

### SQL Output (SQLite)

```sql
CREATE TABLE contact_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  social_links JSON,
  extraction_status VARCHAR CHECK(extraction_status IN ('pending', 'analyzing', 'completed', 'failed')) DEFAULT 'pending',
  extraction_error TEXT,
  extraction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  extraction_metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (result_id) REFERENCES search_result(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IDX_contact_info_result_id ON contact_info(result_id);
CREATE INDEX IDX_contact_info_status_date ON contact_info(extraction_status, extraction_date);
```

---

## Repository Pattern

### Custom Repository

**File**: `src/model/ContactInfo.model.ts` (or `src/repository/ContactInfoRepository.ts`)

```typescript
import { EntityRepository, Repository } from 'typeorm';
import { ContactInfoEntity } from '../entity/ContactInfo.entity';

@EntityRepository(ContactInfoEntity)
export class ContactInfoRepository extends Repository<ContactInfoEntity> {

  /**
   * Find contact info by result ID
   */
  async findByResultId(resultId: number): Promise<ContactInfoEntity | null> {
    return this.findOne({ where: { resultId } });
  }

  /**
   * Find multiple contact info by result IDs
   */
  async findByResultIds(resultIds: number[]): Promise<ContactInfoEntity[]> {
    return this.createQueryBuilder('contactInfo')
      .where('contactInfo.resultId IN (:...resultIds)', { resultIds })
      .getMany();
  }

  /**
   * Update extraction status
   */
  async updateStatus(
    resultId: number,
    status: 'pending' | 'analyzing' | 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    await this.update(
      { resultId },
      {
        extractionStatus: status,
        extractionError: error || null,
        ...(status === 'completed' && { extractionDate: new Date() })
      }
    );
  }

  /**
   * Find by extraction status
   */
  async findByStatus(status: string): Promise<ContactInfoEntity[]> {
    return this.find({ where: { extractionStatus: status } });
  }

  /**
   * Find pending extractions (for queue processing)
   */
  async findPendingExtractions(limit: number = 10): Promise<ContactInfoEntity[]> {
    return this.find({
      where: { extractionStatus: 'pending' },
      take: limit,
      order: { id: 'ASC' }
    });
  }

  /**
   * Find failed extractions (for retry)
   */
  async findFailedExtractions(limit: number = 10): Promise<ContactInfoEntity[]> {
    return this.find({
      where: { extractionStatus: 'failed' },
      take: limit,
      order: { id: 'ASC' }
    });
  }

  /**
   * Save or update contact info (upsert)
   */
  async saveOrUpdate(resultId: number, data: Partial<ContactInfoEntity>): Promise<ContactInfoEntity> {
    const existing = await this.findByResultId(resultId);

    if (existing) {
      await this.update({ resultId }, data);
      return this.findByResultId(resultId) as Promise<ContactInfoEntity>;
    } else {
      const newContactInfo = this.create({ resultId, ...data });
      return this.save(newContactInfo);
    }
  }

  /**
   * Delete contact info by result ID
   */
  async deleteByResultId(resultId: number): Promise<void> {
    await this.delete({ resultId });
  }

  /**
   * Get extraction statistics
   */
  async getStatistics(): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    analyzing: number;
  }> {
    const [
      total,
      completed,
      failed,
      pending,
      analyzing
    ] = await Promise.all([
      this.count(),
      this.count({ where: { extractionStatus: 'completed' } }),
      this.count({ where: { extractionStatus: 'failed' } }),
      this.count({ where: { extractionStatus: 'pending' } }),
      this.count({ where: { extractionStatus: 'analyzing' } })
    ]);

    return { total, completed, failed, pending, analyzing };
  }
}
```

---

## TypeScript Type Definitions

**File**: `src/entityTypes/contactExtractionTypes.ts`

```typescript
/**
 * Contact information extracted from a website
 */
export interface ContactInfo {
  emails?: string[];           // All email addresses found
  phones?: string[];           // All phone numbers found
  address?: string | null;     // Physical address
  socialLinks?: string[] | null; // Social media URLs
  source?: string;             // Where found: 'homepage', 'contact_page', 'ai_extraction'
  confidence?: number;         // 0-1 confidence score
}

/**
 * Extraction result from discovery pipeline
 */
export interface ExtractionResult {
  success: boolean;
  data?: ContactInfo;
  error?: string;
  method?: string; // 'stage1_homepage', 'stage2_heuristic', 'stage3_fallback', 'stage4_ai', 'failed'
}

/**
 * Contact extraction job for queue
 */
export interface ExtractionJob {
  resultId: number;
  url: string;
  title: string;
  retryCount: number;
  priority: number;
}

/**
 * Extraction progress update
 */
export interface ExtractionProgress {
  batchId: string;
  resultId: number;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  data?: ContactInfo;
  error?: string;
  method?: string;
}

/**
 * Contact extraction request (IPC)
 */
export interface ContactExtractionRequest {
  resultIds: number[];
}

/**
 * Contact extraction response (IPC)
 */
export interface ContactExtractionResponse {
  success: boolean;
  batchId?: string;
  message?: string;
}

/**
 * Contact info display (for frontend)
 */
export interface ContactInfoDisplay {
  id: number;
  resultId: number;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  socialLinks?: string[] | null;
  extractionStatus: string;
  extractionError?: string | null;
  extractionDate?: string;
}
```

---

## State Transitions

### Extraction Status Lifecycle

```
┌─────────┐
│ pending │ (Initial state when job queued)
└────┬────┘
     │
     ├─> ┌───────────┐
     │   │ analyzing │ (Extraction in progress)
     │   └─────┬─────┘
     │         │
     │         ├─> ┌───────────┐
     │         │   │ completed │ (Success)
     │         │   └───────────┘
     │         │
     │         └─> ┌───────┐
     │             │ failed │ (Error, retryable)
     │             └───┬───┘
     │                 │
     │                 ├─> ┌───────────┐
     │                 │   │ analyzing │ (Retry 1-3)
     │                 │   └───────────┘
     │                 │
     └─────────────────┘   (After 3 retries, permanent failure)
```

### State Transition Rules

| Current State | Allowed Next States | Trigger |
|---------------|---------------------|---------|
| `pending` | `analyzing` | Job picked up by queue |
| `analyzing` | `completed` | Extraction successful |
| `analyzing` | `failed` | Extraction error + < 3 retries |
| `failed` | `analyzing` | Retry attempt (exponential backoff) |
| `failed` | `failed` | Max retries reached (permanent) |
| `completed` | - | Terminal state (no transitions) |

---

## Validation Rules

### Email Validation

```typescript
function validateEmail(email: string): boolean {
  const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/;
  return emailPattern.test(email);
}
```

### Phone Validation

```typescript
function validatePhone(phone: string): boolean {
  // Accept various formats: +1-555-1234, (555) 123-4567, 555.123.4567
  const phonePattern = /^\+?[\d\s\-\(\)\.]{10,}$/;
  return phonePattern.test(phone);
}
```

### URL Validation

```typescript
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
```

### Entity Validation (TypeORM)

```typescript
import { validate } from 'class-validator';

export class ContactInfoEntity extends AuditableEntity {
  // ... fields ...

  @ValidateIf(o => o.email !== null)
  @IsEmail({}, { message: 'Invalid email format' })
  email: string | null;

  @ValidateIf(o => o.phone !== null)
  @Matches(/^\+?[\d\s\-\(\)\.]{10,}$/, { message: 'Invalid phone format' })
  phone: string | null;
}
```

---

## Query Patterns

### Common Queries

**1. Get search results with contact info**:
```typescript
const results = await dataSource.getRepository(SearchResultEntity)
  .createQueryBuilder('searchResult')
  .leftJoinAndSelect('searchResult.contactInfo', 'contactInfo')
  .where('searchResult.id IN (:...ids)', { ids: [1, 2, 3] })
  .getMany();
```

**2. Get only completed extractions**:
```typescript
const completed = await dataSource.getRepository(ContactInfoEntity)
  .find({ where: { extractionStatus: 'completed' } });
```

**3. Get failed extractions for retry**:
```typescript
const failed = await dataSource.getRepository(ContactInfoEntity)
  .find({
    where: { extractionStatus: 'failed' },
    order: { extractionDate: 'DESC' },
    take: 10
  });
```

**4. Update extraction status**:
```typescript
await dataSource.getRepository(ContactInfoEntity)
  .update({ resultId }, { extractionStatus: 'analyzing' });
```

**5. Save new contact info**:
```typescript
const contactInfo = new ContactInfoEntity();
contactInfo.resultId = resultId;
contactInfo.email = 'info@example.com';
contactInfo.phone = '+1-555-1234';
contactInfo.extractionStatus = 'completed';

await dataSource.getRepository(ContactInfoEntity).save(contactInfo);
```

**6. Delete contact info (before re-extraction)**:
```typescript
await dataSource.getRepository(ContactInfoEntity)
  .delete({ resultId });
```

**7. Get extraction statistics**:
```typescript
const stats = await dataSource.getRepository(ContactInfoEntity)
  .createQueryBuilder('contactInfo')
  .select('contactInfo.extractionStatus', 'status')
  .addSelect('COUNT(*)', 'count')
  .groupBy('contactInfo.extractionStatus')
  .getRawMany();
// Result: [{ status: 'completed', count: 45 }, { status: 'failed', count: 5 }]
```

---

## Summary

| Aspect | Design Decision | Rationale |
|--------|----------------|-----------|
| **Entity** | Independent ContactInfo table | Data normalization, clean re-extraction workflow |
| **Relationship** | 1:1 with SearchResult | Each result has at most one contact info record |
| **Delete Cascade** | Yes | Contact info deleted when SearchResult deleted |
| **Status Field** | Enum (4 values) | Clear lifecycle management |
| **Metadata** | JSON field | Flexible storage for extraction details |
| **Indexing** | Unique index on result_id | Fast lookups, prevents duplicates |
| **Repository** | Custom repository methods | Encapsulates common query patterns |

---

**Status**: Data model complete | **Next**: API Contracts
