'use strict';
import { test} from 'vitest'
import {SocialTaskRun} from "@/modules/socialtaskrun"
test('get-task-run-list', async function () {
    const task_id=69
    const stkrunModel = new SocialTaskRun()
    stkrunModel.getrunlist(task_id,0,10,function(res:any){
       console.log(res) 
       return res
    })
    console.log("return data")
    // console.log(res)
    
});