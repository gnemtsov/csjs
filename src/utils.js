const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';

module.exports.CLEAR = isWindows ? '\x1B[2J\x1B[0f' : '\x1B[2J\x1B[3J\x1B[H';
module.exports.ARROW = ' \u203A ';
module.exports.ICONS = {
  failed: isWindows ? '\u00D7' : '\u2715',
  pending: '\u25CB',
  success: isWindows ? '\u221A' : '\u2713',
};

module.exports.mkDirByPathSync = dir => {
  const sep = path.sep;
  const initDir = path.isAbsolute(dir) ? sep : '';

  dir.split(sep).reduce((parentDir, childDir) => {
    const curDir = path.resolve('.', parentDir, childDir);
    if (!fs.existsSync(curDir)) {
      fs.mkdirSync(curDir);
    }
    return curDir;
  }, initDir);
};

module.exports.repeat = (str, n) => {
  let result = '';
  for (let i = 0; i < n; i++) {
    result += str;
  }
  return result;
};

module.exports.sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
