CREATE TABLE IF NOT EXISTS video_download_task_detail (
id INTEGER PRIMARY KEY AUTOINCREMENT,
task_id INTEGER,
download_type INTEGER NULL,
cookies_type INTEGER NULL,
browser_type TEXT NULL,
proxy_override INTEGER NULL,
video_language TEXT NULL,
video_quality INTEGER NULL
)