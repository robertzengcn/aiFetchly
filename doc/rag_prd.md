Product Requirements Document (PRD)
📌 Project Title
Client-Side RAG Engine for Marketing Knowledge in Electron App

🎯 Objective
Enable users to ingest, organize, and query a local knowledge library within the Electron desktop app using Retrieval-Augmented Generation (RAG). The system will leverage existing aiFetchly infrastructure including SQLite database, LLM factory pattern, controller architecture, and Vue/Vuetify components.

🧩 Key Features
1. Knowledge Library
- Use existing SQLite database infrastructure (SqliteDb.ts) for metadata storage
- Extend existing entity pattern for document management
- Reuse existing Vue/Vuetify components for file handling

2. Multi-Model Embedding Support
- Extend existing LlmFactory pattern for embedding model management
- Reuse existing OpenAI integration (OpenaiLlm.ts)
- Leverage existing Ollama integration (OllamaLlm.ts) 
- Add HuggingFace support following existing LLM interface pattern
- Use existing model registry pattern from TranslateToolEnum

3. Local Vector Search
- Use faiss-node for fast, offline similarity search
- Store FAISS indexes in existing file system structure
- Leverage existing database entities for metadata lookup

4. RAG Query Engine
- Extend existing LLM factory for response generation
- Reuse existing streaming patterns from email marketing
- Leverage existing IPC communication architecture
- Use existing Vue component patterns for chat interface

5. Electron Integration
- Follow existing controller pattern (RAGController.ts)
- Reuse existing IPC handlers from main-process/communication
- Extend existing Vue/Vuetify component library
- Leverage existing drag-and-drop patterns from file uploads

6. Privacy & Offline Capability
- All embeddings stored locally using existing file management
- Leverage existing SQLite database for metadata
- Use existing encryption patterns from user settings
- Follow existing offline-first architecture

🏗️ Technical Architecture
```
[Electron App (Vue + Vuetify)] ← Existing
     ⇓ IPC Communication ← Existing
[RAGController] ← New (following existing controller pattern)
     ⇓
[RAGModule] ← New (following existing module pattern)
     ⇓
[EmbeddingService] ← New (extending LlmFactory pattern)
     ⇓
[VectorStore] ← New (using existing file management)
     ⇓
[SQLite Database] ← Existing (SqliteDb.ts)
```

Tech Stack
Layer	Technology	Status
Frontend	Electron + Vue + Vuetify	✅ Existing
Database	SQLite (better-sqlite3)	✅ Existing
LLM Integration	OpenAI, Ollama, DeepSeek	✅ Existing
File Management	Existing file handling patterns	✅ Existing
IPC Communication	Existing IPC handlers	✅ Existing
Vector Search	faiss-node	🆕 New
Embedding Models	HuggingFace transformers.js	🆕 New
RAG Engine	TypeScript + existing LLM factory	🆕 New

API Design (Internal) - Following Existing Patterns
Function	Description	Implementation Pattern
addDocument(doc)	Chunk, embed, and store document	RAGController → RAGModule → DocumentService
search(query)	Embed query, retrieve top-k chunks	RAGController → VectorSearchService
generateAnswer()	Use LLM to generate response	Extend LlmFactory → existing LLM services
listModels()	Return available embedding models	Extend existing model registry
switchModel(id)	Change active embedding model	Follow existing model switching pattern

## Implementation Strategy - Leveraging Existing Infrastructure

### 1. Database Integration
**Leverage Existing:** `src/config/SqliteDb.ts` and entity pattern
- **New Entity:** `RAGDocumentEntity` extending `AuditableEntity`
- **New Entity:** `RAGChunkEntity` for document chunks
- **New Entity:** `RAGModelEntity` for embedding model metadata
- **Integration:** Add to existing entities array in `SqliteDb.ts`

### 2. Controller Architecture
**Follow Existing Pattern:** `src/controller/YellowPagesController.ts`
- **New Controller:** `RAGController.ts` 
- **IPC Integration:** Use existing `main-process/communication` handlers
- **Module Dependencies:** RAGModule, DocumentService, VectorSearchService

### 3. LLM Integration
**Extend Existing:** `src/modules/llm/LlmFactory.ts` and `LlmImpl` interface
- **New Interface:** `EmbeddingImpl` following `LlmImpl` pattern
- **New Services:** 
  - `OpenAIEmbeddingService` (extend `OpenaiLlm.ts`)
  - `HuggingFaceEmbeddingService` (new, local transformers.js)
  - `OllamaEmbeddingService` (extend `OllamaLlm.ts`)
- **Factory Pattern:** `EmbeddingFactory` following `LlmFactory` pattern

### 4. File Management
**Reuse Existing:** File handling patterns from YellowPages and email extraction
- **Document Storage:** Use existing file system structure
- **Metadata Storage:** Leverage SQLite database
- **File Processing:** Extend existing document parsing utilities

### 5. Frontend Components
**Extend Existing:** Vue/Vuetify component library
- **Knowledge Library Page:** New dedicated page for managing documents and queries
- **File Upload:** Reuse existing drag-and-drop patterns
- **Data Tables:** Extend existing table components from search results
- **Chat Interface:** Create new component following existing UI patterns
- **Model Selection:** Extend existing dropdown components
- **Document Management:** Create components for document listing, editing, and deletion
- **Search Interface:** Create search input with filters and results display

### 6. Process Management
**Follow Existing:** Child process patterns from YellowPages
- **RAG Processing:** Use existing `childprocess` directory structure
- **Background Tasks:** Leverage existing task management system
- **Progress Tracking:** Reuse existing progress monitoring patterns

