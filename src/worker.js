const fs = require('fs');
const path = require('path');
const xxh = require('xxhashjs');

var args = [];
process.on('message', ({ test, solutionPath, transformPath }) => {
  switch (test.stage) {
    case 'transform': {
      const transform = require(path.join('../', transformPath));

      const rs = fs.createReadStream(test.inputPath);
      rs.setEncoding('UTF8');

      let inputString = '';
      rs.on('data', chunk => {
        inputString += chunk;
      });

      rs.on('end', () => {
        inputString = inputString
          .replace(/\s*$/, '')
          .split('\n')
          .map(str => str.replace(/\s*$/, ''));

        args = transform(inputString);
        process.send({
          stage: 'compute',
          msg: 'Computing',
        });
      });
      break;
    }

    case 'compute': {
      const solution = require(path.join('../', solutionPath));

      const tmpLog = console.log;

      let consoleLog = [];
      console.log = (...logArgs) => {
        consoleLog.push(logArgs);
      };

      const startTime = Date.now();

      const result = solution(...args);
      
      const finishTime = Date.now();

      console.log = tmpLog;

      const testHash = xxh.h32(result, 0xabcd).toString(16);

      process.send({
        testHash,
        consoleLog,
        memory: process.memoryUsage(),
        time: finishTime - startTime,
        stage: null,
        msg: testHash === test.hash ? 'Pass' : 'Fail',
      });
      process.disconnect();
      break;
    }

    default: {
      process.send({
        stage: 'transform',
        msg: 'Transforming input',
      });
      break;
    }
  }
});
