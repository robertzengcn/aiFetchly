'use strict';
import { expect, test, vi, describe } from 'vitest'

// Mock Electron app before importing HttpClient
// Must use inline factory function because vi.mock is hoisted
vi.mock('electron', () => ({
    app: {
        getName: vi.fn(() => 'aiFetchly'),
        getPath: vi.fn(() => '/tmp/test'),
    },
    BrowserWindow: vi.fn(),
}));

import { HttpClient } from "@/modules/lib/httpclient"

describe('HttpClient', () => {
    test('should be instantiated', async function () {
        const httpclientModel = new HttpClient();
        expect(httpclientModel).toBeDefined();
        expect(httpclientModel).toBeInstanceOf(HttpClient);
    });

    // Note: The actual API call test is disabled as it requires a running server
    // and proper authentication. This test only verifies instantiation.
    /*
    test('test-send', async function () {
        const httpclientModel = new HttpClient();
        const username = "test";
        const password = "test";
        const FormData = require('form-data');
        const data = new FormData();
        data.append('username', username);
        data.append('password', password);
        const res=await httpclientModel.post("/user/login", data)
        console.log(res)
        expect(res).to.be.an('object');
    })
    */
});