### 7. Configuration Management
**Leverage Existing:** `src/config/` patterns
- **Model Configuration:** Extend existing LLM configuration
- **Database Settings:** Use existing SQLite configuration
- **File Paths:** Follow existing path management patterns

## Dependencies on Existing Systems

### Required Existing Components
- ✅ SQLite database infrastructure (`SqliteDb.ts`)
- ✅ LLM factory and service patterns
- ✅ Controller architecture and IPC handlers
- ✅ Vue/Vuetify component library
- ✅ File management and storage patterns
- ✅ Task management and process handling
- ✅ Configuration management system

### New Components Required
- 🆕 FAISS vector store integration
- 🆕 Document parsing and chunking services
- 🆕 Embedding model implementations
- 🆕 RAG query engine
- 🆕 Vector search service
- 🆕 Knowledge Library page and navigation
- 🆕 Document management components
- 🆕 Search interface components
- 🆕 Chat interface components
- 🆕 Settings configuration components

## User Interface Design

### Knowledge Library Page
**Location:** New dedicated page in the Electron app navigation
**Purpose:** Central hub for managing documents, performing queries, and configuring RAG settings

#### Page Layout
```
┌─────────────────────────────────────────────────────────────┐
│ Knowledge Library                                    [⚙️]   │
├─────────────────────────────────────────────────────────────┤
│ [📁 Documents] [🔍 Search] [💬 Chat] [⚙️ Settings]         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Main Content Area (Tab-based)                             │
│                                                             │
│  ┌─ Documents Tab ─────────────────────────────────────┐   │
│  │ [+ Add Document] [📊 Stats] [🔍 Filter] [📋 List]  │   │
│  │                                                     │   │
│  │ Document List Table:                                │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ Name | Type | Size | Date | Status | Actions    │ │   │
│  │ │ doc1 | PDF  | 2MB  | ...  | ✅     | [👁][🗑]   │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Search Tab ────────────────────────────────────────┐   │
│  │ Query: [________________] [🔍 Search] [⚙️ Advanced] │   │
│  │                                                     │   │
│  │ Results:                                            │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ 📄 Document Name - Chunk 1 (Score: 0.95)       │ │   │
│  │ │ Preview text...                                 │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Chat Tab ─────────────────────────────────────────┐   │
│  │ 💬 Ask questions about your knowledge library      │   │
│  │                                                     │   │
│  │ Chat Messages:                                     │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ User: What is the main topic of document X?    │ │   │
│  │ │ AI: Based on document X, the main topic is...  │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  │                                                     │   │
│  │ [Type your question...] [Send] [📎 Attach]         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Settings Tab ─────────────────────────────────────┐   │
│  │ Embedding Model: [Dropdown] [🔄 Test]              │   │
│  │ Chunk Size: [Slider] 512 tokens                    │   │
│  │ Search Results: [Number] 5                         │   │
│  │ Storage Path: [Path] /app/data/vectors             │   │
│  │ [💾 Save Settings] [🔄 Reset]                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### Component Specifications

**1. Document Management Tab**
- **File Upload Area:** Drag-and-drop zone with file type validation
- **Document Table:** Sortable columns (name, type, size, date, status)
- **Bulk Actions:** Select multiple documents for batch operations
- **Document Preview:** Click to view document content and metadata
- **Status Indicators:** Processing, Ready, Error states

**2. Search Tab**
- **Search Input:** Auto-complete with recent queries
- **Advanced Filters:** Date range, document type, confidence threshold
- **Results Display:** Paginated list with relevance scores
- **Preview Panel:** Expandable document chunks with context
- **Export Options:** Save search results to file

**3. Chat Tab**
- **Message History:** Scrollable chat interface
- **Input Area:** Multi-line text input with send button
- **Attachment Support:** Attach documents for context
- **Streaming Responses:** Real-time response generation
- **Source Citations:** Clickable references to source documents

**4. Settings Tab**
- **Model Configuration:** Dropdown for embedding models
- **Performance Settings:** Chunk size, batch size, concurrency
- **Storage Management:** View disk usage, clear cache
- **Import/Export:** Backup and restore knowledge library

#### Navigation Integration
- **Main Menu:** Add "Knowledge Library" to primary navigation
- **Breadcrumbs:** Show current page and context
- **Quick Actions:** Floating action button for quick document upload
- **Status Bar:** Show processing status and model info

#### Responsive Design
- **Desktop:** Full-featured layout with sidebars
- **Tablet:** Collapsible sidebars, touch-friendly controls
- **Mobile:** Stacked layout, simplified interface

## Migration Strategy

### Phase 1: Database and Core Services
1. Create RAG entities following existing patterns
2. Extend SQLite configuration
3. Implement basic document storage

### Phase 2: Embedding Integration
1. Extend LlmFactory for embedding models
2. Implement HuggingFace transformers.js integration
3. Create embedding service interfaces

### Phase 3: Vector Search
1. Integrate faiss-node
2. Implement vector storage and retrieval
3. Create search service

### Phase 4: RAG Engine
1. Implement query processing
2. Create response generation
3. Add streaming support

### Phase 5: Frontend Integration
1. Create Knowledge Library page structure
2. Implement tab-based navigation (Documents, Search, Chat, Settings)
3. Build document management components
4. Create search interface with filters
5. Implement chat interface with streaming
6. Add settings configuration panel
7. Integrate with existing UI patterns and IPC communication

### Phase 6: Testing and Optimization
1. Unit tests following existing patterns
2. Integration testing
3. Performance optimization