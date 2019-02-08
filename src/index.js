const fs = require('fs');
const path = require('path');

const Exercise = require('./Exercise.js');

const [, , exerciseName, solutionName] = process.argv;
if (exerciseName === undefined || solutionName === undefined) {
  console.log('Not enough params');
  console.log(
    'Call me like this: yarn start <exercise name> <solution name> [test case, test case... ]'
  );
  console.log('Test cases are optional');
  process.exit();
}

let [, , , , testCases] = process.argv;
if (testCases !== undefined) {
  testCases = testCases.split(',');
}

//Find exercise and create an instance
let Ex;
fs.readdirSync('exercises').some(name => {
  const sectionPath = path.join('exercises', name);
  return fs.readdirSync(sectionPath).some(name => {
    const levelPath = path.join(sectionPath, name);
    return fs.readdirSync(levelPath).some(name => {
      const exercisePath = path.join(levelPath, name);
      if (name === exerciseName) {
        Ex = new Exercise(exercisePath, testCases);
        return true;
      }
    });
  });
});

if (Ex === undefined) {
  console.log('No exercises found');
  process.exit();
}

//Here we go
Ex.init().then(Ex => Ex.work(solutionName));
