# AI Chat - Technical Documentation

## Architecture Overview

The AI Chat implementation follows a three-layer architecture:
1. **Remote API Layer** - External AI service
2. **IPC Layer** - Electron main process communication
3. **Frontend Layer** - Vue components and composables

```
┌─────────────────────────────────────────────────────────┐
│                    Remote API Server                     │
│          (Handles AI processing & model access)          │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP/HTTPS
┌────────────────────┴────────────────────────────────────┐
│              src/api/aiChatApi.ts                        │
│                (HttpClient wrapper)                      │
└────────────────────┬────────────────────────────────────┘
                     │ Function calls
┌────────────────────┴────────────────────────────────────┐
│      src/main-process/communication/ai-chat-ipc.ts      │
│              (IPC handlers & history storage)            │
└────────────────────┬────────────────────────────────────┘
                     │ IPC channels
┌────────────────────┴────────────────────────────────────┐
│             src/views/api/aiChat.ts                      │
│              (IPC wrapper functions)                     │
└────────────────────┬────────────────────────────────────┘
                     │ Import & use
┌────────────────────┴────────────────────────────────────┐
│      src/views/components/aiChat/AiChatBox.vue          │
│                  (Vue component)                         │
└──────────────────────────────────────────────────────────┘
```

## File Structure

```
src/
├── api/
│   └── aiChatApi.ts                    # Remote API client
│       - AiChatApi class
│       - sendMessage()
│       - streamMessage()
│       - getAvailableModels()
│       - testConnection()
│
├── main-process/
│   └── communication/
│       ├── ai-chat-ipc.ts             # IPC handlers
│       │   - registerAiChatIpcHandlers()
│       │   - AI_CHAT_MESSAGE handler
│       │   - AI_CHAT_STREAM handler
│       │   - AI_CHAT_HISTORY handler
│       │   - AI_CHAT_CLEAR handler
│       │   - In-memory chat storage
│       │
│       └── index.ts                    # Handler registration
│           - Registers AI chat handlers
│
├── views/
│   ├── api/
│   │   └── aiChat.ts                  # IPC wrapper functions
│   │       - sendChatMessage()
│   │       - streamChatMessage()
│   │       - getChatHistory()
│   │       - clearChatHistory()
│   │
│   ├── components/
│   │   └── aiChat/
│   │       └── AiChatBox.vue          # Main chat UI
│   │           - Message display
│   │           - Input handling
│   │           - History management
│   │           - Theme support
│   │
│   └── layout/
│       └── layout.vue                 # Integration point
│           - Toggle button
│           - Sliding panel
│           - Keyboard shortcuts
│
├── config/
│   └── channellist.ts                 # IPC channel constants
│       - AI_CHAT_MESSAGE
│       - AI_CHAT_STREAM
│       - AI_CHAT_STREAM_CHUNK
│       - AI_CHAT_STREAM_COMPLETE
│       - AI_CHAT_HISTORY
│       - AI_CHAT_CLEAR
│
├── entityTypes/
│   └── commonType.ts                  # TypeScript interfaces
│       - ChatMessage
│       - ChatHistoryResponse
│       - ChatStreamChunk
│       - ChatApiResponse
│
└── preload.ts                         # IPC channel whitelist
    - Added AI chat channels to send/receive/invoke
```

## IPC Communication Flow

### Sending a Message (Non-Streaming)

```typescript
// Frontend (AiChatBox.vue)
import { sendChatMessage } from '@/views/api/aiChat'

const response = await sendChatMessage('Hello AI')

// ↓ IPC layer (views/api/aiChat.ts)
const response = await windowInvoke(AI_CHAT_MESSAGE, { message, conversationId })

// ↓ Main process (ai-chat-ipc.ts)
ipcMain.handle(AI_CHAT_MESSAGE, async (event, data) => {
  // Call remote API
  const apiResponse = await aiChatApi.sendMessage(chatRequest)
  // Store in history
  // Return response
})

// ↓ Remote API (api/aiChatApi.ts)
const response = await httpClient.postJson('/api/ai/chat/message', data)

// ↓ Remote Server
// Processes request and returns AI response
```

