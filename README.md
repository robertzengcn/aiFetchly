<h1 align="center">aiFetchly</h1>

<p align="center">
  <strong>AI-Powered Marketing Automation for Lead Generation and Outreach</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#getting-started">Getting Started</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="#documentation">Documentation</a> &middot;
  <a href="#contributing">Contributing</a> &middot;
  <a href="#license">License</a>
</p>

---

**aiFetchly** is an open-source desktop application that combines AI with marketing automation to help you find leads, extract contacts, run personalized email outreach campaigns, and manage social media — all from one place.

## Why aiFetchly?

- **One tool for the entire pipeline** — from discovering leads to sending outreach emails, no need to juggle multiple SaaS products
- **Your data stays on your machine** — local SQLite database, your own SMTP server, no third-party data harvesting
- **AI that knows your business** — upload your documents and let AI generate emails and strategies grounded in your own content
- **Extensible skill system** — install community skills or build your own to grow the platform

## Features

### Lead Generation

| Feature | Description |
|---------|-------------|
| **Multi-Engine Search** | Search Google and Yandex simultaneously with bulk keywords. AI generates related keywords and recovers from errors in real time. |
| **Local Business Finder** | Find businesses on Google Maps and Yandex Maps by keyword and location. Export names, categories, ratings, phone numbers, and websites. |
| **Yellow Pages Scraper** | Organize business data from global directory platforms with AI-assisted data alignment that adapts to directory changes. |

### Contact Extraction & Email Outreach

| Feature | Description |
|---------|-------------|
| **Contact Extraction** | Feed any list of URLs and extract emails, phone numbers, addresses, and social profiles. Batch process thousands of pages with live progress tracking. |
| **AI Email Writer** | Generate personalized outreach emails using RAG technology. Upload your own documents (PDF, DOCX, TXT, MD) as context for AI-generated content. |
| **Batch Email Campaigns** | Design campaigns with AI-generated templates, send through your own SMTP, apply smart filters, and track delivery status in real time. Duplicate prevention built in. |

### AI & Automation

| Feature | Description |
|---------|-------------|
| **Knowledge Library** | Upload documents and chat with an AI that understands your content. Semantic search across your entire knowledge base using vector embeddings. |
| **AI Marketing Assistant** | Get strategic marketing guidance through AI-powered chat, grounded in your own documents. |
| **Task Scheduling** | Schedule any task with cron timing, chain dependent tasks, set up recurring jobs, and monitor execution history. |
| **Installable Skills** | Extend the platform with skill packages — PDF processing, data analysis, and more. No coding required. |

### Social Media & Infrastructure

| Feature | Description |
|---------|-------------|
| **Proxy Management** | Manage rotating HTTP, HTTPS, and SOCKS5 proxies. Bulk import, validate, and test to ensure uninterrupted access. |
| **Dashboard & Analytics** | Real-time overview of searches, emails, campaigns, and success rates. Filter by date and search engine, spot trends. |
| **One-Click Export** | Download any dataset as CSV. Generate performance reports with conversion tracking. |
| **Multi-Language UI** | Full interface in English, Chinese, Spanish, French, German, and Japanese. Switch on the fly. |

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Yarn** 1.x (classic)
- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)
- **RAM**: 4 GB minimum (8 GB recommended)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/robertzeng/aiFetchly.git
cd aiFetchly

# Install dependencies
yarn

# Initialize the local SQLite database
yarn init

# Start the application
yarn start
```

### First-Time Setup

1. Configure your backend API URL in `.env`:
   ```
   VITE_REMOTEADD=https://your-backend-api.example.com
   ```
2. [Set up proxies](https://aifetchly.com/docs/getting-started/proxy-setup) for web scraping features
3. Add your social media accounts and SMTP credentials in Settings

### CLI Usage

```bash
# Login to a social platform campaign
yarn login -c <campaignId>

# Run a task from the command line
yarn task -t <taskDetails>
```

## Development

```bash
# Start dev server with hot reload
yarn dev

# Type check (watch mode)
tsc --noEmit --watch

# Build for production
yarn build

# Package for current platform
yarn make

# Cross-platform builds
yarn make-win:prod     # Windows
yarn make-mac:prod     # macOS
yarn make-linux:prod   # Linux
```

### Testing

```bash
# Run all tests
yarn test

# Run a specific test by pattern
npx mocha test test/modules --grep "video-url-list"

# Run vitest suites
yarn vitest-googlescraper
yarn testmain

# Debug mode
DEBUG='bilibili-scraper:Scraper' yarn testdownload
```

### Project Structure

```
src/
├── background.ts              # Main Electron process entry
├── preload.ts                 # Context bridge / preload scripts
├── main-process/              # IPC handlers
├── controller/                # Business logic controllers
├── modules/                   # Core business logic (extends BaseModule)
├── model/                     # Data access layer (extends BaseDb)
├── entity/                    # TypeORM entities
├── service/                   # Service layer
├── childprocess/              # Worker process entry points
├── config/                    # App configuration & skill registry
└── views/                     # Vue 3 frontend
    ├── pages/                 # Page components
    ├── components/            # Reusable UI components
    ├── api/                   # Frontend API layer (IPC calls)
    ├── store/                 # Pinia state management
    └── lang/                  # i18n (en, zh, es, fr, de, ja)
```

### Architecture

aiFetchly follows a **three-layer architecture** with strict separation of concerns:

```
IPC Handler  →  Module (business logic)  →  Model (data access)
   (communication only)   (extends BaseModule)     (extends BaseDb)
```

- **Models** (`src/model/`) — TypeORM database operations, direct SQL queries
- **Modules** (`src/modules/`) — Business logic, validation, coordination of multiple models
- **IPC Handlers** (`src/main-process/`) — Communication only, never access the database directly

Worker processes (`src/childprocess/`) handle CPU-intensive tasks (scraping, AI processing) and communicate results back to the main process via IPC — never access the database directly.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron |
| Frontend | Vue 3, Vuetify, Pinia, vue-i18n |
| Language | TypeScript |
| Build | Vite, Electron Forge |
| Database | SQLite (TypeORM, better-sqlite3, sqlite-vec) |
| Automation | Puppeteer |
| AI | OpenAI, RAG with vector embeddings |
| Testing | Mocha, Vitest |

## Documentation

Full documentation is available at [aifetchly.com](https://aifetchly.com):

- [Introduction](https://aifetchly.com/docs/getting-started/introduction)
- [Installation Guide](https://aifetchly.com/docs/getting-started/installation)
- [Proxy Setup](https://aifetchly.com/docs/getting-started/proxy-setup)
- [Lead Generation](https://aifetchly.com/docs/category/lead-generation)
- [AI Outreach](https://aifetchly.com/docs/category/ai-outreach)
- [Automation](https://aifetchly.com/docs/category/automation)

## Contributing

Contributions are welcome! Whether it's a bug fix, new feature, or translation improvement:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes following [conventional commits](https://www.conventionalcommits.org/)
4. Open a pull request

Please read [CLAUDE.md](./CLAUDE.md) for architecture guidelines and coding conventions before contributing.

## License

This project is licensed under the [MIT License](./LICENSE).
