# AI Chat Assistant - User Guide

## Overview
The AI Chat Assistant is an integrated chat interface that provides real-time AI-powered assistance directly within the application.

## Features

### 💬 Chat Interface
- Real-time messaging with AI assistant
- Streaming responses for immediate feedback
- Persistent conversation history
- Clean, modern UI with avatars and timestamps

### ⌨️ Keyboard Shortcuts
- **`Ctrl + K`** (Windows/Linux) or **`Cmd + K`** (Mac) - Toggle chat panel
- **`Enter`** - Send message
- **`Shift + Enter`** - New line in message
- **`Esc`** - Close chat panel (click backdrop)

### 🎨 User Interface
- **Toggle Button**: Chat icon (💬) in the top-right header
- **Panel Position**: Slides in from the right side
- **Panel Width**: 400px on desktop, full-screen on mobile
- **Theme Support**: Automatically matches app theme (light/dark)

## How to Use

### Opening the Chat
1. Click the **chat icon** (💬) in the top-right corner of the header
2. Or press **`Ctrl/Cmd + K`** from anywhere in the app
3. The chat panel will slide in from the right

### Sending Messages
1. Type your message in the input field at the bottom
2. Press **Enter** to send (or click the send button)
3. Use **Shift + Enter** to add a new line without sending
4. Watch the AI response stream in real-time

### Message Display
- **Your messages**: Appear on the right in blue bubbles with your avatar
- **AI responses**: Appear on the left in grey bubbles with robot avatar
- **Timestamps**: Show relative time (e.g., "Just now", "5m ago")
- **Formatting**: Supports bold (**text**), italic (*text*), and inline code (`code`)

### Managing Conversations
- **Chat History**: Automatically loaded when you open the chat
- **Clear Chat**: Click the trash icon (🗑️) in the header to clear history
- **Confirmation**: System will ask for confirmation before clearing
- **Persistence**: Chat history is stored in database and persists across app restarts

### RAG Knowledge Base Integration 🆕
- **Toggle RAG Context**: Click the book-search icon (📖) in the header
- **When Enabled**: AI responses include context from your knowledge base
- **How It Works**: 
  1. Your question searches the knowledge base
  2. Relevant documents are found automatically
  3. Context is included with your message to AI
  4. AI gives more accurate, context-aware answers
- **Visual Indicator**: Button highlights in blue when RAG context is enabled

### Closing the Chat
1. Click the **X button** in the chat header
2. Click the **backdrop** (dark area) outside the chat panel
3. Press **`Ctrl/Cmd + K`** again to toggle off

## Tips & Tricks

### Best Practices
- Keep messages clear and concise for better AI responses
- Use the chat history to maintain context in conversations
- Clear chat when starting a new topic for better context

### Mobile Usage
- On mobile devices, the chat panel opens full-screen
- Swipe or tap outside to close
- All features work the same as desktop

### Keyboard Navigation
- Tab through UI elements for accessibility
- Use keyboard shortcuts for faster workflow
- Input field auto-focuses when chat opens

## Technical Details

### Data Storage 🆕
- Chat history is **stored in SQLite database**
- Messages **persist across app restarts**
- Messages remain between chat open/close
- Clear chat removes all messages for that conversation from database
- Each conversation has a unique ID for organization

### Remote API Integration
- All AI processing happens on the remote server
- No local API keys required
- Streaming support for real-time responses
- Error handling with user-friendly messages

### Performance
- Efficient message rendering
- Auto-scroll to latest messages
- Scroll-to-bottom button appears when scrolled up
- Optimized for long conversations

## Troubleshooting

### Chat Not Opening
- Check if remote API server is accessible
- Check browser console for errors
- Try refreshing the application

### Messages Not Sending
- Verify remote API server is running
- Check network connectivity
- Look for error messages in the chat

### Slow Responses
- Remote API server may be processing
- Network latency may affect speed
- Streaming helps show progress

### Theme Not Matching
- Theme automatically follows app settings
- Toggle app theme to see changes
- Chat panel theme updates immediately

## Future Enhancements

### Planned Features
- RAG knowledge base integration for context-aware responses
- Multiple conversation sessions
- Export chat history
- File attachment support
- Voice input/output
- Message search within chat
- Suggested prompts and quick actions

### Feedback
If you have suggestions or encounter issues, please report them to the development team.

---

**Last Updated**: 2025-10-10
**Version**: 1.0.0

