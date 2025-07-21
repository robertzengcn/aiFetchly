-- record for user submit video download task
CREATE TABLE IF NOT EXISTS video_download_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name TEXT NULL,
    platform TEXT NULL,
    -- url TEXT NULL,
    savepath TEXT NULL,
    record_time TEXT NULL,
    runtime_log TEXT NULL,
    error_log TEXT NULL,
    status INTEGER NULL
)