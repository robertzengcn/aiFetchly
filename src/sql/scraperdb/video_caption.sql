CREATE TABLE IF NOT EXISTS video_caption (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER,
    language_id INTEGER,
    caption_path TEXT,
    record_time TEXT
)