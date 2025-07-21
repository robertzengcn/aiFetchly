CREATE TABLE IF NOT EXISTS video_description (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER,
    language_id INTEGER,
    title TEXT,
    description TEXT,
    record_time   
)