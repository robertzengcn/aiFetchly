'use strict';
import { assert } from 'console';
import {RemoteSource,Linkdata} from '../../src/modules/remotesource'
const expect = require('expect.js');
// mocha test test/modules --grep save-link-to-remote
describe('Module Remote', function(){
    const remoteSourceModel=new RemoteSource();
    it('save-link-to-remote', function(){
        let link:Linkdata={
        title:"test title",
        content:"test content",
        url:"test url",
        lang:"zh-cn",
        socialtask_id:1
        }
        remoteSourceModel.saveLinkremote(link).then((linkId)=>{
            // assert(linkId).toBeGreaterThan(0);
            console.log(linkId)
            expect(linkId).to.be.above(0);
        });
    });
    it('get-user-info', async function(){
        const userinfo=await remoteSourceModel.GetUserInfo().then(function (res) {
            
            console.log(res);
            return res;
        }).catch(function (error) {
            console.log(error)
        });
        console.log(userinfo)
        expect(userinfo).to.be.an('object');
    });
});