### Streaming a Message

```typescript
// Frontend (AiChatBox.vue)
await streamChatMessage(
  message,
  (chunk) => { /* handle chunk */ },
  (full) => { /* handle complete */ }
)

// ↓ IPC layer (views/api/aiChat.ts)
windowReceive(AI_CHAT_STREAM_CHUNK, chunkHandler)
windowReceive(AI_CHAT_STREAM_COMPLETE, completeHandler)
windowSend(AI_CHAT_STREAM, { message, conversationId })

// ↓ Main process (ai-chat-ipc.ts)
ipcMain.on(AI_CHAT_STREAM, async (event, data) => {
  // Call remote API
  const stream = await aiChatApi.streamMessage(chatRequest)
  // Send chunks via event.sender.send(AI_CHAT_STREAM_CHUNK)
  // Send complete via event.sender.send(AI_CHAT_STREAM_COMPLETE)
})
```

## Data Models

### ChatMessage
```typescript
interface ChatMessage {
  id: string              // Unique message identifier
  role: 'user' | 'assistant' | 'system'
  content: string         // Message text content
  timestamp: Date         // When message was created
  conversationId?: string // Optional conversation grouping
}
```

### ChatHistoryResponse
```typescript
interface ChatHistoryResponse {
  messages: ChatMessage[]  // Array of messages
  totalMessages: number    // Count of messages
  conversationId: string   // Conversation identifier
}
```

### ChatStreamChunk
```typescript
interface ChatStreamChunk {
  content: string          // Partial content chunk
  isComplete: boolean      // Whether streaming is done
  messageId?: string       // ID of the message being built
}
```

## Remote API Endpoints

### POST /api/ai/chat/message
Send a non-streaming chat message.

**Request:**
```json
{
  "message": "What is TypeScript?",
  "conversation_id": "conv-123",
  "model": "gpt-4",
  "system_prompt": "You are a helpful assistant"
}
```

**Response:**
```json
{
  "status": true,
  "code": 20000,
  "data": {
    "message": "TypeScript is...",
    "conversationId": "conv-123",
    "messageId": "msg-456",
    "model": "gpt-4",
    "tokensUsed": 150
  }
}
```

### POST /api/ai/chat/stream
Send a streaming chat message.

**Request:** Same as /message endpoint

**Response:** Streaming chunks of text

### GET /api/ai/chat/models
Get available AI chat models.

**Response:**
```json
{
  "status": true,
  "data": {
    "models": {
      "gpt-4": {
        "name": "GPT-4",
        "description": "Most capable model",
        "maxTokens": 8192,
        "supportsStreaming": true
      }
    },
    "default_model": "gpt-4",
    "total_models": 3
  }
}
```

### GET /api/ai/chat/healthcheck
Check if AI chat service is available.

**Response:**
```json
{
  "status": true,
  "data": true
}
```

## Component API

### AiChatBox Component

**Props:**
```typescript
{
  visible: boolean  // Controls panel visibility
}
```

**Events:**
```typescript
{
  close: []        // Emitted when user closes the chat
}
```

**Usage:**
```vue
<AiChatBox
  :visible="chatPanelOpen"
  @close="handleChatClose"
/>
```

## State Management

### Chat History Storage
Currently uses **in-memory storage** in the main process:

```typescript
// src/main-process/communication/ai-chat-ipc.ts
const chatHistory: ConversationHistory = {}
```

**Future Enhancement:** Migrate to database storage for persistence across app restarts.

### Conversation Management
- Default conversation ID: `'default'`
- Support for multiple conversations via `conversationId`
- Clear individual conversations or all at once

## Styling & Theming

### Theme Support
The chat automatically adapts to the app's theme:

