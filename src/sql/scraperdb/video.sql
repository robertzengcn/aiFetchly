CREATE TABLE IF NOT EXISTS video (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    localpath TEXT NULL,
    filterwatermark TEXT NULL, /* video path that remove watermark*/
    -- srtfile TEXT NULL,
    record_time TEXT NULL
)