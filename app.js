/*
Project Name: NodeUpload S3
Project Developer: NdT3Development
Project GitHub: https://github.com/NdT3Development/nodeupload
Project Info: https://github.com/NdT3Development/nodeupload#node-upload

Project License:
MIT License

Copyright (c) 2017 NdT3Development

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


var formidable = require('formidable'); // File upload
var express = require('express'); // Web server
//var util = require('util'); // Used for response
var fs = require('fs'); // Used to move files
var path = require('path'); // Used to get file directory
var crypto = require('crypto'); // Used to generate file name
var os = require('os'); // Used to get OS tmp directory
var RateLimit = require('express-rate-limit'); // Time to ratelimit...
var sqlite3 = require('sqlite3'); // Database
var mime = require('mime');
//var createServer = require("auto-sni");

var config = require('./config.json'); // Config file
var logger = require('./logger.js').both; // Custom logger
var logConf = {
	dir: config.logs.dir,
	file: config.logs.file,
	logFormat: config.logs.format
};
var s3 = require('s3-client');

var client = s3.createClient({
	maxAsyncS3: 20, // this is the default
	s3RetryCount: 3, // this is the default
	s3RetryDelay: 1000, // this is the default
	multipartUploadThreshold: 20971520, // this is the default (20 MB)
	multipartUploadSize: 15728640, // this is the default (15 MB)
	s3Options: {
		accessKeyId: config.s3.s3_accessKeyId,
		secretAccessKey: config.s3.s3_secretAccessKey,
		region: config.s3.s3_region,
		endpoint: config.s3.s3_endpoint,
		// sslEnabled: false
		// any other options are passed to new AWS.S3()
		// See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property
	},
});

var filesInS3 = [];
var stillWaitingForS3 = true;

client.listObjects({ s3Params: { Bucket: config.s3.bucket } }).on('data', function(data) {
	var s3Objects = data.Contents;
	for (var i = 0; i < s3Objects.length; i++) {
		console.log(s3Objects[i].Key);
		filesInS3.push(s3Objects[i].Key);
	}
}).on('end', function() {
	stillWaitingForS3 = false;
});

function log(m) {
	logger(logConf, m);
}
var packagejson = require('./package.json');
var configstrings = require('./strings.json'); // Strings
process.title = 'NodeUpload';
log(`NodeUpload v${packagejson.version} \n Process ID: ${process.pid} \n Platform: ${os.type()} ${os.release()} ${os.arch()} ${os.platform()} \n Temporary Directory Location: ${path.join(os.tmpdir(), 'nodeupload_tmp')}`);
// Command line args for testing purposes.
var commandargs = process.argv.splice(2);
var command2 = commandargs[0];
if (command2 === 'test') {
	log('Running for 10 seconds');
	setTimeout(function () {
		log(configstrings.beforeStartConsole.done);
		process.exit(0);
	}, 10000);
}

var tmpFileDir = `${os.tmpdir()}/nodeupload_tmp/`;
fs.access(tmpFileDir, function(err) {
	if (err) {
		log(configstrings.beforeStartConsole.noTMP);
		fs.mkdir(tmpFileDir, function(err) {
			if (err) {
				return console.error(configstrings.beforeStartConsole.tmpDirFail.replace('{{err}}', err));
			} //else {
			//  log('Temporary directory exists. Ready to go.')
			//}
		});
	} else {
		log(configstrings.beforeStartConsole.tmpExists);
	}
});

var app = express();

app.set('trust proxy', '127.0.0.1');

//app.use(express.static('files')); // For serving files

var db = new sqlite3.Database('./db/database.db', (err) => {
	if (err) {
		console.error(err.message);
	}
	log(configstrings.beforeStartConsole.dbConnect);
});

var sqlAction = `SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'`;
// eslint-disable-next-line handle-callback-err
db.get(sqlAction, (err, row) => {
	if (!row) {
		log(configstrings.beforeStartConsole.dbNothing);
		db.close();
		setTimeout(function () {
			fs.unlinkSync(path.join(__dirname, './db/database.db'));
			process.exit(0);
		}, 500);

	}
});

process.on('SIGINT', function() {
	log('Please wait...');
	log('Closing database');
	db.close();
	setTimeout(function () { // Because why not
		log('Bye');
		setTimeout(function () {
			process.exit(0);
		}, 100);

	}, 500);
});

var apiRatelimiter = new RateLimit({
	windowMs: config.ratelimitTime, // 7.5 second window
	max: config.ratelimitAfter, // start blocking after 5 requests
	delayAfter: 0, // disable slow down of requests
	delayMs: 0,
	headers: true,
	handler: function (req, res) {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Retry-After', config.ratelimitAfter / 1000);
		log(configstrings.console.ratelimited.replace('{{ip}}', req.ip));
		res.status(429).json({ success: false, message: configstrings.webStrings.ratelimited });
	}
});

app.post('/upload', apiRatelimiter, function(req, res) {
	if (stillWaitingForS3) return res.json({ success: false, message: 'System temporarily unavailable, please try again later. If this issue does not resolve itself in a few minutes, please contact your system administrator.' });
	// parse a file upload
	var form = new formidable.IncomingForm();

	form.uploadDir = tmpFileDir; // Saves tmp files in tmp dir
	// eslint-disable-next-line handle-callback-err
	form.parse(req, function(err, fields, files) { // Parses form for upload
		var usertoken = '';

		if (fields.token) {
			usertoken = fields.token;
		} else {
			usertoken = req.headers.token;
		}

		function generateFileName(length) {
			return crypto.randomBytes(Math.ceil(length / 2))
				.toString('hex') // convert to hexadecimal format
				.slice(0, length); // return required number of characters
			//return '56c4a05603';
		}

		var thisFileNameGenerationCount = 0;
		function randomValueHex (length, fileExt) { // Generates random string for file name
			var tmpHex = generateFileName(length);

			if (filesInS3.indexOf(tmpHex + fileExt) > -1) {
				console.log('in');
				if (thisFileNameGenerationCount >= 3) {
					return null;
				} else {
					thisFileNameGenerationCount++;
					randomValueHex(length);
				}
			} else {
				thisFileNameGenerationCount = 0;
				return tmpHex;
			}
		}
		function startDB() {
			db.serialize(function() {
				log(usertoken);
				db.all(`SELECT token, enabled FROM tokens WHERE token = '${usertoken}'`, function(err, allRows) {

					if (err !== null) {
						return log(err);
					}

					if (!allRows[0]) {
						log(configstrings.consoleStrings.invalidToken.replace('{{ip}}', req.ip));
						return res.json({ success: false, message: configstrings.webStrings.invalidToken });
					}
					if (allRows[0].enabled === '1') {
						//continueUpload = true;
						if (files.upload.name === '') {
							log(configstrings.consoleStrings.noFile.replace('{{ip}}', req.ip));
							return res.json({ success: false, message: configstrings.webStrings.noFile });
						}
						var tmpPath = files.upload.path; // Gets location of tmp file
						log(tmpPath);
						var ext = require('path').extname(files.upload.name); // Gets file extension
						if (config.extBlacklist.indexOf(ext) >= 0) {
							log(configstrings.consoleStrings.blacklistExt.replace('{{ip}}', req.ip));
							return res.json({ success: false, message: configstrings.webStrings.blacklisted });
						}
						log(ext);
						var fileMime = mime.getType(ext);

						var fileNameWithoutExt = randomValueHex(config.filenameLength, ext);
						if (!fileNameWithoutExt) {
							return res.json({ success: false, message: 'Unable get file name. Please try again.' });
						}

						var fileName = fileNameWithoutExt + ext;
						/*var newPath = path.join(tmpFileDir,fileName);
		console.log('N:'+newPath);
		fs.rename(tmpPath, newPath, function (err) {
                    if (err) {
                      throw err;
                    }

                  });*/
						var params = {
							localFile: tmpPath,
							deleteRemoved: true,
							s3Params: {
								ACL: 'public-read',
								Bucket: config.s3.bucket,
								Key: config.s3.remotePath + fileName,
								ContentType: fileMime
							}
						};

						var uploader = client.uploadFile(params);
						// eslint-disable-next-line max-nested-callbacks
						uploader.on('error', function(err) {
							console.error('unable to upload:', err.stack);
							res.json({ success: false, message: 'Unable to upload to S3' }); // Will not add an option to change this in `strings.json`
						});
						// eslint-disable-next-line max-nested-callbacks
						uploader.on('progress', function() {
							console.log('progress', uploader.progressAmount, uploader.progressTotal);
						});
						// eslint-disable-next-line max-nested-callbacks
						uploader.on('end', function() {
							console.log('done uploading');
							filesInS3.push(fileName);
							console.log(filesInS3);
							if (config.s3.redirectToAfterUpload) {
								res.redirect(config.s3.redirectToAfterUpload + fileName);
							} else {
								res.json({ success: true, message: fileName }); // Will not add an option to change this is `strings.json`
							}
							//log(util.inspect({fields: fields, files: files}));
							log(configstrings.consoleStrings.uploaded.replace('{{ip}}', req.ip).replace('{{file}}', fileName).replace('{{token}}', usertoken));
							fs.unlinkSync(tmpPath);
						});


					} else {
						log(configstrings.consoleStrings.disabledToken.replace('{{ip}}', req.ip));
						return res.json({ success: false, message: configstrings.webStrings.disabledToken });
					}
				});
			});
		}

		startDB();

	});
});

