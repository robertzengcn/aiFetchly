'use strict';
import { VideoController } from '@/controller/VideoController';
import {  test,expect } from 'vitest'

test('video-download', async function () {
    const videoCtrl=new VideoController()
    const res=await videoCtrl.videoDownloadtasklist(1,10)
    console.log(res)
expect(res).toBeDefined()
expect(Array.isArray(res.records)).toBe(true)
expect(typeof res.num).toBe('number')
expect(res.records.length).toBeLessThanOrEqual(10)

   
},500000)