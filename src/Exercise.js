const fs = require('fs');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');

const xxh = require('xxhashjs');
const cpusCount = 2; //require('os').cpus().length;
const { fork } = require('child_process');

const { mkDirByPathSync, repeat } = require('./utils.js');

module.exports = class Exercise {
    constructor(exercisePath, testCases) {
        let pathArr = exercisePath.split(path.sep);

        this.path = exercisePath;
        this.name = pathArr.pop();
        this.level = pathArr.pop();
        this.section = pathArr.pop();
        this.testCases = testCases;

        this._status = null;
        this._activeWorkers = 0;
        this._w = 60; //screen width
        this._currentScreen = [];
        this._renderImmediate = null;

        //spinner
        this._spinnerFrames = [' ', '-', '\\', '|', '/'];
        this._currentFrame = this._spinnerFrames[0];
        this._spinnerInterval = null;

        this.printTests = false;
        this._testsGenerator = null;
        this._activeWorkers = 0;

        this.ready = this.generateInputs()
            .then(this.populateTestCases.bind(this))
            .then(this.calculateHashes.bind(this))
            .then(() => {
                this.status = 'Ready to go!';
                this.printTests = true;
            });
    }

    //status getter
    get status() {
        return this._status;
    }

    //status setter
    set status(value) {
        this._status = value;
        this._render();

        //non null status means we are doing something
        //update spinner and call _render() in this case
        if (value !== null) {
            if (this._spinnerInterval === null) {
                this._spinnerInterval = setInterval(() => {
                    let currentFrameIndex = this._spinnerFrames.indexOf(
                        this._currentFrame
                    );
                    currentFrameIndex =
                        currentFrameIndex < this._spinnerFrames.length - 1
                            ? currentFrameIndex + 1
                            : 0;
                    this._currentFrame = this._spinnerFrames[currentFrameIndex];
                    this._render();
                }, 100);
            }
        } else {
            clearInterval(this._spinnerInterval);
            this._spinnerInterval = null;
            this._currentFrame = this._spinnerFrames[0];
        }
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
                newScreen.push('⡏' + repeat('⠉', this._w - 2) + '⢹');

                let spaces = this._w - 20 - this.name.length;
                newScreen.push(
                    '⡇  Exercise: ' +
                        chalk.bold(this.name) +
                        repeat(' ', spaces) +
                        chalk.bgCyan('CSJS') +
                        '  ⢸'
                );

                spaces = this._w - 22 - this.section.length - this.level.length;
                newScreen.push(
                    `⡇  Section: ${this.section}; level: ${this.level}` +
                        repeat(' ', spaces) +
                        '⢸'
                );
                newScreen.push('⣇' + repeat('⣀', this._w - 2) + '⣸');

                if (this.status !== null) {
                    spaces = this._w - this.status.length - 5;
                    newScreen.push(
                        '⡇ ' +
                            this._currentFrame +
                            ' ' +
                            this.status +
                            repeat(' ', spaces) +
                            '⢸'
                    );
                    newScreen.push(repeat('⠉', this._w));
                } else {
                    newScreen.push('');
                    newScreen.push('');
                }

                newScreen.push('Test cases');

                for (let { tName, msg } of this._testsGenerator()) {
                    if (msg === undefined) {
                        newScreen.push(tName);
                    } else {
                        let dots = this._w - tName.length - msg.length;
                        newScreen.push(
                            `${tName}${repeat('.', dots)}${msg}`
                        );
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

    //returns exercise's paths
    getPath(which) {
        switch (which) {
            case 'tests':
            case 'solutions':
                return path.join(this.path, which);
            case 'generate':
                return path.join(this.path, 'generate.js');
            case 'transform':
                return path.join(this.path, 'transform.js');
            default:
                return this.path;
        }
    }

    //reads streams from generate.js and checks tests folder for generated inputs
    //if no input for a test case found generates it from provided read stream
    //returns promise
    generateInputs() {
        this.status = 'Generating inputs';
        const rstreams = require(path.join('../', this.getPath('generate')));

        let promises = [];
        rstreams.forEach((rs, i) => {
            promises.push(
                new Promise(resolve => {
                    const testNum = String(i + 1);
                    const testFolder = path.join(
                        this.getPath('tests'),
                        testNum
                    );
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
    Prepare tests
    Tests are stored as a linked list in memory: each test stores a link to the next test in the list.
    Each test is a JS proxy object - this allows to call _render() each time a test property is updated.
    Generator function this._testsGenerator() is used to iterate throught tests
    */
    populateTestCases() {
        this.status = 'Populating tests';


        const _render = this._render.bind(this);
        this.handler = {
            set(target, key, value) {
                _render();
                return Reflect.set(target, key, value);
            },
        };

        const testFolder = this.getPath('tests');

        let prev = null;
        let start = null;
        fs.readdirSync(testFolder)
            .filter(
                tName =>
                    (this.testCases === undefined ||
                        this.testCases.includes(tName)) &&
                    fs.lstatSync(path.join(testFolder, tName)).isDirectory()
            )
            .forEach(tName => {
                const test = new Proxy(
                    {
                        tName,
                        inputPath: path.join(testFolder, tName, 'input.txt'),
                        hashPath: path.join(testFolder, tName, 'hash.txt'),
                        next: null,
                    },
                    this.handler
                );

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

    /*

    */
    calculateHashes() {
        this.status = 'Calculating hashes';
        const tests = this._testsGenerator();

        return new Promise(resolve => {
            const exitCallback = finishedTest => {
                finishedTest.hash = finishedTest.testHash;

                fs.writeFileSync(
                    finishedTest.hashPath,
                    finishedTest.hash,
                    'utf8'
                );

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
                        test.hash = fs.readFileSync(test.hashPath);
                        continue;
                    }

                    this._forkWorker(test, 'index', exitCallback);
                }
            };

            //fork as many workers as many CPUs we have
            for (let i = 1; i <= cpusCount; i++) {
                const { value: test, done } = tests.next();

                if (done) break;

                if (fs.existsSync(test.hashPath)) {
                    test.hash = fs.readFileSync(test.hashPath, {
                        encoding: 'utf8',
                    });
                    continue;
                }

                this._forkWorker(test, 'index', exitCallback);
            }

            if (this._activeWorkers === 0) {
                resolve();
            }
        });

        /*       
         const solution = path.join(this.getPath('solutions'), 'index.js');

        const rstreams = require(path.join('../', this.getPath('generate')));

        let promises = [];

        const testsGenerator = this._testsGenerator();
        for (let i = 1; i <= cpusCount; i++) {
            const { value: test, done } = testsGenerator.next();
            if (done) break;
            forkWorker(test);
        }

        for (const test of this.tests) {
            if (test.consoleLog !== undefined) {
                test.consoleLog.forEach(args =>
                    console.log.apply(console, args)
                );
            }
        }

        this.tests.forEach((rs, i) => {
            promises.push(
                new Promise(resolve => {
                    const testNum = String(i + 1);
                    const testFolder = path.join(
                        this.getPath('tests'),
                        testNum
                    );
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

        return Promise.all(promises);*/
    }

    _forkWorker(test, solutionName, exitCallback) {
        this._activeWorkers++;
        const worker = fork('src/worker.js');
        /*
            For debugging call fork with args:
                const worker = fork('src/worker.js', [], {
                execArgv: ['--inspect-brk=9223'],
            });
        */

        const solutionPath = path.join(
            this.getPath('solutions'),
            solutionName + '.js'
        );
        const transformPath = this.getPath('transform');

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

    /*
    Main function of the Exercise class.
    It forks workers and runs the solution through all the test cases.
    Returns promise.
    */
    work(solutionName) {
        this.status = 'Working';
        const tests = this._testsGenerator();

        return new Promise(resolve => {
            const exitCallback = finishedTest => {
                const { value: test, done } = tests.next();
                if (!done) {
                    this._forkWorker(test, solutionName, exitCallback);
                } else if (this._activeWorkers === 0) {
                    this.status = null;
                    resolve();
                }
            };

            //fork as many workers as many CPUs we have
            for (let i = 1; i <= cpusCount; i++) {
                const { value: test, done } = tests.next();
                if (done) break;
                this._forkWorker(test, solutionName, exitCallback);
            }
        });
    }
};