```scss
// Light theme (default)
.ai-chat-box {
  background-color: #ffffff;
}

// Dark theme
:deep(.v-theme--dark) .ai-chat-box {
  background-color: #1e1e1e;
}
```

### Responsive Design
```scss
// Desktop: 400px sliding panel
.ai-chat-panel {
  width: 400px;
  right: -420px;
}

// Mobile: Full-screen overlay
@media (max-width: 768px) {
  .ai-chat-panel {
    width: 100%;
    right: -100%;
  }
}
```

### Animations
- **Panel slide**: 0.3s ease-in-out
- **Backdrop fade**: 0.3s fade-in
- **Typing indicator**: Bouncing dots animation

## Development Guide

### Adding New Features

#### 1. Add New IPC Channel
```typescript
// src/config/channellist.ts
export const AI_CHAT_NEW_FEATURE = 'ai-chat:new-feature'
```

#### 2. Implement IPC Handler
```typescript
// src/main-process/communication/ai-chat-ipc.ts
ipcMain.handle(AI_CHAT_NEW_FEATURE, async (event, data) => {
  // Implementation
})
```

#### 3. Update Preload
```typescript
// src/preload.ts
const validChannels = [..., AI_CHAT_NEW_FEATURE]
```

#### 4. Create API Function
```typescript
// src/views/api/aiChat.ts
export async function newFeature() {
  return await windowInvoke(AI_CHAT_NEW_FEATURE, data)
}
```

#### 5. Use in Component
```typescript
// src/views/components/aiChat/AiChatBox.vue
import { newFeature } from '@/views/api/aiChat'
await newFeature()
```

### Debugging

#### Enable Debug Logging
```typescript
// In ai-chat-ipc.ts
console.log('AI Chat message received:', data)
console.log('API response:', apiResponse)
```

#### Check IPC Communication
```typescript
// In browser console
window.api.invoke(AI_CHAT_MESSAGE, { message: 'test' })
```

#### Monitor Network Requests
- Open DevTools Network tab
- Look for `/api/ai/chat/*` requests
- Check request/response payloads

### Testing

#### Manual Testing Checklist
- [ ] Open/close chat with button
- [ ] Open/close chat with Ctrl/Cmd+K
- [ ] Send message with Enter
- [ ] Multi-line message with Shift+Enter
- [ ] Verify message appears in history
- [ ] Clear chat history
- [ ] Test on mobile screen size
- [ ] Test light/dark theme switching
- [ ] Test with long messages
- [ ] Test with many messages (scrolling)

#### Integration Testing
```typescript
// Test IPC handler
import { sendChatMessage } from '@/views/api/aiChat'

test('should send message via IPC', async () => {
  const response = await sendChatMessage('test message')
  expect(response.success).toBe(true)
})
```

## Security Considerations

### API Key Management
- **Remote server handles API keys** - No keys in client code
- **No sensitive data in frontend** - Only message content
- **HTTPS communication** - Use secure connections to remote API

### Input Validation
- Message content is sanitized for display
- XSS prevention via Vue's v-html safety
- Length limits can be added if needed

### Rate Limiting
Consider adding rate limiting:
- Limit messages per minute
- Throttle rapid requests
- Show user feedback for limits

## Performance Optimization

### Current Optimizations
- Auto-scroll only when at bottom
- Virtual scrolling not yet implemented (add for 1000+ messages)
- Debounced scroll detection
- Efficient re-renders with Vue reactivity

### Future Optimizations
- Implement virtual scrolling for very long chats
- Add message pagination
- Cache responses client-side
- Compress large message history

## Extension Points

### 1. Custom Message Renderers
Add support for custom message types (images, files, etc.)

### 2. RAG Integration
Connect to knowledge base for context-aware responses:
```typescript
// In aiChatApi.ts
async sendMessageWithContext(message: string, documentIds: number[]) {
  // Include RAG context in request
}
```

