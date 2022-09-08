/*
Project Name: NodeUpload-S3
Project Developer: TrueWinter
Project GitHub: https://github.com/TrueWinter/nodeupload-s3

Project License:
MIT License

Copyright (c) 2017 TrueWinter

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var uuid = require('uuid');
var readline = require('readline');
var sqlite3 = require('sqlite3');
var configstrings = require('./strings.json');
var os = require('os');
var bcrypt = require('bcrypt');

var packagejson = require('./package.json');
var config = require('./config.json');
var logger = require('./logger.js').both;
var logConf = {
	dir: config.logs.dir,
	file: config.logs.file,
	logFormat: config.logs.format
};

function log(m) {
	logger(logConf, m);
}

function uuidToBase64(uuid) {
	var base64 = Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64');

	return base64
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
}

process.title = 'NodeUpload User Creation';
log(`NodeUpload S3 v${packagejson.version} User Creation \n Process ID: ${process.pid} \n Platform: ${os.type()} ${os.release()} ${os.arch()} ${os.platform()}`);
var db = new sqlite3.Database('./db/database.db', (err) => {
	if (err) {
		console.error(err.message);
	}
	log(configstrings.beforeStartConsole.dbConnect);
});

setTimeout(function () { // Because I don't know what else to do to stop it from trying to connect while asking questions and making the questions not work
	var rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	var email;
	var token;
	var tokenSecret;
	var enabled;
	log(configstrings.userCreate.userCreate);

	function startDB() {
		db.serialize(function() {
			db.run('CREATE TABLE IF NOT EXISTS tokens (email TEXT, token TEXT, tokenSecret TEXT, enabled TEXT)');

			db.all('SELECT * FROM tokens WHERE email = ?', email, function(err, allRows) {
				if (err) throw err;
				if (!allRows[0]) {
					var hashedSecret = bcrypt.hashSync(tokenSecret, 10);
					var stmt = db.prepare('INSERT INTO tokens (email, token, tokenSecret, enabled) VALUES (?, ?, ?, ?)');
					stmt.run(email, token, hashedSecret, enabled);
					stmt.finalize();
				} else {
					return log('Already exists in database');
				}
				db.close();
			});


		});

	}

	rl.question(configstrings.userCreate.email, function(answer) {

		email = answer;
		token = uuidToBase64(uuid.v4());
		tokenSecret = uuidToBase64(uuid.v4());
		enabled = true;

		log(configstrings.userCreate.output
			.replace('{{email}}', email)
			.replace('{{token}}', `${token}.${tokenSecret}`)
			.replace('{{enabled}}', enabled));

		rl.on('close', () => {
			startDB();
		});
		rl.close();

	});

}, 500);
