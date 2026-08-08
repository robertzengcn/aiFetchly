# DEBUG REPORT: Email reply audit log SQLite lock

- **Symptom:** `get_email_message` completed successfully, but the AI read audit insert failed with `QueryFailedError: SqliteError: database is locked` / `SQLITE_BUSY`.
- **Root cause:** `EmailReplyAuditLogModel.create()` used a single `repository.save()` call. Under concurrent SQLite writers, TypeORM/better-sqlite3 can exhaust its native lock wait and surface `SQLITE_BUSY`; this non-critical audit path had no bounded application retry.
- **Fix:** Added `runWithSqliteBusyRetry()` and applied it to reply audit log inserts with one delayed retry after a SQLite busy/locked error.
- **Evidence:** `yarn testmain test/vitest/main/SqliteBusyRetry.test.ts --run` passed 3 tests. `yarn testmain test/vitest/main/EmailReceiveAiTools.test.ts --run` passed 10 tests.
- **Regression test:** `test/vitest/main/SqliteBusyRetry.test.ts` covers TypeORM-wrapped busy error detection, retry success, and non-busy no-retry behavior.
- **Related:** The email receive AI tests still print existing native-module/mock warnings, but the suite passes and those warnings are unrelated to this change.
- **Status:** DONE
