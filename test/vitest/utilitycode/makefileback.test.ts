'use strict';

import * as fs from 'fs';
import * as path from 'path';
import sourceMap from 'source-map';
import { expect, test } from 'vitest'

test('make-file-back', async function () {
 const relativePath = '.vite/build/background-Cv4Pvrjp.js';
  // const writepath='./tmp/example.ts'
  const absolutePath = path.resolve(relativePath);
  // // console.log(absolutePath)
  // fs.readFile(absolutePath, 'utf8', async (err, data) => {
  //   if (err) return console.error(err);

  //   const sourceMapData = data.split('//# sourceMappingURL=data:application/json;base64,')[1];
  //   const buff = new Buffer.from(sourceMapData, 'base64');
  //   const rawSourceMap = buff.toString('ascii');
  //   const consumer = new sourceMap.SourceMapConsumer(rawSourceMap);
  //   // const position = consumer.originalPositionFor({
  //   //   line: line,
  //   //   column: column
  //   // });
  //   // console.log(position);
  //   fs.writeFile(writepath, consumer.sourcesContent, function (err) {
  //     if (err) return console.log(err);
  //   });

  //   consumer.destroy();

  // });
await findOriginalPosition(absolutePath,176, 6041);
},500000)


async function findOriginalPosition(minifiedFile, line, column) {
  const rawSourceMap = JSON.parse(fs.readFileSync(`${minifiedFile}.map`, 'utf8'));
  const consumer = await new sourceMap.SourceMapConsumer(rawSourceMap);
  console.log(consumer.sourcesContent)
  const position = consumer.originalPositionFor({
    line: line,
    column: column
  });

  console.log(position);

  let sourceContext = '';
    if (position.source) {
      const sourceIndex = consumer.sources.indexOf(position.source);
      if (sourceIndex !== -1 && consumer.sourcesContent && consumer.sourcesContent[sourceIndex]) {
        const sourceLines = consumer.sourcesContent[sourceIndex].split('\n');
        if(position.line){
        const startLine = Math.max(0, position.line - 3);
        const endLine = Math.min(sourceLines.length, position.line + 3);
        
        sourceContext = sourceLines.slice(startLine, endLine).map((l, i) => {
          const lineNumber = startLine + i + 1;
          const isErrorLine = lineNumber === position.line;
          return `${isErrorLine ? '>' : ' '} ${lineNumber}: ${l}`;
        }).join('\n');
      }
      }
      console.log(sourceContext);
    }

  consumer.destroy();
}