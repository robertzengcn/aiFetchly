'use strict';
import { UserController } from '@/controller/UserController';
import { test, describe, expect } from 'vitest'

describe('UserController', () => {
    test('should be defined', () => {
        expect(UserController).toBeDefined();
    });

    // Note: Actual login test is disabled as it requires a running server
    // and proper authentication setup.
    /*
    test('user-login', async function () {
        const userCon = new UserController()
        const data: userlogin = {
            user: 'test@test.com',
            pass: 'testlala123'
        }

        await userCon.login(data)
    }, 500000)
    */
});
