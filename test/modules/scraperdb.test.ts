'use strict';
import {Scraperdb} from '../../src/model/scraperdb'

describe('Module Scraperdb', function(){
    const dbpath=""
    const scraperdb=Scraperdb.getInstance(dbpath);
    it('init', function(){
        scraperdb.init();
    });

    it('save-video-data', function(){
        const url="www.bilibili.com/video/BV1be411p7Dp/"
        const title="搬运|#199 - Monkey Sex Traffickers _ The Tim Dillon Show"
        const description="test test test"
        const language="zh-cn"
        const locapah="~/tmp/video/test.mp4"
        // scraperdb.saveVideo(url,locapah,title,description,language);
    });
    it('truncate-data', function(){
        // scraperdb.truncatedb();
    });


});