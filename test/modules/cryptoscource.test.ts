'use strict';
import {CryptoSource} from '../../src/modules/cryptosource'
const expect = require('expect.js');
describe('Module CryptoSource', function(){
    const crytocource=new CryptoSource()
    it('encrypt', function(){
        const encry=crytocource.encrypt("test")
        console.log(encry)
        expect(encry).to.be.an('object');
    });
    it('decrypt', function(){
        const encry=crytocource.encrypt("test decrypt")
        const decry=crytocource.decrypt(encry)
        console.log(decry)
        expect(decry).to.be.an('string');
    });
});