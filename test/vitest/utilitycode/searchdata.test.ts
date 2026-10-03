'use strict';
import { describe, expect, it, vi, beforeEach } from 'vitest'

// ScrapeManager launches a real Puppeteer cluster against the live search
// engine — no place in a unit test. Stub the class and capture the
// SearchDataParam it receives so the engine mapping stays observable.
const searchdataMock = vi.fn().mockResolvedValue([])
vi.mock('@/childprocess/scrapeManager', () => {
  return {
    ScrapeManager: class {
      constructor() {
        return { searchdata: searchdataMock }
      }
    },
  }
})

import { UserSearch } from '@/childprocess/userSearch'
import { Usersearchdata } from '@/entityTypes/searchControlType'
import { CustomError } from '@/modules/customError'

/**
 * UserSearch.searchData engine contract (src/childprocess/userSearch.ts:69-81):
 *
 * The production caller (SearchModule.getTaskEntityById) passes the DB
 * enginer_id as a NUMERIC STRING ("1" | "2" | "3" — the SearhEnginer enum
 * values). UserSearch maps it back to the engine NAME ("Google" | "Bing" |
 * "Yandex") before delegating to ScrapeManager.searchdata, which itself
 * lowercases the name. Anything non-numeric (or out of range) throws a
 * CustomError before any browser work starts.
 *
 * This file previously passed `searchEnginer: "Google"` (a name) and a
 * 500s timeout while really scraping Google — the contract changed to
 * numeric strings and the test never followed, so it always threw
 * "search enginer is incorrect:Google" immediately.
 */
describe('user-search', () => {
  beforeEach(() => {
    searchdataMock.mockClear()
  })

  const baseData: Usersearchdata = {
    searchEnginer: '1',
    keywords: ['Williams', 'doctor'],
    notShowBrowser: false,
    num_pages: 1,
    concurrency: 1,
  }

  it('maps numeric engine id 1 to Google and forwards to ScrapeManager', async () => {
    const userSer = new UserSearch()
    await userSer.searchData({ ...baseData, searchEnginer: '1' })

    expect(searchdataMock).toHaveBeenCalledTimes(1)
    expect(searchdataMock.mock.calls[0][0].engine).toBe('Google')
    expect(searchdataMock.mock.calls[0][0].keywords).toEqual([
      'Williams',
      'doctor',
    ])
  })

  it('maps numeric engine id 2 to Bing', async () => {
    const userSer = new UserSearch()
    await userSer.searchData({ ...baseData, searchEnginer: '2' })

    expect(searchdataMock.mock.calls[0][0].engine).toBe('Bing')
  })

  it('maps numeric engine id 3 to Yandex', async () => {
    const userSer = new UserSearch()
    await userSer.searchData({ ...baseData, searchEnginer: '3' })

    expect(searchdataMock.mock.calls[0][0].engine).toBe('Yandex')
  })

  it('throws CustomError for a non-numeric engine value', async () => {
    const userSer = new UserSearch()

    await expect(
      userSer.searchData({ ...baseData, searchEnginer: 'Google' })
    ).rejects.toThrow(CustomError)

    // Rejected before any scraping work started.
    expect(searchdataMock).not.toHaveBeenCalled()
  })

  it('throws CustomError for an out-of-range numeric engine value', async () => {
    const userSer = new UserSearch()

    await expect(
      userSer.searchData({ ...baseData, searchEnginer: '99' })
    ).rejects.toThrow(CustomError)

    expect(searchdataMock).not.toHaveBeenCalled()
  })
})
