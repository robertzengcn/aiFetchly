'use strict';
import { test} from 'vitest'
import {SocialTaskRun} from "@/modules/socialtaskrun"
test('get-task-run-list', async function () {
    const task_id=69
    const stkrunModel = new SocialTaskRun()
    const res = await stkrunModel.getrunlist(task_id,0,10)
    console.log(res)
    // console.log(res)
    
});