app.get('/', function(req, res) {
	if (stillWaitingForS3) return res.json({ success: false, message: 'System unavailable, please try again later. If this issue does not resolve itself in a few minutes, please contact your system administrator.' });
	// show a file upload form, can be disabled in config file.
	if (config.indexForm) {
		log(configstrings.consoleStrings.reqHome.replace('{{ip}}', req.ip));
		res.writeHead(200, { 'content-type': 'text/html' });
		res.end(
			'<form action="/upload" enctype="multipart/form-data" method="post">' +
      'Token: <input type="text" name="token"><br>' +
      '<input type="file" name="upload"><br>' +
      '<input type="submit" value="Upload">' +
      '</form>'
		);
	} else {
		log(configstrings.consoleStrings.reqDisabledHome.replace('{{ip}}', req.ip));
		res.end(config.indexFormDisabledMessage);

	}
});

/*app.get('/admin/deletefiles', apiRatelimiter, function(req, res) { // If you want to delete all files saved in './files' directory


  db.serialize(function() {
    db.all(`SELECT admintoken, admin FROM tokens WHERE admin = 'true' AND admintoken = '${req.headers.admintoken}'`, function(err, adminTokens) {

      if(err !== null){
         return log(err);
      }

      log(adminTokens);
      if (!adminTokens[0]) {
        log(configstrings.consoleStrings.invalidAdmin.replace('{{ip}}', req.ip));
        return res.json({"success": false, "message": configstrings.webStrings.invalidAdmin});
      }
      //var admintoken = config.admintoken;
        log(configstrings.consoleStrings.dirClear.replace('{{ip}}', req.ip));
        var fileDir = path.join(__dirname, 'files/');
        fs.readdir(fileDir, (err, files) => {
          if (err) {
            throw err;
          }
          var delFilePath = fileDir;
          for (const file of files) {
            var delFile = delFilePath + file;
            log(delFilePath + file);
            fs.unlink(delFile, err => {
              if (err) {
                throw err;
              }
            });
          }
        });
        res.json({"success": true, "message": configstrings.webStrings.filesDel});

    });
  });
});


app.get('/admin/deletetmp', apiRatelimiter, function(req, res) { // For when temp files are too many


    db.serialize(function() {
      db.all(`SELECT admintoken, admin FROM tokens WHERE admin = 'true' AND admintoken = '${req.headers.admintoken}'`, function(err, adminTokens) {

        if(err !== null){
           return log(err);
        }

        log(adminTokens);
        if (!adminTokens[0]) {
          log(configstrings.consoleStrings.invalidAdmin.replace('{{ip}}', req.ip));
          return res.json({"success": false, "message": configstrings.webStrings.invalidAdmin});
        }
        log(configstrings.consoleStrings.tmpClear.replace('{{ip}}', req.ip));

        fs.readdir(tmpFileDir, (err, files) => {
          if (err) {
            throw err;
          }

          for (const file of files) {
            fs.unlink(path.join(tmpFileDir, file), err => {
              if (err) {
                throw err;
              }
            });
          }
        });
        res.json({"success": true, "message": configstrings.webStrings.tmpDel});

        });
    });
});

app.get('*', function(req, res) { // 404
    fs.access(path.join(__dirname, 'files', req.path), function(e) {
      if (e && e.code === 'ENOENT') {
        if (req.path === '/favicon.ico') {
          return;
        }
        log(configstrings.consoleStrings.reqNoFile.replace('{{ip}}', req.ip).replace('{{file}}', req.path));
        res.send(configstrings.webStrings.reqNoFile);
      } else {
        log(configstrings.consoleStrings.req.replace('{{ip}}', req.ip).replace('{{file}}', req.path));
      }
    });
});*/

app.listen(config.port, function() {
	log(configstrings.consoleStrings.ready.replace('{{port}}', config.port));
});
