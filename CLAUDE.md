# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AiFetchly is an AI-powered marketing automation Electron application for social media platforms (Facebook, Twitter, YouTube, etc.). The project combines web scraping, automation, and email marketing capabilities with a Vue 3 frontend and TypeScript backend.

## Development Commands

### Essential Commands
- `yarn dev` - Start development server with hot reload
- `yarn build` - Build for production
- `yarn start` - Start Electron app
- `yarn make` - Package application for current platform
- `yarn test` - Run test suite with Mocha
- `yarn tsc` - Type check with TypeScript (watch mode)

### Specialized Commands
- `yarn login -c <campaignId>` - Login to social platform for specific campaign
- `yarn task -t <taskDetails>` - Run specific task
- `yarn init` - Initialize SQL database
- `yarn rebuild-sqlite3` - Rebuild SQLite3 native module
- `yarn vue-check` - Vue TypeScript type checking

### Testing Commands
- `yarn vitest-googlescraper` - Test Google scraper functionality
- `yarn testhttpclient` - Test HTTP client
- `yarn testyoutubeupload` - Test YouTube upload functionality
- `yarn testdownload` - Test video download (bilibili)

## Architecture Overview

### Project Structure
```
src/
├── background.ts              # Main Electron process entry point
├── preload.ts                 # Preload scripts
├── main-process/             # IPC handlers and main process logic
├── controller/                # Business logic controllers
├── modules/                   # Core functionality modules
├── entity/                    # Database entities (TypeORM)
├── entityTypes/              # TypeScript type definitions
├── model/                    # Data models
├── service/                  # Service layer
├── views/                    # Vue 3 frontend application
│   ├── pages/               # Page components
│   ├── components/          # Reusable components
│   ├── api/                 # Frontend API layer
│   ├── store/               # Pinia state management
│   └── utils/               # Frontend utilities
├── config/                   # Configuration files
└── worker.ts                 # Worker process
```

### Key Components

#### Database & Storage
- **SQLite with TypeORM** for local data persistence
- **sqlite-vec** integration for vector operations (in progress on current branch)
- Database configuration in `src/config/SqliteDb.ts`
- Entities in `src/entity/` following TypeORM patterns

#### IPC Communication
- Main process handlers in `src/main-process/communication/`
- Frontend API layer in `src/views/api/`
- Uses contextBridge for secure renderer-main communication

#### Social Platform Integration
- Platform-specific scrapers in `src/modules/`
- Browser automation using Puppeteer with stealth plugins
- Account management and cookie handling
- Support for multiple social media platforms

#### Task Management
- Scheduled tasks using cron expressions
- Background task execution with child processes
- Task state management and result tracking

## Technology Stack

### Core Technologies
- **Electron** - Desktop application framework
- **Vue 3** - Frontend framework with Composition API
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server
- **Pinia** - State management
- **Vuetify** - UI component library

### Key Dependencies
- **Puppeteer** - Web automation and scraping
- **TypeORM** - Database ORM
- **better-sqlite3** - SQLite database driver
- **node-cron** - Task scheduling
- **openai** - AI integration

## Development Patterns

### TypeScript Rules
- **NEVER use `any` type** - use proper types or `unknown` instead
- Define explicit interfaces for complex data structures
- All functions must have explicit return types
- Use proper error handling with `unknown` instead of `any` for catch blocks

### Code Organization
- Use PascalCase for classes/components, camelCase for variables/functions
- Modular architecture with clear separation of concerns
- IPC handlers should sanitize all data passed between processes
- Database operations must use TypeORM entities

### Security Best Practices
- Context isolation enabled, Node.js integration disabled in renderer
- All IPC communication through contextBridge
- User input validation and sanitization
- Secure token storage using Electron's safeStorage

### Testing Strategy
- Unit tests with Mocha for backend logic
- Vitest for frontend components and utilities
- Integration tests for scraping functionality
- Use DEBUG flags for detailed logging: `DEBUG='module:*' yarn test`

## Database Schema

### Key Entities
- **Campaign** - Marketing campaigns
- **SocialAccount** - Social media platform accounts
- **SocialTask** - Automation tasks
- **EmailMarketing** - Email marketing campaigns
- **Schedule** - Task scheduling information

### Vector Operations
Current branch (`sqlite-vec-merge`) is integrating sqlite-vec for vector similarity operations. Modified files:
- `src/model/Vector.model.ts`
- `src/modules/adapters/SqliteVecDatabase.ts`

## Common Development Tasks

### Adding New Social Platform
1. Create platform-specific module in `src/modules/`
2. Add entity types in `src/entityTypes/`
3. Implement scrapers following existing patterns
4. Add frontend components in `src/views/pages/`
5. Update IPC handlers for platform communication

### Adding New Tasks
1. Define task schema in entity types
2. Create controller in `src/controller/`
3. Implement task logic in `src/modules/`
4. Add frontend UI components
5. Register IPC handlers

### Database Changes
1. Update TypeORM entities in `src/entity/`
2. Update database configuration if needed
3. Run migrations with `yarn init` if structure changes
4. Update TypeScript types accordingly

## Environment Configuration

### Required Environment Variables
- `VITE_REMOTEADD` - Backend API URL
- `UPDATESERVER` - Update server URL for auto-updater

### Development Setup
1. Install dependencies with `yarn`
2. Set up backend service URL in `.env` file
3. Run database initialization with `yarn init`
4. Start development with `yarn dev`

## Debugging

### Main Process Debugging
- Use Electron DevTools for main process debugging
- Logs are written to application log directory
- Use DEBUG flags for module-specific logging

### Renderer Process Debugging
- Chrome DevTools available in development
- Vue DevTools extension installed automatically
- Component state inspection through Vue DevTools

### Common Issues
- SQLite3 native module may require rebuilding after Node.js updates
- Puppeteer browser instances should be properly managed to avoid memory leaks
- IPC calls must handle both success and error cases