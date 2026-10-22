#!/usr/bin/env node
// Prints a password hash in the format stored in admins.password_hash.
// Usage (recommended, keeps the password out of shell history):
//   node scripts/hash-password.js            then type the password and press Enter
// or:
//   node scripts/hash-password.js '<password>'
const { hashPassword } = require('../api/_lib/crypto');

async function main() {
  let pw = process.argv[2];
  if (pw === undefined) {
    process.stderr.write('Password: ');
    pw = await new Promise(resolve => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', d => {
        buf += d;
        const i = buf.search(/\r?\n/);
        if (i >= 0) { process.stdin.pause(); resolve(buf.slice(0, i)); }
      });
      process.stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
    });
  }
  if (typeof pw !== 'string' || pw.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  console.log(await hashPassword(pw));
}

main();
