CREATE TABLE IF NOT EXISTS emailsearch_result(
id INTEGER PRIMARY KEY AUTOINCREMENT,
task_id INTEGER,
url TEXT NULL,
title TEXT NULL,
email TEXT NULL,
phone TEXT NULL,
address TEXT NULL,
socialLinks TEXT NULL,
aiEnrichmentStatus TEXT NULL DEFAULT 'none',
aiEnrichmentError TEXT NULL,
aiConfidence REAL NULL DEFAULT 0,
record_time TEXT NULL
)
