'use strict';
import {Videoedit} from '../../src/modules/videoedit';
const appRoot = require('app-root-path');
import * as path from "path";

describe('Module Watermark', function(){
    this.timeout(0);
    it('remove-watermark', function(){
        const originvideo=path.resolve(appRoot+'/test/data/test_watermark.mp4');
        const outputvideo=path.resolve(appRoot+'/test/output/test_watermark_output.mp4');
        const videoedit = new Videoedit();
        videoedit.removeWatermark(originvideo,outputvideo,0,null);
    });
});