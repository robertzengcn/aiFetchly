# Architecture Decision Records

Decisions made by the Architecture Remediation Program
(`docs/prd/architecture-remediation-prd.md`). Each ADR: **Context → Decision →
Consequences → Alternatives**.

| ADR | Title | Workstream | Status |
|---|---|---|---|
| [0001](0001-secret-storage-safestorage.md) | Secret storage via Electron `safeStorage` | WS-1 | Accepted (adapter shipped; cutover pending) |
| 0002 | Adopt `AppError`; delete `customError.ts`; lint raw throws | WS-5 | Pending |
| [0003](0003-main-window-sandbox.md) | Main-window sandbox: enable or document compensating control | WS-1 | Accepted (compensating control documented) |
| [0004](0004-graduated-diff-coverage-gate.md) | Graduated diff-coverage gate, not blanket 80% | WS-2 | Accepted |
| 0005 | Zod `zod/v4` mandate: honor or drop | WS-7 | Pending |
| 0006 | `lazySchema` required for all IPC/worker schemas | WS-1/WS-4 | Pending |
| 0007 | TypeORM migrations over `synchronize` in production | WS-3 | Pending |
| 0008 | Single worker transport: `utilityProcess.fork` + `parentPort` | WS-4 | Pending |
| 0009 | Worker/browser concurrency budget value & derivation | WS-4 | Pending |
| 0010 | Constructor injection with defaults for hub modules | WS-5 | Pending |
