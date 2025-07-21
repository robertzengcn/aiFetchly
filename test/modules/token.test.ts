'use strict';
import { Token } from "../../src/modules/token";
// const expect = require('expect.js');
describe('Module Token', function(){
    const tokenmodel=new Token();
    it('set-token', function(){
        tokenmodel.setValue("token","test token");
    });
    it('get-token', async function(){
        tokenmodel.setValue("token","test token");
        const token =await tokenmodel.getValue("token");
        console.log(token);
    });
    // it('check-encry-available', function(){
    //     const availe=tokenmodel.checkEncryavaile("token");
    //     console.log(availe);
        
    // });

})