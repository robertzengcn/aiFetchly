CREATE TABLE IF NOT EXISTS emailsearch_task_proxy(
id INTEGER PRIMARY KEY AUTOINCREMENT,
email_search_task_id INTEGER NOT NULL,
proxy_id INTEGER NOT NULL,
is_active BOOLEAN DEFAULT 1,
notes TEXT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (email_search_task_id) REFERENCES emailsearch_task(id) ON DELETE CASCADE,
FOREIGN KEY (proxy_id) REFERENCES proxy(id) ON DELETE CASCADE,
UNIQUE(email_search_task_id, proxy_id)
) 
 