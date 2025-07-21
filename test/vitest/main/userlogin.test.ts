'use strict';
import { UserController,userlogin } from '@/controller/UserController';
import {  test } from 'vitest'

test('user-login', async function () {
    const userCon=new UserController()
    const data:userlogin={
        user:'test@test.com',
        pass:'testlala123'
    }

    await userCon.login(data)
},500000)