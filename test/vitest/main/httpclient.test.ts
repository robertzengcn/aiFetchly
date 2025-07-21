'use strict';
import { expect, test } from 'vitest'
import { HttpClient } from "@/modules/lib/httpclient"
// const expect = require('expect.js');

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
