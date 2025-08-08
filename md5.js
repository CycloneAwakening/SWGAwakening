import crypto from 'crypto';
import fs from 'fs';

export function md5(file, cb) {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(file);
    stream.on('data', data => hash.update(data, 'utf8'));
    stream.on('end', () => cb(hash.digest('hex')));
}

if (process.argv[2]) {
    md5(process.argv[2], console.log);
    console.log('Size:', fs.statSync(process.argv[2]).size);
}