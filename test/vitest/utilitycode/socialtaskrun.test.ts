'use strict';
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SocialTaskRun } from '@/modules/socialtaskrun'
import { Taskrundb } from '@/model/taskrundb'

/**
 * SocialTaskRun.getrunlist smoke test against a real (throwaway) scraper.db.
 *
 * The test previously constructed `new SocialTaskRun()` with no dbpath —
 * `new Taskrundb("")` makes Scraperdb's constructor early-return with
 * `this.db` undefined, so getTaskrunTotal threw "Cannot read properties of
 * undefined (reading 'prepare')". getrunlist itself never touches Electron
 * paths (getApplogpath is only used by createsocialtaskrun), so a temp
 * directory + task_run table is the only fixture needed.
 */
describe('socialtaskrun', () => {
  let tmp: string

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'socialtaskrun-'))
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

    // Seed two runs for task 69 so the list has known content.
    const taskrundb = new Taskrundb(tmp)
    taskrundb.saveTaskrun({
      task_id: 69,
      taskrun_num: 'r-1',
      log_path: 'logfilepath',
    })
    taskrundb.saveTaskrun({
      task_id: 69,
      taskrun_num: 'r-2',
      log_path: 'logfilepath',
    })
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('get-task-run-list', () => {
    const stkrunModel = new SocialTaskRun(tmp)
    let callbackRows: number | null = null
    const res = stkrunModel.getrunlist(69, 0, 10, (rows) => {
      callbackRows = rows.length
      return rows
    })

    expect(res.Total).toBe(2)
    expect(res.Records.length).toBe(2)
    expect(res.Records[0].task_id).toBe(69)
    // Ordered by id desc — newest run first.
    expect(res.Records[0].taskrun_num).toBe('r-2')
    // Callback received the same rows.
    expect(callbackRows).toBe(2)
  })

  it('get-task-run-list for a task with no runs', () => {
    const stkrunModel = new SocialTaskRun(tmp)
    const res = stkrunModel.getrunlist(999, 0, 10)

    expect(res.Total).toBe(0)
    expect(res.Records).toEqual([])
  })
})
