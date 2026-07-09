CREATE TABLE IF NOT EXISTS email_reply_identity_profile(
id INTEGER PRIMARY KEY AUTOINCREMENT,
emailServiceId INTEGER NOT NULL,
ownerName VARCHAR(255) NOT NULL,
ownerRole VARCHAR(255),
companyName VARCHAR(255),
preferredTone VARCHAR(100),
signature TEXT,
styleNotes TEXT,
forbiddenPhrasesJson TEXT,
discloseAutomation INTEGER DEFAULT 0,
createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
)
