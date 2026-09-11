'use strict';
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Taskrundb } from '@/model/taskrundb'
import { TaskRunEntity } from '@/entityTypes/taskrun-type'

/**
 * Taskrundb smoke tests against a real (throwaway) scraper.db.
 *
 * These tests previously constructed `new Taskrundb("")` — the empty
 * filepath makes Scraperdb's constructor early-return with `this.db`
 * undefined, so every `.prepare` call threw. They now create a unique
 * temp directory with the task_run table (same DDL the app ships in
 * src/sql/scraperdb/task_run.sql) and run the real better-sqlite3 code.
 */
describe('taskrundb', () => {
  let tmp: string
  let taskrundb: Taskrundb

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taskrundb-'))
    // Create the task_run table before the first Taskrundb use. Scraperdb
    // opens (creating) scraper.db inside the directory.
    const Database = require('better-sqlite3')
    const raw = new Database(path.join(tmp, 'scraper.db'))
    raw.exec(
      `CREATE TABLE IF NOT EXISTS task_run(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        taskrun_num TEXT NULL,
        log_path TEXT NULL,
        record_time TEXT NULL
      )`
    )
    raw.close()
    taskrundb = new Taskrundb(tmp)
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('insert-task-result-db', () => {
    const taskrun: TaskRunEntity = {
      task_id: 1,
      taskrun_num: '1',
      log_path: 'logfilepath',
    }

    const callbackRowId = taskrundb.saveTaskrun(taskrun, (info) => {
      expect(info).toBeGreaterThan(0)
    })

    // Row was inserted and both the callback and return value report its id.
    expect(Number(callbackRowId)).toBeGreaterThan(0)
  })

  it('get-task-run-list', () => {
    const inserted = taskrundb.saveTaskrun({
      task_id: 69,
      taskrun_num: 'r-1',
      log_path: 'logfilepath',
    })
    expect(Number(inserted)).toBeGreaterThan(0)

    const list = taskrundb.getTaskrunlist(69, 0, 10, (reslist) => {
      // Callback receives the same rows as the return value.
      expect(reslist.length).toBeGreaterThan(0)
    })

    expect(list.length).toBeGreaterThan(0)
    expect(list[0].task_id).toBe(69)
    expect(list[0].taskrun_num).toBe('r-1')
  })

  it('getTaskrunTotal counts rows for a task', () => {
    taskrundb.saveTaskrun({ task_id: 70, taskrun_num: 'a', log_path: 'l' })
    taskrundb.saveTaskrun({ task_id: 70, taskrun_num: 'b', log_path: 'l' })

    expect(taskrundb.getTaskrunTotal(70)).toBe(2)
    expect(taskrundb.getTaskrunTotal(999)).toBe(0)
  })
})
