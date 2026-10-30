<h1 align="center">aiFetchly</h1>

<p align="center">
  <strong>用于业务自动化的桌面 AI Agent</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot;
  简体中文 &middot;
  <a href="./README.es.md">Español</a> &middot;
  <a href="./README.fr.md">Français</a> &middot;
  <a href="./README.de.md">Deutsch</a> &middot;
  <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <img src="docs/images/readme/hero-ai-chat.png" alt="aiFetchly AI agent 工作区" width="900">
</p>

---

**aiFetchly** 是一个开源的桌面 AI Agent 平台，面向真实的业务工作场景。它把本地知识库、浏览器自动化、可安装技能、定时任务、插件和专业子 Agent 集成到同一个应用里，帮助团队自动完成调研、文档处理、网站信息采集、客户沟通和周期性运营任务。

aiFetchly 最初聚焦营销自动化，例如线索发现、联系方式提取和邮件触达。现在这些能力仍然保留，但产品方向更宽：aiFetchly 正在成为一个本地优先的 AI Agent 工作空间，为业务用户提供工具、记忆、文件、网页自动化和可控执行能力。

## 什么是 aiFetchly？

aiFetchly 可以把业务意图转化为可执行工作流：

- **让 AI Agent 执行业务工作**：通过聊天界面完成调研、文件分析、数据提取、消息草拟、文档总结和工具操作。
- **使用你的业务知识**：把文档上传到本地知识库，生成基于你自己文件的答案、草稿和方案。
- **自动化浏览器和数据任务**：从网站收集信息、采集结构化数据、处理 URL 列表并导出结果。
- **让 AI 操控真实浏览器**：启动一个可见的 Chrome 窗口，AI 可以观察并操作它；你能看到每一步、批准关键操作，并在登录或验证码出现时亲自接管。详见[受管浏览器自动化](#受管浏览器自动化)。
- **委派给专业子 Agent**：运行带有独立提示词、工具权限、资源限制和结构化输出的后台 Agent。
- **扩展工作空间**：安装技能和插件，加入新的工具、业务流程和集成能力。
- **保持控制权**：数据存储在本地 SQLite 数据库中，可以审查工具活动、设置权限并在自己的桌面运行。

## 截图

### AI Agent 工作区

![aiFetchly AI agent 工作区](docs/images/readme/hero-ai-chat.png)

### 知识库

![aiFetchly 知识库](docs/images/readme/knowledge-library.png)

### 技能和插件管理

![aiFetchly 插件管理](docs/images/readme/plugin-manager.png)

### AI Provider 设置

![aiFetchly AI Provider 设置](docs/images/readme/ai-provider-settings.png)

## Agent 能力

### AI Agent 工作空间

| 能力 | 说明 |
|------|------|
| **可使用工具的 AI 聊天** | 在桌面工作空间中，让 AI 助手调用经过批准的工具、使用业务上下文并完成多步骤任务。 |
| **自定义 AI Provider** | AI Chat 支持 OpenAI 兼容 Provider，包括 Ollama、LM Studio、OpenAI、OpenRouter、vLLM、LocalAI 或自定义端点。 |
| **业务任务执行** | 执行调研、提取、文件处理、消息草拟、定时和自动化流程，无需在多个 SaaS 工具之间切换。 |
| **AI 客户邮件助手** | 使用业务文档和流程数据作为上下文，草拟、发送和回复客户邮件。 |
| **应用支持子 Agent** | 部署专业 AI 子 Agent，使用独立系统提示词、工具白名单、资源限制和结构化输出运行。 |
| **权限控制自动化** | 管理哪些工具、插件、Hook 和子 Agent 可以运行。工具调用会经过全局拒绝规则、Agent 白名单和任务级限制。 |

### 业务知识与 RAG

| 能力 | 说明 |
|------|------|
| **知识库** | 将 PDF、TXT、DOC/DOCX、Markdown、HTML、CSV 和 Excel 文件上传到本地知识库，用于检索增强生成。 |
| **文档处理** | 检测重复上传、跟踪处理进度、切分文档并保存向量嵌入以支持语义检索。 |
| **Embedding 模型设置** | 选择和更新知识库使用的 embedding 模型，并在界面中查看维度、可用性等模型信息。 |
| **基于业务资料的回答** | 使用你的文档作为上下文，生成总结、计划、邮件、报告和操作建议。 |

### 技能、插件与扩展

| 能力 | 说明 |
|------|------|
| **可安装技能** | 使用可复用技能包扩展 Agent，覆盖文件处理、数据分析、自动化辅助和领域流程。 |
| **技能管理** | 从 ZIP 包导入技能，查看内置、用户安装和插件提供的技能，启用、禁用或卸载用户技能。 |
| **插件管理** | 从 ZIP 或源文件夹导入插件，统一管理插件启用状态、健康状况、格式、技能和 MCP 服务器。 |
| **Claude 风格插件兼容** | 支持 aiFetchly 插件格式和 Claude 风格插件包，插件可以贡献技能和 MCP 服务器定义。 |
| **Hook 管理** | 为 AI/chat 生命周期创建命令 Hook，例如会话开始、提交提示、工具使用、权限请求和停止事件。 |

### 浏览器、数据与工作流自动化

| 能力 | 说明 |
|------|------|
| **AI 操控的受管浏览器** | 把真实可见的 Chrome 窗口交给 AI Agent：打开网站、读取页面、点击、输入、跳转、提取数据，并在需要人工介入时暂停。公开网站无需保存账号即可打开，需要时也可复用已保存 Tool Account 的登录状态。 |
| **网页调研自动化** | 跨搜索引擎检索，收集业务信息，处理 URL 列表，并在任务出错时实时恢复。 |
| **结构化数据提取** | 提取邮箱、电话、地址、社交主页、公司详情、目录记录和其他业务数据。 |
| **任务调度** | 使用 cron 时间表达式安排任务，串联依赖任务，设置周期工作流并查看执行历史。 |
| **一键导出** | 将采集或处理后的数据下载为 CSV，并生成报告。 |
| **代理管理** | 管理 HTTP、HTTPS 和 SOCKS5 代理，批量导入、验证和测试代理。 |

### 内置业务增长工作流

| 工作流 | 说明 |
|--------|------|
| **公司与线索调研** | 从搜索引擎、Google Maps、Yandex Maps、Yellow Pages 和其他目录类来源查找企业。 |
| **联系方式提取** | 输入 URL 列表，批量提取邮箱、电话、地址和社交主页，并跟踪实时进度。 |
| **AI 邮件草拟** | 使用 RAG 技术和你上传的文档生成个性化业务邮件。 |
| **客户邮件发送与回复** | 利用知识库、客户数据和历史流程结果，帮助发送邮件并生成上下文相关回复。 |
| **社交平台操作** | 管理社交账号，并在支持的平台上执行部分社交媒体自动化流程。 |

## 快速开始

### 环境要求

- **操作系统**：Windows 10+、macOS 10.15+ 或 Linux（Ubuntu 20.04+）
- **内存**：最低 4 GB，推荐 8 GB

### 首次设置

1. 打开 aiFetchly 并登录账户。
2. 如果需要基于业务资料生成回答，将文档导入知识库。
3. 为需要的工作流安装或启用技能和插件。
4. 如果希望 AI Chat 使用自己的模型，在 System Settings -> AI Provider 中配置自定义 AI Provider。
5. 只有在使用网站信息采集、社交或邮件工作流时，才需要配置代理、社交账号或 SMTP 凭据。

## 开发

### 环境要求

- **Node.js** 18+
- **Yarn** 1.x（classic）

```bash
yarn install
cp .env.example .env
yarn init
yarn dev
yarn tsc
yarn vue-check
yarn build
yarn make
```

### 测试

```bash
yarn test
yarn testmain
yarn vitest-googlescraper
yarn testhttpclient
yarn testyoutubeupload
yarn testdownload
```

### 架构

aiFetchly 使用三层架构，保持职责分离：

```text
IPC Handler  ->  Module（业务逻辑） ->  Model（数据访问）
```

- **Models**（`src/model/`）处理 TypeORM 数据库操作和 SQL 查询。
- **Modules**（`src/modules/`）处理业务逻辑、校验和多个模型之间的协调。
- **IPC Handlers**（`src/main-process/`）只负责通信，不直接访问数据库。

Worker 进程位于 `src/childprocess/`，用于网页采集和 AI 处理等耗时任务。它们通过 IPC 把结果传回主进程，不直接访问数据库。

## AI Provider 配置

AI Chat 可以使用托管的 aiFetchly AI，也可以使用用户配置的 OpenAI 兼容 Provider。打开 **System Settings -> AI Provider** 即可切换模式并保存本地或自定义 Provider。

支持的预设包括 Ollama、LM Studio、OpenAI、OpenRouter、vLLM、LocalAI 和 Custom。Provider 配置需要 base URL 和默认模型，本地 Provider 的 API key 可选，第三方托管 Provider 建议配置 API key。

## 受管浏览器自动化

aiFetchly 内置一个真正由 AI 驱动的浏览器。Agent 会打开一个你能在桌面上看到的、正常的有头 Chrome/Chromium 窗口，观察当前页面，并按你的要求完成操作，同时应用界面展示会话状态、审批、进度和结果。

该功能用于操作你拥有或被授权运营的网站与账号，不会绕过 MFA、登录/安全验证、平台安全策略或访问限制。

### 启动会话

- **AI Chat**：直接描述需要浏览器的任务，Agent 会自行加载浏览器工具。
- **Tool Account → Open managed browser**：复用已保存账号的登录状态连接对应平台。
- **AI 工作区的会话卡片**：查看、控制或停止正在运行的浏览器。

公开浏览不需要任何账号。任何网站（包括社交网络和必须登录的站点）都可以在没有保存 Tool Account 的情况下打开；需要登录时，aiFetchly 会把同一个窗口交给你处理，而不是拒绝打开或改用 HTTP 抓取。使用已保存账号打开时，则复用加密存储的 Cookie 会话。

### Agent 可用的浏览器工具

| 工具 | 用途 |
|------|------|
| `browser_start_session` | 为某个 URL 或已保存的 Tool Account 启动会话 |
| `browser_get_status` | 读取会话状态和当前已脱敏 URL |
| `browser_observe` | 获取有界的页面语义快照与可交互元素 |
| `browser_navigate` | 跳转到允许的 `http(s)` 地址 |
| `browser_run_actions` | 执行有界的结构化动作程序（点击、输入、滚动、等待、提取、循环） |
| `browser_screenshot` | 为当前对话截取页面缩略图 |
| `browser_request_handoff` | 暂停并请你接管 |
| `browser_resume_after_handoff` | 你确认后恢复 |
| `browser_evaluate_script` | 在页面上下文中执行经审核的 JavaScript（需审批） |
| `browser_clear_cache` | 确认后清理当前账号的浏览器缓存 |
| `browser_stop_session` | 停止并关闭浏览器 |

`browser_observe` 返回形如 `@e1 [button] "Search"` 的引用，并附带页面版本号；页面版本变化后旧引用会被拒绝，避免点错元素。结构化动作无法表达的 DOM 逻辑可以用 `browser_evaluate_script` 完成，脚本只在网页上下文运行，不会以 Node.js、Electron、Shell 或文件系统权限执行。

### 审批与安全

| 风险等级 | 示例 | 行为 |
|----------|------|------|
| 观察 | 读取文本、检查元素、截图 | 会话级审批 |
| 可逆交互 | 搜索、筛选、翻页、草拟文本 | 会话级审批 |
| 敏感输入 | 邮箱、电话、私信、上传 | 预览并明确审批 |
| 关键操作 | 发送、发布、评论、关注、上传、删除、购买、修改设置 | 逐次即时审批，展示账号、目标和影响 |
| 特权脚本 | 任意页面内 JavaScript | 展示脚本、域名、用途、超时和预期输出后审批 |
| 身份验证 | 密码、MFA、通行密钥、安全验证码 | 始终交由你手动完成 |

网页内容被视为不可信数据，因此页面无法说服 Agent 跳过审批；模型不能自行把操作标记为安全；目标或页面版本在审批后发生变化时，审批会失效。Cookie 不会进入渲染进程、模型上下文、工具结果、日志或分析数据，只有主进程负责解密、浏览器 Worker 负责应用；登录成功后新的会话会被重新加密保存。

### 设置与缓存

**System Settings → Managed Browser** 提供：

| 设置 | 默认 | 作用 |
|------|------|------|
| **Use built-in managed browser** | 开启 | 允许 AI 发起新的受管浏览器会话 |
| **Use managed browser cache** | 开启 | 在账号隔离前提下复用静态资源 |
| **Maximum managed-browser cache** | 500 MB | 限制磁盘占用（100–2048 MB） |
| **Clear cache when aiFetchly closes** | 关闭 | 退出时清理浏览器缓存 |

面板还显示缓存大小、上次清理时间，以及清理单个账号或全部受管浏览器缓存的入口。清理缓存不会删除加密 Cookie、已保存登录、账号记录或下载文件。

完整需求、安全模型、指纹策略和上线计划见 [`docs/prd/puppeteer-managed-social-browser-prd.md`](docs/prd/puppeteer-managed-social-browser-prd.md)。

## 文档

完整文档请访问 [docs.aifetchly.com](https://docs.aifetchly.com)。

AI 操控受管浏览器（可见 Chrome 会话、浏览器工具、审批、人工接管、指纹策略、缓存）：[产品需求](docs/prd/puppeteer-managed-social-browser-prd.md)。

应用官方网站是 [aifetchly.com](https://www.aifetchly.com)。

## 支持 aiFetchly

如果 aiFetchly 帮助你节省了时间或提高了工作效率，欢迎通过 Ko-fi 支持项目的持续开发。

<p>
  <a href="https://ko-fi.com/aifetchly">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="在 Ko-fi 上支持 aiFetchly">
  </a>
</p>

## 贡献

欢迎贡献代码、修复问题、改进工作流、添加技能、插件或翻译。请先阅读 [CLAUDE.md](./CLAUDE.md) 中的架构和编码约定。

## 许可证

本项目基于 [Apache License Version 2.0](./LICENSE) 授权。
