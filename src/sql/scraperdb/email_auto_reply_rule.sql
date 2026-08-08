CREATE TABLE IF NOT EXISTS email_auto_reply_rule(
id INTEGER PRIMARY KEY AUTOINCREMENT,
emailServiceId INTEGER NOT NULL,
name VARCHAR(255) NOT NULL,
enabled INTEGER DEFAULT 0,
allowedClassificationsJson TEXT NOT NULL,
blockedSenderPatternsJson TEXT,
blockedDomainPatternsJson TEXT,
dailySendLimit INTEGER DEFAULT 10,
perThreadReplyLimit INTEGER DEFAULT 1,
confidenceThreshold REAL DEFAULT 0.7,
quietHoursJson TEXT,
requireApprovalBelowThreshold REAL DEFAULT 0.7,
createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
)
