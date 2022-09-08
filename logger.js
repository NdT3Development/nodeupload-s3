/*
Project Name: NodeUpload-S3
Project Developer: TrueWinter
Project GitHub: https://github.com/TrueWinter/nodeupload-s3

Project License:
MIT License

Copyright (c) 2020 TrueWinter

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

var path = require('path');
var fs = require('fs');
var moment = require('moment');
var config = require('./config.json');
//console.log(moment().format());

exports.console = function (f, m) {
	console.log(f.logFormat.replace('{{ time }}', moment().format()).replace('{{ log }}', m));
};
exports.file = function (f, m) {
	if (!config.logs.enable) return;
	var dir;
	var p;

	function log() {
		setTimeout(function () {
			var file = fs.createWriteStream(p, {flags: 'a'});
			file.write(f.logFormat.replace('{{ time }}', moment().format()).replace('{{ log }}', m) + '\n');
			//console.log(p);
		}, 50);
	}

	if (f.dir) {
		dir = path.join(__dirname, f.dir);
		fs.access(dir, function(err) {
			if (err && err === 'ENOENT') {
				console.log("Creating logs directory now...");
				fs.mkdir(dir, function(err) {
					if (err) {
						return console.error("Error " + err);
					}
				});
			}

		});

		p = path.join(dir, f.file);
		log();
	} else {
		p = path.join(__dirname, f.file);
		log();
	}
};

exports.both = function(f, m) {
	exports.console(f, m);
	exports.file(f, m);
}
