const fs = require('fs');
const path = require('path');
const os = require('os');
const server = require('./json/server');

function getWorkerCount() {
    const envValue = parseInt(process.env.SWG_INSTALL_CONCURRENCY || '', 10);
    if (Number.isFinite(envValue) && envValue > 0) {
        return Math.min(envValue, 6);
    }

    // Conservative default to avoid overwhelming disk/network while still parallelizing.
    const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 2;
    return Math.max(1, Math.min(3, cpuCount - 1));
}

module.exports.getManifest = async function (loginKey, fullScan, emuPath, checkFiles) {
    var files = require('./json/required');
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
        try {
            const response = await fetch(server[loginKey][0].manifestUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await response.json();
            if (!body || !Array.isArray(body.required)) {
                console.error('[INSTALL] Manifest response invalid:', body);
            } else {
                files = unionByName(files, body.required);
            }
        } catch (err) {
            console.error('[INSTALL] Manifest fetch failed:', err.message);
        }
        if (checkFiles) checkFiles(files);
}

function unionByName(a, b) {
    var lookup = {};
    for (var i of b) lookup[i.name] = true;
    var r = [];
    for (var i of a) if (!lookup[i.name]) r.push(i);
    for (var i of b) r.push(i);
    return r;
}

function dedupeByName(files) {
    const byName = new Map();
    for (const file of files) {
        if (!file || !file.name) continue;
        // Last writer wins so remote manifest overrides base entries.
        byName.set(file.name, file);
    }
    return Array.from(byName.values());
}

function cleanupStageFiles(rootDir) {
    if (!rootDir || !fs.existsSync(rootDir)) return 0;

    let removed = 0;
    const queue = [rootDir];
    while (queue.length > 0) {
        const current = queue.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (err) {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }

            if (entry.name.includes('.swgstage-')) {
                try {
                    fs.unlinkSync(fullPath);
                    removed += 1;
                } catch (err) {
                    console.warn('[INSTALL] Could not remove stale stage file:', fullPath);
                }
            }
        }
    }
    return removed;
}

var forks = [];
var canceling = true;
// completedFiles: Map<fileName, { bytes, md5, size, url }> for resume tracking
var resumeState = { completedFiles: new Map(), completedBytes: 0 };