### 3. Multiple Models
Allow users to switch AI models:
```typescript
// Add model selector in chat header
const selectedModel = ref('gpt-4')
```

### 4. Conversation Sessions
Implement multiple conversation tabs:
```typescript
const conversations = ref<Map<string, ChatMessage[]>>()
```

## Dependencies

### Required Packages
```json
{
  "@ai-sdk/vue": "^2.0.68",
  "ai": "^5.0.68",
  "zod": "^4.1.12"
}
```

### Purpose
- **@ai-sdk/vue**: Vue composables for AI SDK
- **ai**: Core AI SDK with streaming support
- **zod**: Schema validation (peer dependency)

### No Additional Providers Needed
Unlike typical AI SDK setups, this implementation doesn't require provider packages (e.g., `@ai-sdk/openai`) because all AI processing happens on the remote server.

## Error Handling

### Error Types

#### 1. Network Errors
```typescript
{
  success: false,
  message: 'Failed to connect to remote API'
}
```

#### 2. API Errors
```typescript
{
  success: false,
  message: 'Remote API returned error: ...'
}
```

#### 3. IPC Errors
```typescript
{
  status: false,
  msg: 'IPC communication failed'
}
```

### Error Recovery
- Show error message in chat
- Allow retry
- Maintain conversation state
- Log errors for debugging

## Monitoring & Logging

### Key Metrics to Track
- Message send/receive latency
- Stream chunk processing time
- Error rates
- Conversation length distribution
- User engagement (messages per session)

### Log Locations
- **Main process**: `ai-chat-ipc.ts` console logs
- **Renderer process**: Browser DevTools console
- **Remote API**: Server-side logs

## Maintenance

### Regular Tasks
1. **Update dependencies** - Check for @ai-sdk/vue updates
2. **Monitor errors** - Review error logs
3. **Optimize performance** - Profile with long conversations
4. **Clean history** - Add automatic cleanup for old conversations

### Breaking Changes
If updating IPC channels or data structures:
1. Update `channellist.ts`
2. Update handlers in `ai-chat-ipc.ts`
3. Update wrappers in `views/api/aiChat.ts`
4. Update types in `commonType.ts`
5. Test all communication flows

## Troubleshooting

### Common Issues

#### Issue: "Cannot find module '@ai-sdk/vue'"
**Solution:** Run `yarn install` to ensure dependencies are installed

#### Issue: IPC handler not responding
**Solution:** 
- Check channel is registered in `index.ts`
- Verify channel is whitelisted in `preload.ts`
- Check console for registration errors

#### Issue: Remote API not accessible
**Solution:**
- Verify remote server is running
- Check network connectivity
- Test with `aiChatApi.testConnection()`

#### Issue: Chat history not persisting
**Solution:**
- Currently uses in-memory storage (resets on app restart)
- Migrate to database storage for persistence
- See Phase 7 tasks for implementation

### Debug Mode

Enable verbose logging:
```typescript
// In ai-chat-ipc.ts
const DEBUG = true

if (DEBUG) {
  console.log('Request:', requestData)
  console.log('Response:', apiResponse)
}
```

## Future Development

### Phase 7: Advanced Features (Optional)
- RAG knowledge base integration
- Multiple conversation sessions
- Export/import chat history
- File attachment support
- Voice input/output

### Recommended Next Steps
1. Migrate chat history to database (TypeORM entity)
2. Add conversation session management
3. Implement RAG context integration
4. Add message search functionality
5. Support rich media (images, files)

## References

- **Pattern Reference**: `src/api/ragConfigApi.ts` and `src/main-process/communication/rag-ipc.ts`
- **@ai-sdk/vue Docs**: https://sdk.vercel.ai/docs/ai-sdk-ui/vue
- **Electron IPC**: https://www.electronjs.org/docs/latest/api/ipc-main

---

**Maintainer**: Development Team  
**Last Updated**: 2025-10-10  
**Version**: 1.0.0


