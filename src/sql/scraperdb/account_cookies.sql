-- Reference schema for account_cookies.
-- NOTE: the app uses TypeORM synchronize:true; this file is documentation only
-- and is NOT executed at runtime. New @Column fields on AccountCookiesEntity are
-- auto-added (ALTER TABLE ... ADD COLUMN) on the next app start. The columns
-- below are additive metadata for the secure-storage feature; the existing
-- `cookies` column is reused to hold the ENC1 ciphertext envelope.
CREATE TABLE IF NOT EXISTS account_cookies(
id INTEGER PRIMARY KEY AUTOINCREMENT,
account_id INTEGER,
cookies TEXT,
partition_path TEXT,
record_time TEXT NULL,
createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
encryption_version INTEGER NULL,
source TEXT NULL,
cookie_count INTEGER NULL,
session_status TEXT NULL,
last_error_code TEXT NULL,
migration_attempted_at TEXT NULL
)
