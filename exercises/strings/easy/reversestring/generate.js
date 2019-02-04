const { Readable } = require('stream');

var streams = [];

const rs1 = new Readable();
rs1._read = () => {
    rs1.push('123\n');
    rs1.push(null);
};
streams.push(rs1);

const rs2 = new Readable();
rs2._read = () => {
    rs2.push('abc\n');
    rs2.push(null);
};
streams.push(rs2);


module.exports = streams;