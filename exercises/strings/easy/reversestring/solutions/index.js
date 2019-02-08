module.exports = str => {
    console.log('Solution executed');
    let ar = str.split('');
    const count = ar.length;

    var start = Date.now(),
        now = start;
    while (now - start < 1000) {
      now = Date.now();
    }


    ar.some((letter, i) => {
        const pair = count - i;
        if (i < pair) {
            ar[i] = ar[pair];
            ar[pair] = letter;
        } else {
            return true;
        }
    });

    return ar.join('');
};
