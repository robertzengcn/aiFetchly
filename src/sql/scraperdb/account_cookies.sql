CREATE TABLE IF NOT EXISTS account_cookies(
id INTEGER PRIMARY KEY AUTOINCREMENT,
account_id INTEGER,
cookies TEXT,
partition_path TEXT,
record_time TEXT NULL
)