module.exports.install = function (swgPath, emuPath, fullScan, loginKey, isResume = false) {
    const child_process = require('child_process');

    // Ensure any prior install workers are not left alive.
    if (forks.length > 0) {
        for (const fork of forks) {
            try { fork.kill(); } catch (e) {}
        }
        forks = [];
    }

    canceling = false;

    // If not resuming, clear the resume state for a fresh install
    if (!isResume) {
        resumeState = { completedFiles: new Map(), completedBytes: 0 };
    }

    const removedStages = cleanupStageFiles(emuPath);
    if (removedStages > 0) {
        console.info(`[INSTALL] Removed ${removedStages} stale stage file(s) before install.`);
    }

    module.exports.getManifest(loginKey, fullScan, emuPath, checkFiles);

    var fileIndex = 0;
    var completedBytes = resumeState.completedBytes;
    var totalBytes = 0;
    var files;
    var stats = {
        startMs: Date.now(),
        totalFiles: 0,
        completedFiles: 0,
        verifiedFiles: 0,
        retryCount: 0,
        failedFiles: 0,
        resumedBytes: resumeState.completedBytes,
    };
    var finished = false;

    function printSummary(status, reason) {
        const elapsedMs = Date.now() - stats.startMs;
        const summary = {
            status,
            reason: reason || null,
            elapsedMs,
            totalFiles: stats.totalFiles,
            completedFiles: stats.completedFiles,
            verifiedFiles: stats.verifiedFiles,
            retriedFiles: stats.retryCount,
            failedFiles: stats.failedFiles,
        };
        console.log('[INSTALL SUMMARY] ' + JSON.stringify(summary));
    }

    function assignNextFile(fork) {
        if (canceling) {
            try { fork.kill(); } catch (e) {}
            return;
        }
        if (fileIndex < files.length) {
            // Reset per-fork accumulator for the incoming file
            forkProgressBytes.set(fork, 0);
            const nextFile = files[fileIndex++];
            forkCurrentFile.set(fork, nextFile);
            fork.send(nextFile);
            return;
        }

        forkProgressBytes.delete(fork);
        forkCurrentFile.delete(fork);
        const idx = forks.indexOf(fork);
        if (idx >= 0) forks.splice(idx, 1);
        try { fork.kill(); } catch (e) {}
    }

    function hardFailInstall(reason) {
        if (finished) return;
        finished = true;
        canceling = true;

        for (const fork of forks) {
            try { fork.kill(); } catch (e) {}
        }
        forks = [];

        printSummary('failed', reason || 'install failed');
        if (typeof module.exports.onError === 'function') {
            module.exports.onError(reason || 'install failed');
        }
    }

    function maybeFinish() {
        if (finished) return;
        if (canceling) {
            finished = true;
            printSummary('canceled');
            return;
        }
        if (fileIndex < files.length) return;
        if (forks.length > 0) return;

        finished = true;
        const status = stats.failedFiles > 0 ? 'failed' : 'success';
        printSummary(status, stats.failedFiles > 0 ? 'one or more files failed to install' : null);
        if (stats.failedFiles > 0 && typeof module.exports.onError === 'function') {
            module.exports.onError('install completed with file failures');
        }
    }

    // Per-fork accumulator: tracks progress bytes for the file currently in each worker.
    // Reset when a new file is dispatched to that fork.
    const forkProgressBytes = new Map();
    const forkCurrentFile = new Map();

    function checkFiles(manifest) {
        files = dedupeByName(manifest || []);
        if (!Array.isArray(files) || files.length === 0) {
            progress(1, 1);
            printSummary('success');
            return;
        }
        stats.totalFiles = files.length;

        for (let file of files) {
            totalBytes += file.size;
            if (/\.zip$/.test(file.name))
                totalBytes += file.size;
        }

        // On resume: keep completed files only if remote manifest entry still matches
        // the metadata we completed against. Changed or missing entries are re-queued.
        if (isResume && resumeState.completedFiles.size > 0) {
            console.log(`[INSTALL] Validating ${resumeState.completedFiles.size} previously completed files against new manifest...`);

            // Rebuild completedBytes strictly from the files that genuinely finished.
            // The carried-over resumeState.completedBytes can include in-flight partial
            // bytes from workers that were mid-download when the interruption killed them;
            // those files get re-queued below and downloaded again, so trusting the
            // running total would double-count them and push completedBytes past
            // totalBytes — the bar would clamp at 100% but never hit the exact-equal
            // completion branch. Summing the surviving completedFiles map is ground truth.
            const manifestNames = new Set(files.map(f => f.name));
            let recomputedBytes = 0;
            for (const [completedFileName, entry] of Array.from(resumeState.completedFiles)) {
                const fileBytes = (entry && typeof entry === 'object')
                    ? Number(entry.bytes || 0)
                    : Number(entry || 0);

                if (!manifestNames.has(completedFileName)) {
                    resumeState.completedFiles.delete(completedFileName);
                    console.info(`[INSTALL RESUME] File no longer in manifest, dropping ${fileBytes}B: ${completedFileName}`);
                    continue;
                }

                const manifestEntry = files.find(f => f.name === completedFileName);
                const md5Changed = String((entry && entry.md5) || '') !== String((manifestEntry && manifestEntry.md5) || '');
                const sizeChanged = Number((entry && entry.size) || 0) !== Number((manifestEntry && manifestEntry.size) || 0);
                const urlChanged = String((entry && entry.url) || '') !== String((manifestEntry && manifestEntry.url) || '');

                if (md5Changed || sizeChanged || urlChanged) {
                    resumeState.completedFiles.delete(completedFileName);
                    console.info(`[INSTALL RESUME] Manifest changed; re-queueing ${completedFileName} (${fileBytes}B)`);
                    continue;
                }

                recomputedBytes += fileBytes;
            }

            completedBytes = recomputedBytes;
            resumeState.completedBytes = completedBytes;
            // True resume: skip unchanged completed files.
            files = files.filter((f) => !resumeState.completedFiles.has(f.name));
            console.info(`[INSTALL RESUME] ${files.length} file(s) remaining after resume filtering.`);
        }

        if (files.length === 0) {
            progress(completedBytes, totalBytes);
            printSummary('success');
            return;
        }

        var env = { swgPath, emuPath };
        if (fullScan) env.fullScan = true;
        const workerCount = Math.min(getWorkerCount(), files.length);
        const action = isResume ? 'resuming' : 'Starting';
        console.log(`[INSTALL] ${action} install with ${workerCount} worker(s) for ${files.length} file(s).`);

        // Bounded requeue so a file that reliably crashes its worker can't loop forever.
        const MAX_FILE_REQUEUES = 2;
        const fileRequeues = new Map(); // name -> requeue count

        function spawnWorker() {
            let fork = child_process.fork(__filename, { env });

            fork.on('exit', (code, signal) => {
                const partialBytes = forkProgressBytes.get(fork) || 0;
                forkProgressBytes.delete(fork);
                const inFlight = forkCurrentFile.get(fork);
                forkCurrentFile.delete(fork);
                const idx = forks.indexOf(fork);
                if (idx >= 0) forks.splice(idx, 1);

                // Unexpected exit while a file was still in-flight: the worker died
                // before reporting completion for `inFlight` (e.g. an uncaught error in
                // its message handler). Without this, that file — and any still queued —
                // would be silently dropped and the install could falsely report success.
                if (!finished && !canceling && inFlight) {
                    const count = (fileRequeues.get(inFlight.name) || 0) + 1;
                    if (count <= MAX_FILE_REQUEUES) {
                        fileRequeues.set(inFlight.name, count);
                        // Roll back the failed attempt's partial progress so the
                        // re-download doesn't double-count and overshoot the bar.
                        completedBytes -= partialBytes;
                        if (completedBytes < 0) completedBytes = 0;
                        progress(completedBytes, totalBytes);
                        files.push(inFlight);
                        console.warn(`[INSTALL] Worker exited unexpectedly (code=${code}, signal=${signal}) mid-file; requeueing ${inFlight.name} (attempt ${count}/${MAX_FILE_REQUEUES}).`);
                        spawnWorker();
                        return;
                    }
                    stats.failedFiles += 1;
                    console.error(`[INSTALL] Worker repeatedly crashed on ${inFlight.name}; giving up after ${MAX_FILE_REQUEUES} requeue(s).`);
                }
                maybeFinish();
            });

            fork.on('error', (err) => {
                console.error('[INSTALL] Worker process error:', err && err.message ? err.message : err);
            });

            fork.on('message', m => installedCallback(fork, m));
            if (fileIndex < files.length) {
                forkProgressBytes.set(fork, 0);
                const nextFile = files[fileIndex++];
                forkCurrentFile.set(fork, nextFile);
                fork.send(nextFile);
            }
            forks.push(fork);
            return fork;
        }

        for (let i = 0; i < workerCount; i++) {
            spawnWorker();
        }
    }
    function installedCallback(fork, message) {
        if (message.complete !== undefined) {
            // Always add message.complete (the remainder after chunk progress).
            // The total bytes for this file = forkProgressBytes[fork] + message.complete.
            // Both are stored in resumeState so the correct full amount can be deducted on future resumes.
            completedBytes += message.complete;

            progress(completedBytes, totalBytes);
            stats.completedFiles += 1;

            const currentFile = forkCurrentFile.get(fork);
            const completedFileName = (message && message.file) || (currentFile && currentFile.name);
            if (completedFileName) {
                // Total contribution = all progress chunks sent + the completion remainder
                const chunkBytes = forkProgressBytes.get(fork) || 0;
                resumeState.completedFiles.set(completedFileName, {
                    bytes: chunkBytes + message.complete,
                    md5: currentFile && currentFile.md5,
                    size: currentFile && currentFile.size,
                    url: currentFile && currentFile.url,
                });
                resumeState.completedBytes = completedBytes;
            }

            // Reset per-fork accumulator for the next file this worker will process
            forkProgressBytes.set(fork, 0);

            assignNextFile(fork);
        } else if (message.progress) {
            completedBytes += message.progress;
            // Accumulate per-fork progress bytes so we know the file's total contribution at completion
            forkProgressBytes.set(fork, (forkProgressBytes.get(fork) || 0) + message.progress);
            progress(completedBytes, totalBytes);
        } else if (message && message.type === 'verify-ok') {
            stats.verifiedFiles += 1;
        } else if (message && message.type === 'verify-retry') {
            stats.retryCount += 1;
            console.warn('[INSTALL VERIFY] Retry requested for', message.file);
        } else if (message && message.type === 'download-retry') {
            stats.retryCount += 1;
            console.warn('[INSTALL DOWNLOAD] Retry requested for', message.file, 'attempt', message.attempt, 'after', message.delayMs + 'ms');
        } else if (message && message.type === 'source-miss') {
            console.info('[INSTALL] Source file missing locally; downloading from patch server:', message.file);
        } else if (message && message.type === 'error') {
            stats.failedFiles += 1;
            console.error('[INSTALL] File processing error:', message.file, message.error);

            if (message.fatalIntegrity) {
                hardFailInstall('fatal integrity mismatch: ' + message.file);
                return;
            }

            if (message.networkInterruption) {
                hardFailInstall('network interruption during patch download: ' + message.file);
                return;
            }

            assignNextFile(fork);
        } else {
            console.log(JSON.stringify(message));
        }

        maybeFinish();
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

module.exports.getResumeState = function() {
    return resumeState;
}

module.exports.clearResumeState = function() {
    resumeState = { completedFiles: new Map(), completedBytes: 0 };
}

if (process.send) {
    const AdmZip = require('adm-zip');

    function sendToParent(message) {
        if (!process.connected) return false;
        try {
            process.send(message);
            return true;
        } catch (err) {
            return false;
        }
    }

    function makeStagePath(finalPath) {
        return `${finalPath}.swgstage-${process.pid}`;
    }

    function safeUnlink(filePath) {
        try { fs.unlinkSync(filePath); } catch (ex) {}
    }

    function atomicReplace(stagePath, destPath, done) {
        // Remove destination first so rename works consistently across Windows scenarios.
        try { fs.unlinkSync(destPath); } catch (ex) {}
        fs.rename(stagePath, destPath, (err) => {
            if (err) return done(err.message || String(err));
            done();
        });
    }

    function mkdirp(pathToCreate) {
        // recursive:true is idempotent (no EEXIST throw) and atomic per segment, so
        // parallel workers creating the same subtree can't race each other here.
        fs.mkdirSync(pathToCreate, { recursive: true });
    }
    mkdirp(process.env.emuPath);

    process.on('message', (fileInfo) => {
        let src = path.join(process.env.swgPath, fileInfo.name);
        let dst = path.join(process.env.emuPath, fileInfo.name);

        // Containment check: we own the manifest, so this guards against a malformed
        // entry (stray "..", absolute path) writing outside the install dir rather than
        // a hostile one. Reject anything that resolves beyond emuPath.
        const emuRoot = path.resolve(process.env.emuPath);
        const resolvedDst = path.resolve(dst);
        if (resolvedDst !== emuRoot && !resolvedDst.startsWith(emuRoot + path.sep)) {
            sendToParent({ type: 'error', file: fileInfo.name, error: 'path escapes install directory: ' + fileInfo.name, fatalIntegrity: false });
            return;
        }

        let stagePath = makeStagePath(dst);
        let progressReported = 0;
        let verifyRetries = 0;
        const MAX_VERIFY_RETRIES = 1;
        const MAX_DOWNLOAD_RETRIES = 3;
        const expectedMd5 = String(fileInfo.md5 || '').toLowerCase();
        const shouldVerify = !!expectedMd5 && expectedMd5 !== '0';
        mkdirp(path.dirname(dst));
        if (fs.existsSync(dst))
            src = dst;
        fs.stat(src, (err, stats) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    sendToParent({ type: 'source-miss', file: fileInfo.name });
                } else {
                    sendToParent({ type: 'error', file: fileInfo.name, error: 'source stat error: ' + err.message, fatalIntegrity: false });
                }
                return doDownload();
            }
            if (stats.size != fileInfo.size && fileInfo.size != 0) { sendToParent("size mismatch actual: " + stats.size + ' expected: ' + fileInfo.size); return doDownload(); }

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
                    sendToParent(`forcing download due to extension (file not already in destination): ${fileInfo.name}`);
                    return doDownload();
                } else {
                    // File exists — verify MD5 for files with non-zero entries
                    md5(dst, hash => {
                        if (hash != String(fileInfo.md5).toLowerCase() && fileInfo.md5 != 0) {
                            //File has md5 mismatch, download new one
                            sendToParent('md5 mismatch on restricted extension file actual: ' + hash + ' expected: ' + String(fileInfo.md5).toLowerCase());
                            return doDownload();
                        } else {
                            //File had matching md5, or had an md5 listing of 0 which indicates the file is allowed to be modified
                            sendToParent(`md5 match for restricted extension file: ${fileInfo.name}`);
                            return completeWithVerify(); // No download needed - valid file already in destination
                        }
                    }, progress);
                }
            } else {
                if (process.env.fullScan)
                    md5(src, hash => {
                        if (hash != String(fileInfo.md5).toLowerCase() && fileInfo.md5 != 0) {
                            sendToParent('md5 mismatch actual: ' + hash + ' expected: ' + String(fileInfo.md5).toLowerCase());
                            progress(-fileInfo.size);
                            return doDownload();
                        }
                        sendToParent('md5 matches ' + fileInfo.name);
                        copyFile(src, dst, completeWithVerify, progress);
                    }, progress);
                else copyFile(src, dst, completeWithVerify, progress);
            }
        });
        function doDownload() {
            sendToParent('downloading ' + fileInfo.url + ' to ' + dst);
            download(fileInfo.url, stagePath, dst, fileInfo.name, MAX_DOWNLOAD_RETRIES, completeWithVerify, progress);
        }
        function complete(err) {
            if (err) {
                const errText = String(err);
                const fatalIntegrity = errText.startsWith('post-write md5 mismatch:');
                const networkInterruption = errText.startsWith('network interruption:');
                // If this file failed during transfer, roll back optimistic bytes for this file.
                if (networkInterruption && progressReported !== 0) {
                    progress(-progressReported);
                    progressReported = 0;
                }
                sendToParent({ type: 'error', file: fileInfo.name, error: errText, fatalIntegrity, networkInterruption });
                return;
            }
            sendToParent("complete: " + fileInfo.name);
            var expectedSize = fileInfo.size;
            if (/\.zip$/.test(fileInfo.name)) expectedSize *= 2;
            
            // Determine if this was a validation-pass (no download) or actual work (download/copy)
            const wasValidationPass = progressReported === 0 && expectedSize > 0;
            
            // Send completion with file name and validation status for proper byte accounting
            sendToParent({ 
                complete: expectedSize - progressReported, 
                file: fileInfo.name,
                wasValidationPass: wasValidationPass
            });
        }

        function completeWithVerify(err) {
            if (err) return complete(err);
            if (!shouldVerify) return complete();

            md5(dst, (hash) => {
                if (hash !== expectedMd5) {
                    sendToParent('[INSTALL VERIFY] Destination hash mismatch for ' + fileInfo.name + ' actual: ' + hash + ' expected: ' + expectedMd5);
                    if (verifyRetries < MAX_VERIFY_RETRIES) {
                        verifyRetries++;
                        sendToParent({ type: 'verify-retry', file: fileInfo.name, attempt: verifyRetries });
                        // Roll back this file's previously reported bytes before retrying.
                        if (progressReported !== 0) {
                            progress(-progressReported);
                            progressReported = 0;
                        }
                        return doDownload();
                    }
                    safeUnlink(stagePath);
                    return complete('post-write md5 mismatch: ' + fileInfo.name);
                }
                sendToParent({ type: 'verify-ok', file: fileInfo.name });
                complete();
            }, () => {});
        }
        function progress(bytes) {
            progressReported += bytes;
            sendToParent({ progress: bytes });
        }
    });

    function isNetworkInterruptionError(err) {
        const msg = String((err && err.message) ? err.message : err || '').toLowerCase();
        const code = String((err && err.code) ? err.code : '').toLowerCase();
        if (code === 'econnreset' || code === 'enotfound' || code === 'eai_again' || code === 'etimedout' || code === 'econnaborted') return true;
        return msg.includes('fetch failed') ||
            msg.includes('network') ||
            msg.includes('internet') ||
            msg.includes('socket hang up') ||
            msg.includes('timed out') ||
            msg.includes('aborted');
    }

    function download(url, stagePath, destPath, fileName, maxRetries, complete, progress, attempt = 0) {
        const FETCH_TIMEOUT_MS = 20000;
        // Guards the body-streaming phase: if no chunk arrives for this long the
        // connection is treated as stalled (half-open socket, wedged CDN node) and
        // aborted, which funnels into the same timeout→retry path as a header timeout.
        const BODY_STALL_MS = 30000;
        const backoffMs = 1200 * (attempt + 1);
        safeUnlink(stagePath);
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let stallTimer = null;
        function armStall() {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => controller.abort(), BODY_STALL_MS);
        }
        function clearStall() {
            if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
        }

        fetch(url, { signal: controller.signal }).then(response => {
            clearTimeout(timeoutHandle);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (!response.body || typeof response.body.getReader !== 'function') {
                throw new Error('No response body available for download stream');
            }

            const file = fs.createWriteStream(stagePath);
            const reader = response.body.getReader();
            armStall();
            function pump() {
                reader.read().then(({ done, value }) => {
                    if (done) {
                        clearStall();
                        file.end(() => {
                            if (/\.zip$/.test(destPath)) {
                                unzip(stagePath, destPath, complete);
                            } else {
                                atomicReplace(stagePath, destPath, complete);
                            }
                        });
                        return;
                    }
                    armStall();
                    progress(value.length);
                    file.write(Buffer.from(value), pump);
                }).catch(err => {
                    clearStall();
                    file.destroy();
                    safeUnlink(stagePath);
                    const normalizedError = err && err.name === 'AbortError'
                        ? new Error('request timed out')
                        : err;
                    if (isNetworkInterruptionError(normalizedError) && attempt < (maxRetries - 1)) {
                        sendToParent({ type: 'download-retry', file: fileName, attempt: attempt + 1, delayMs: backoffMs });
                        setTimeout(() => {
                            download(url, stagePath, destPath, fileName, maxRetries, complete, progress, attempt + 1);
                        }, backoffMs);
                        return;
                    }
                    const errorMessage = (normalizedError && normalizedError.message) ? normalizedError.message : String(normalizedError);
                    if (complete) {
                        complete(isNetworkInterruptionError(normalizedError)
                            ? ('network interruption: ' + errorMessage)
                            : errorMessage);
                    }
                });
            }
            pump();
        }).catch(err => {
            clearTimeout(timeoutHandle);
            clearStall();
            safeUnlink(stagePath);
            const normalizedError = err && err.name === 'AbortError'
                ? new Error('request timed out')
                : err;
            if (isNetworkInterruptionError(normalizedError) && attempt < (maxRetries - 1)) {
                sendToParent({ type: 'download-retry', file: fileName, attempt: attempt + 1, delayMs: backoffMs });
                setTimeout(() => {
                    download(url, stagePath, destPath, fileName, maxRetries, complete, progress, attempt + 1);
                }, backoffMs);
                return;
            }
            const errorMessage = (normalizedError && normalizedError.message) ? normalizedError.message : String(normalizedError);
            if (complete) {
                complete(isNetworkInterruptionError(normalizedError)
                    ? ('network interruption: ' + errorMessage)
                    : errorMessage);
            }
        });
    }

    function unzip(stagePath, destPath, complete) {
        sendToParent('unzipping');
        try {
            var zip = new AdmZip(stagePath);

            // Zip-slip containment: reject any entry that would extract outside emuPath.
            // We build the patch archives ourselves, so this catches a malformed archive
            // rather than a hostile one — but a single bad entry shouldn't be allowed to
            // scribble over files outside the install directory.
            const emuRoot = path.resolve(process.env.emuPath);
            for (const entry of zip.getEntries()) {
                const target = path.resolve(emuRoot, entry.entryName);
                if (target !== emuRoot && !target.startsWith(emuRoot + path.sep)) {
                    safeUnlink(stagePath);
                    return complete('zip entry escapes install directory: ' + entry.entryName);
                }
            }

            zip.extractAllToAsync(process.env.emuPath, true, (err) => {
                safeUnlink(stagePath);
                if (err) return complete(err.message || String(err));
                complete();
            });
        } catch (err) {
            safeUnlink(stagePath);
            complete(err.message || String(err));
        }
    }

    function md5(file, complete, progress) {
        var hash = require('crypto').createHash('md5');
        var stream = fs.createReadStream(file);
        var done = false;

        function finish(value) {
            if (done) return;
            done = true;
            complete(value);
        }

        stream.on('error', (err) => {
            sendToParent({ type: 'error', file: path.basename(file), error: 'md5 read error: ' + err.message, fatalIntegrity: false });
            finish('');
        });
        stream.on('data', data => { progress(data.length); hash.update(data, 'utf8') });
        stream.on('end', () => finish(hash.digest('hex')));
    }

    function copyFile(source, target, complete, progress) {
        if (source == target) return complete();

        const stagePath = makeStagePath(target);
        safeUnlink(stagePath);
        var cbCalled = false;
        var rd = fs.createReadStream(source);
        rd.on("error", done);
        var wr = fs.createWriteStream(stagePath);
        wr.on("error", done);
        wr.on("close", () => {
            atomicReplace(stagePath, target, done);
        });
        rd.on('data', d => progress(d.length));
        rd.pipe(wr);
        function done(err) {
            if (cbCalled) return;
            cbCalled = true;
            // Tear down both streams so a failure on one side doesn't leak the other's
            // file descriptor. destroy() is idempotent and safe on an already-closed stream.
            rd.destroy();
            wr.destroy();
            if (err) safeUnlink(stagePath);
            complete(err);
        }
    }
}
