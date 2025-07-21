CREATE TABLE IF NOT EXISTS emailmarketing_send_log(
id INTEGER PRIMARY KEY AUTOINCREMENT,
task_id INTEGER,
status  INTEGER,
receiver TEXT NULL,
title TEXT NULL,
content TEXT NULL,
record_time TEXT NULL
)