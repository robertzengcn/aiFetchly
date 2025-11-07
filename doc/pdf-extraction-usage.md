# PDF Text Extraction Usage

This document explains how to use the PDF text extraction functionality in the ChunkingService.

## Overview

The ChunkingService now supports PDF text extraction using:
- **pdf-lib**: For splitting PDFs into individual pages
- **pdf2md-ts**: For converting PDF pages to markdown content

## Features

- ✅ Extract text from PDF files
- ✅ Split PDFs into individual pages
- ✅ Convert each page to markdown format
- ✅ Add page separators and page numbers
- ✅ Handle large PDFs with progress logging
- ✅ Error handling for individual pages
- ✅ Graceful fallback for corrupted pages

## Usage

### Basic Usage

```typescript
import { ChunkingService } from '@/service/ChunkingService';
import { SqliteDb } from '@/config/SqliteDb';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';

// Initialize the service
const db = SqliteDb.getInstance('/path/to/database');
const chunkingService = new ChunkingService(db, '/path/to/database');

// Create a document entity
const document = new RAGDocumentEntity();
document.filePath = '/path/to/document.pdf';
document.fileName = 'document.pdf';
document.fileType = 'pdf';

// Extract and chunk the PDF content
const chunks = await chunkingService.chunkDocument(document);
console.log(`Extracted ${chunks.length} chunks from PDF`);
```

### Advanced Usage with Custom Options

```typescript
// Chunk with custom options
const chunks = await chunkingService.chunkDocument(document, {
    chunkSize: 1000,        // Maximum tokens per chunk
    overlapSize: 200,       // Overlap between chunks
    strategy: 'sentence',   // Chunking strategy
    preserveWhitespace: true,
    minChunkSize: 100
});
```

## Output Format

The extracted PDF content includes page separators:

```markdown
--- Page 1 ---

# Document Title

This is the content from page 1 of the PDF.

## Section 1

More content here...

--- Page 2 ---

# Page 2 Title

This is content from page 2...

## Another Section

More content from page 2...
```

## Error Handling

The PDF extraction includes comprehensive error handling:

- **File not found**: Returns null and logs error
- **Empty PDF**: Returns null and logs warning
- **Corrupted pages**: Skips individual pages and continues processing
- **Invalid PDF format**: Returns null and logs error

## Performance Considerations

- **Memory usage**: Each page is processed individually to minimize memory usage
- **Progress logging**: Logs progress every 10 pages for large PDFs
- **Error resilience**: Continues processing even if individual pages fail

## Dependencies

The following packages are required and are imported statically at the top of the file:

```json
{
  "pdf-lib": "^1.17.1",
  "pdf2md-ts": "^1.0.0"
}
```

The imports are handled as:
```typescript
import { PDFDocument } from 'pdf-lib';
import pdf2md from 'pdf2md-ts';
import * as fs from 'fs';
import * as path from 'path';
```

## Testing

Run the PDF extraction tests:

```bash
npm test -- --grep "PDF Extraction"
```

## Troubleshooting

### Common Issues

1. **"PDF file not found"**: Ensure the file path is correct and the file exists
2. **"No content extracted"**: The PDF might be image-based or corrupted
3. **"Failed to process page X"**: Individual page might be corrupted, but processing continues

### Debug Mode

Enable debug logging to see detailed processing information:

```typescript
// The service automatically logs processing progress
// Check console output for detailed information
```

## Future Enhancements

- [ ] Support for password-protected PDFs
- [ ] OCR support for image-based PDFs
- [ ] Batch processing for multiple PDFs
- [ ] Custom page range extraction
- [ ] Metadata extraction (title, author, etc.)
