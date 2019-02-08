var fs = require('fs');
var path = require('path');
var readline = require('readline');
var chalk = require('chalk');
var cpus = require('os').cpus();
//const xxh = require('xxhashjs');
var { fork } = require('child_process');

var { mkDirByPathSync, repeat, sleep } = require('./utils.js');

module.exports = class Exercise {
  constructor(exercisePath, testCases) {
    this._path = exercisePath;
    this._testCases = testCases;
    this._testsGenerator = null;

    {
      let pathArr = this._path.split(path.sep);
      this._name = pathArr.pop();
      this._level = pathArr.pop();
      this._section = pathArr.pop();
    }

    this._status = 'Idle'; //general status (what is currently happening with the exercise)
    this._cpusCount = 2; //cpus.length; //number of CPUs available
    this._activeWorkers = 0; //number of forked workers which are currently running
    this._w = 60; //screen width
    this._currentScreen = []; //copy of the currently displayed screen (array with lines)
    this._renderImmediate = null; //setImmediate ID for the _render() function
  }

  //Initialize the exercise
  async init() {
    this._status = 'Generating test cases';
    await this._generateTests();

    this._status = 'Populating tests';
    await this._populateTests();

    this._status = 'Calculating hashes';
    await this._calculateHashes();

    return this;
  }

  //The main function of the Exercise class.
  //It forks workers and runs the solution through all the test cases.
  work(solutionName) {
    this._status = `Checking solution /${chalk.bold(solutionName)}`;
    const tests = this._testsGenerator();

    return new Promise(resolve => {
      //fork as many workers as many CPUs we have
      for (let i = 1; i <= this._cpusCount; i++) {
        const { value: test, done } = tests.next();
        if (done) break;
        this._forkWorker(test, solutionName, exitCallback.bind(this));
      }

      function exitCallback() {
        const { value: test, done } = tests.next();

        if (!done) {
          this._forkWorker(test, solutionName, exitCallback);
        } else if (this._activeWorkers === 0) {
          let solutionCheck = 'Pass';
          for (let { msg } of this._testsGenerator()) {
            if (msg === 'Fail') {
              solutionCheck = msg;
              break;
            }
          }

          if (solutionCheck === 'Pass') {
            this._status = chalk.green('Solution passed');
          } else {
            this._status = chalk.red('Solution failed');
          }
          resolve();
        }
      }
    });
  }

  //get exercise's paths
  _getPath(which) {
    switch (which) {
      case 'tests':
      case 'solutions':
        return path.join(this._path, which);
      case 'generate':
        return path.join(this._path, 'generate.js');
      case 'transform':
        return path.join(this._path, 'transform.js');
      default:
        return this._path;
    }
  }

  //exercise status getter
  get _status() {
    return this.__status;
  }

  //exercise status setter
  set _status(value) {
    this.__status = value;
    this._render();
  }

  //renders current exercise state
  //uses setImmediate() to update screen after current iteration of the event loop
  //it makes render wait until all current updates of data are finished
  //multiple calls of _render() within one event loop trigger only one render at the end
  _render() {
    if (this._renderImmediate === null) {
      this._renderImmediate = setImmediate(() => {
        //output is first collected in array (each line is an array element)
        let newScreen = [];

        //header
        newScreen.push('⡏' + repeat('⠉', this._w - 2) + '⢹');

        {
          const line = [
            '⡇  ',
            `Exercise: ${chalk.bold(this._name)}`,
            repeat(' ', this._w - 20 - this._name.length),
            chalk.bgCyan('CSJS'),
            '  ⢸',
          ];
          newScreen.push(line.join(''));
        }

        {
          const line = [
            '⡇  ',
            `Section: ${this._section}; `,
            `level: ${this._level}`,
            repeat(
              ' ',
              this._w - 22 - this._section.length - this._level.length
            ),
            '⢸',
          ];
          newScreen.push(line.join(''));
        }

        newScreen.push('⠧' + repeat('⠤', this._w - 2) + '⠼');

        //status bar
        newScreen.push(`   ${this._status}`);
        newScreen.push(repeat('⠶', this._w));
        newScreen.push('');

        //test cases
        if (typeof this._testsGenerator === 'function') {
          newScreen.push('Test cases');

          for (let { name, msg } of this._testsGenerator()) {
            if (msg === undefined) {
              newScreen.push(name);
            } else {
              let dots = repeat('.', this._w - name.length - msg.length);
              newScreen.push(`${name}${dots}${msg}`);
            }
          }
        }

        //print output updating only changed lines
        //TODO update only changed part of each line
        if (this._currentScreen.length === 0) {
          newScreen.forEach(line => {
            process.stdout.write(line + '\n');
          });
        } else {
          newScreen.forEach((line, i) => {
            if (this._currentScreen[i] !== line) {
              readline.cursorTo(process.stdout, 0, i);
              readline.clearLine(process.stdout, 1);
              process.stdout.write(line + '\n');
            }
          });
        }

        //save current screen
        this._currentScreen = newScreen;

        //place cursor at the end of the output, clear remainings
        readline.cursorTo(process.stdout, 0, this._currentScreen.length);
        readline.clearScreenDown(process.stdout);

        this._renderImmediate = null;
      });
    }
  }

  //reads streams from generate.js and checks tests folder for generated inputs
  //if no input for a test case found generates it from provided read stream
  //returns promise
  _generateTests() {
    var rstreams = require(path.join('../', this._getPath('generate')));

    var promises = [];
    rstreams.forEach((rs, i) => {
      promises.push(
        new Promise(resolve => {
          const testNum = String(i + 1);
          const testFolder = path.join(this._getPath('tests'), testNum);
          const inputFile = path.join(testFolder, 'input.txt');

          if (fs.existsSync(inputFile)) {
            resolve();
          } else {
            mkDirByPathSync(testFolder);
            const ws = fs.createWriteStream(inputFile);
            rs.on('end', resolve);
            rs.pipe(ws);
          }
        })
      );
    });

    return Promise.all(promises);
  }

  /*
    Prepare tests linked list
    Tests are stored as a linked list in memory: each test stores a link to the next test in the list.
    Each test is a JS proxy object - this allows to call _render() each time a test property is updated.
    Generator function this._testsGenerator() is used to iterate throught tests
    */
  _populateTests() {
    const testFolder = this._getPath('tests');
    var _render = this._render.bind(this);

    //proxy handler object
    var handler = {
      set(target, key, value) {
        _render();
        return Reflect.set(target, key, value);
      },
    };

    return new Promise(resolve => {
      fs.readdir(testFolder, { withFileTypes: true }, (err, dirents) => {
        dirents = dirents.filter(ent => ent.isDirectory());

        if (this._testCases !== undefined) {
          dirents = dirents.filter(({ name }) =>
            this._testCases.includes(name)
          );
        }

        //create an array of test proxies
        let tests = dirents.map(
          ({ name }) =>
            new Proxy(
              {
                name,
                inputPath: path.join(testFolder, name, 'input.txt'),
                hashPath: path.join(testFolder, name, 'hash.txt'),
                next: null,
              },
              handler
            )
        );

        //build the linked list and setup tests generator
        {
          let prev = null;
          let start = null;
          tests.forEach(test => {
            prev === null ? (start = test) : (prev.next = test);
            prev = test;
          });

          this._testsGenerator = function*() {
            let current = start;
            while (current) {
              yield current;
              current = current.next;
            }
          };
        }

        resolve();
      });
    });
  }

  /*
    Calculate and fill in hash property for each test case
    The hash is calculated based on the correct output for the test case
    If the hash was calculated before it is just read from the file
    */
  _calculateHashes() {
    var tests = this._testsGenerator();

    return new Promise(resolve => {
      //initially fork as many workers as many CPUs we have
      for (let i = 1; i <= this._cpusCount; i++) {
        const { value: test, done } = tests.next();

        if (done) break;

        //if hash exists read it from the disk and skip forking of a worker
        if (fs.existsSync(test.hashPath)) {
          test.hash = fs.readFileSync(test.hashPath, {
            encoding: 'utf8',
          });
          continue;
        }

        this._forkWorker(test, 'index', exitCallback.bind(this));
      }

      //if no workers were forked resolve
      if (this._activeWorkers === 0) {
        resolve();
      }

      //this callback executes when a worker finishes hash calculation
      function exitCallback(finishedTest) {
        finishedTest.hash = finishedTest.testHash;

        fs.writeFileSync(finishedTest.hashPath, finishedTest.hash, 'utf8');

        delete finishedTest.testHash;
        delete finishedTest.consoleLog;
        delete finishedTest.memoryUsage;
        delete finishedTest.stage;
        delete finishedTest.msg;

        let flag = true;
        while (flag) {
          const { value: test, done } = tests.next();

          if (done) {
            if (this._activeWorkers === 0) {
              resolve();
            }
            break;
          }

          if (fs.existsSync(test.hashPath)) {
            test.hash = fs.readFileSync(test.hashPath, {
              encoding: 'utf8',
            });
            continue;
          }

          this._forkWorker(test, 'index', exitCallback.bind(this));
        }
      }
    });
  }

  /*
    Fork a worker child process and run callback when it is finished
    For debugging fork with args:
        const worker = fork('src/worker.js', [], {
        execArgv: ['--inspect-brk=9223'],
    });
    */
  _forkWorker(test, solutionName, exitCallback) {
    this._activeWorkers++;
    var worker = fork('src/worker.js');

    const solutionPath = path.join(
      this._getPath('solutions'),
      solutionName + '.js'
    );
    const transformPath = this._getPath('transform');

    worker.send({ test, solutionPath, transformPath });

    worker.on('message', data => {
      Object.assign(test, data);
      if (test.stage !== null) {
        setTimeout(
          () =>
            worker.send({
              test,
              solutionPath,
              transformPath,
            }),
          2000
        );
      }
    });

    worker.on('exit', () => {
      this._activeWorkers--;
      exitCallback(test);
    });

    return worker;
  }
};
