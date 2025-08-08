const ipc = require('electron').ipcRenderer;
const fs = require('fs');
const path = require('path');
const request = require('request');
const server = require('./json/server');

module.exports.getManifest = async function (fullScan, emuPath, checkFiles) {
    var files = require('./json/required');
    // Always get config from main process
    let config = await ipc.invoke('get-launcher-config');

    if (fullScan || emuPath && !fs.existsSync(path.join(emuPath, "swgemu.cfg"))) {
        //force download with size:0, md5:""
        files = files.concat([
            { name: "live.cfg", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/live/game_files/live.cfg" },
            { name: "login.cfg", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/login.cfg" },
            { name: "options.cfg", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/options.cfg" },
            { name: "preload.cfg", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/preload.cfg" },
            { name: "swgemu.cfg", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/swgemu.cfg" },
            { name: "user.cfg", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/user.cfg" },
            { name: "swgemu_machineoptions.iff", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/swgemu_machineoptions.iff" },
            { name: "KSWGProfCalc.dat", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/KSWGProfCalc.dat" },
            { name: "KSWGProfCalcEditor.exe", size: 0, md5: 0, url: "http://patcher.swgawakening.com/launcher/initial_install/KSWGProfCalcEditor.exe" },
        ]);
    }
    request({ url: server[config.login][0].manifestUrl, json: true }, function (err, response, body) {
        if (err) return console.error(err);
        files = unionByName(files, body.required);
        if (checkFiles) checkFiles(files);
    });
}

function unionByName(a, b) {
    var lookup = {};
    for (var i of b) lookup[i.name] = true;
    var r = [];
    for (var i of a) if (!lookup[i.name]) r.push(i);
    for (var i of b) r.push(i);
    return r;
}

var forks = [];
var canceling = true;
module.exports.install = function (swgPath, emuPath, fullScan) {
    const child_process = require('child_process');
    canceling = false;
    module.exports.getManifest(fullScan, emuPath, checkFiles);

    var fileIndex = 0;
    var completedBytes = 0;
    var totalBytes = 0;
    var files;
    function checkFiles(manifest) {
        files = manifest;
        for (let file of files) {
            totalBytes += file.size;
            if (/\.zip$/.test(file.name))
                totalBytes += file.size;
        }

        var env = { swgPath, emuPath };
        if (fullScan) env.fullScan = true;
        for (let i = 0; i < 1; i++) {
            let fork = child_process.fork(__filename, { env });
            fork.on('message', m => installedCallback(fork, m));
            fork.send(files[fileIndex++]);
            forks.push(fork);
        }
    }
    function installedCallback(fork, message) {
        if (message.complete !== undefined) {
            completedBytes += message.complete;
            progress(completedBytes, totalBytes);
            if (fileIndex == files.length) {
                forks.splice(forks.indexOf(fork), 1);
                fork.kill();
                console.log("killing fork");
            }
            else fork.send(files[fileIndex++]);
        } else if (message.progress) {
            completedBytes += message.progress;
            progress(completedBytes, totalBytes);
        } else {
            console.log(JSON.stringify(message));
        }
    }
    function progress(completed, total) {
        if (module.exports.progress && !canceling) module.exports.progress(completed, total);
    }
}

module.exports.cancel = function () {
    canceling = true;
    for (var fork of forks) fork.kill();
    forks = [];
}

if (process.send) {
    const AdmZip = require('adm-zip');

    function mkdirp(pathToCreate) {
        pathToCreate.split(path.sep).reduce((currentPath, folder) => {
            currentPath += folder + path.sep;
            if (!fs.existsSync(currentPath)) fs.mkdirSync(currentPath);
            return currentPath;
        }, '');
    }
    mkdirp(process.env.emuPath);

    process.on('message', (fileInfo) => {
        let src = path.join(process.env.swgPath, fileInfo.name);
        let dst = path.join(process.env.emuPath, fileInfo.name);
        let progressReported = 0;
        mkdirp(path.dirname(dst));
        if (fs.existsSync(dst))
            src = dst;
        fs.stat(src, (err, stats) => {
            if (err) { process.send('err: ' + err); return doDownload(); }
            if (stats.size != fileInfo.size && fileInfo.size != 0) { process.send("size mismatch actual: " + stats.size + ' expected: ' + fileInfo.size); return doDownload(); }

            /*
             * This logic section forces restricted file extensions to be downloaded even if 
             * copy would otherwise be requested. However, it doesn't force a download if the 
             * file already exists in the destination directory - this should fix 
             * our issue with ".cfg" and "miles" files coming across with invalid versions 
             * whilst also not making them redownload every time the launcher checks file 
             * validity.
             */
            const forceDownloadExtensionTypes = ['.cfg', '.iff', '.dat', '.exe', '.m3d', '.flt', '.asi', '.dll'];

            const shouldForceDownload = forceDownloadExtensionTypes.some(ext => fileInfo.name.toLowerCase().endsWith(ext));

            if (shouldForceDownload) {
                if (!fs.existsSync(dst)) {
                    process.send(`forcing download due to extension (file not already in destination): ${fileInfo.name}`);
                    return doDownload();
                } else {
                    // File exists — verify MD5 for files with non-zero entries
                    md5(dst, hash => {
                        if (hash != String(fileInfo.md5).toLowerCase() && fileInfo.md5 != 0) {
                            //File has md5 mismatch, download new one
                            process.send('md5 mismatch on restricted extension file actual: ' + hash + ' expected: ' + String(fileInfo.md5).toLowerCase());
                            return doDownload();
                        } else {
                            //File had matching md5, or had an md5 listing of 0 which indicates the file is allowed to be modified
                            process.send(`md5 match for restricted extension file: ${fileInfo.name}`);
                            return complete(); // No download needed - valid file already in destination
                        }
                    }, progress);
                }
            } else {
                if (process.env.fullScan)
                    md5(src, hash => {
                        if (hash != String(fileInfo.md5).toLowerCase() && fileInfo.md5 != 0) {
                            process.send('md5 mismatch actual: ' + hash + ' expected: ' + String(fileInfo.md5).toLowerCase());
                            progress(-fileInfo.size);
                            return doDownload();
                        }
                        process.send('md5 matches ' + fileInfo.name);
                        copyFile(src, dst, complete, progress);
                    }, progress);
                else copyFile(src, dst, complete, progress);
            }
        });
        function doDownload() {
            process.send('downloading ' + fileInfo.url + ' to ' + dst);
            download(fileInfo.url, dst, complete, progress);
        }
        function complete(err) {
            if (err) return process.send("err:" + err);
            process.send("complete: " + fileInfo.name);
            var expectedSize = fileInfo.size;
            if (/\.zip$/.test(fileInfo.name)) expectedSize *= 2;
            process.send({ 'complete': expectedSize - progressReported });
        }
        function progress(bytes) {
            progressReported += bytes;
            process.send({ progress: bytes });
        }
    });

    function download(url, dest, complete, progress) {
        try { fs.unlinkSync(dest); } catch (ex) { }
        var file = fs.createWriteStream(dest);
        request(url)
            .on('error', err => {
                file.close();
                fs.unlink(dest);
                if (complete) complete(err.message);
            })
            .on('response', res => {
                res.on('data', d => progress(d.length));
                if (/\.zip$/.test(dest))
                    res.on('end', () => unzip(dest, complete))
                else
                    res.on('end', complete);
            })
            .pipe(file);
    };

    function unzip(dest, complete) {
        process.send('unzipping');
        var zip = new AdmZip(dest);
        zip.extractAllToAsync(process.env.emuPath, true, complete);
    }

    function md5(file, complete, progress) {
        var hash = require('crypto').createHash('md5');
        var stream = fs.createReadStream(file);
        stream.on('data', data => { progress(data.length); hash.update(data, 'utf8') });
        stream.on('end', () => complete(hash.digest('hex')));
    }

    function copyFile(source, target, complete, progress) {
        if (source == target) return complete();
        var cbCalled = false;
        var rd = fs.createReadStream(source);
        rd.on("error", done);
        var wr = fs.createWriteStream(target);
        wr.on("error", done);
        wr.on("close", done);
        rd.on('data', d => progress(d.length));
        rd.pipe(wr);
        function done(err) {
            if (!cbCalled) {
                complete(err);
                cbCalled = true;
            }
        }
    }
}
