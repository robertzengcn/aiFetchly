-- record for single video download 
CREATE TABLE IF NOT EXISTS video_download (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NULL,
    savepath TEXT NULL,
    record_time TEXT NULL,
    task_id INTEGER,
    caption_status INTEGER,
    -- strout TEXT NULL,
    error_log TEXT NULL,
    status INTEGER
)