# hexadraw

## Description

Currently it's a collaborative canvas, with more future plans

## How to run

First, make sure you have redis running

- Run `npm install` to install all dependencies
- Run this inside a node terminal to get a token secret: `require('crypto').randomBytes(64).toString('hex')`
- Create a file called `.env` in the same directory then paste this inside (replacing <secret> with the secret generated from the previous step): `TOKEN_SECRET=<secret>`
- If you need to make any changes to the redis configuration, also use the `.env` file with key `REDIS_URL` using the redis URL format: https://www.npmjs.com/package/redis#options-object-properties
- Run `node index.js` to start the program
