const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell } = require('electron');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const lockfile = require('proper-lockfile');
const isDev = require('electron-is-dev');
const { Client: DiscordRpcClient } = require('@xhayper/discord-rpc');
const discordRPCConfig = require('./json/discordrpc');

const canOpenDevTools = isDev && !app.isPackaged;

const LAUNCHER_DEVICE_SCALE_FACTOR = '1.22';
app.commandLine.appendSwitch('force-device-scale-factor', LAUNCHER_DEVICE_SCALE_FACTOR);

process.on('uncaughtException', (error) => {
    console.error('[MAIN] uncaughtException:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[MAIN] unhandledRejection:', reason);
});

// ── Main-process console forwarding to renderer DevTools ──────────────────────
// Mirrors console.log/info/warn/error from the main process into the main
// window's DevTools console (each line prefixed with [MAIN]). Anything logged
// before the renderer is ready is buffered and flushed on did-finish-load.
// rawConsole preserves the original methods for terminal output and to break the
// renderer->main->renderer feedback loop (see the console-message handler).
let mainWindow = null;
const rawConsole = {
    log:   console.log.bind(console),
    info:  console.info.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
};
const mainLogBuffer = [];
const MAIN_LOG_BUFFER_MAX = 500;
let mainLogReady = false;

function forwardMainLog(level, args) {
    let text;
    try {
        text = args.map((a) =>
            typeof a === 'string' ? a
            : a instanceof Error ? (a.stack || a.message)
            : JSON.stringify(a)
        ).join(' ');
    } catch (e) {
        text = args.map(String).join(' ');
    }
    const payload = { level, text };

    const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
    if (!mainLogReady || !wc || wc.isDestroyed()) {
        mainLogBuffer.push(payload);
        if (mainLogBuffer.length > MAIN_LOG_BUFFER_MAX) mainLogBuffer.shift();
        return;
    }
    try { wc.send('main-console', payload); } catch (e) { /* window torn down */ }
}

['log', 'info', 'warn', 'error'].forEach((method) => {
    console[method] = (...args) => {
        rawConsole[method](...args);
        forwardMainLog(method, args);
    };
});

function flushMainLogBuffer() {
    const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
    if (!wc || wc.isDestroyed()) return;
    mainLogReady = true;
    while (mainLogBuffer.length) {
        try { wc.send('main-console', mainLogBuffer.shift()); } catch (e) { /* window torn down */ }
    }
}

const clientId = discordRPCConfig.clientid;

var setupWindow = null;
var err;

/*
 * Our application is not Windows code signed, so we need to use the userData directory for the launcher data store rather than the old "Documents/My Games/SWG - Awakening" path
 * This allows us to avoid issues with permissions and file access (Controlled Folder Access) on Windows systems.
 * Use Electron's userData directory for the launcher data store
 */
const launcherDataStoreDir = app.getPath('userData');
console.log('[LAUNCHER STORE] Directory:', launcherDataStoreDir);

if (!fs.existsSync(launcherDataStoreDir)) {
    fs.mkdirSync(launcherDataStoreDir, { recursive: true });
}

// Config file paths
const oldConfigFile = path.join(launcherDataStoreDir, 'SWG-Awakening-Launcher-config.json');
const configFile = path.join(launcherDataStoreDir, 'awakening-launcher-config.json');

// Config File Mutex for Startup/Migration
let configFileMutex = Promise.resolve();
function withConfigFileLock(fn) {
    // Chain all config file operations to ensure serialization
    configFileMutex = configFileMutex.then(() => fn()).catch(() => {});
    return configFileMutex;
}

// Global config object, always kept in sync with disk
let config = { folder: 'C:\\SWGAwakening' };
function loadConfigFromDisk() {
    if (fs.existsSync(configFile)) {
        try {
            config = JSON.parse(fs.readFileSync(configFile));
        } catch (e) {
            console.error('[LAUNCHER CONFIG] Failed to load config from disk:', e);
        }
    }
}

// Old data store location for migration
const homeDir = require('os').homedir();
const documentsDir = 'Documents';
const myGamesDir = 'My Games';
const swgaDir = 'SWG - Awakening';
const oldLauncherStoreDir = path.join(homeDir, documentsDir, myGamesDir, swgaDir);

// Migrate data from old location if it exists and new location does not have a config file (indicator that migration has already happened)
// This ensures we don't overwrite existing data in the new location
if (fs.existsSync(oldLauncherStoreDir) && !fs.existsSync(path.join(launcherDataStoreDir, 'awakening-launcher-config.json'))) {
    withConfigFileLock(async () => {
        const copyFolderRecursiveSync = (source, target) => {
            if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
            if (fs.existsSync(source)) {
                fs.readdirSync(source).forEach(file => {
                    const srcPath = path.join(source, file);
                    const tgtPath = path.join(target, file);
                    try {
                        if (fs.lstatSync(srcPath).isDirectory()) {
                            copyFolderRecursiveSync(srcPath, tgtPath);
                        } else {
                            if (!fs.existsSync(tgtPath)) {
                                fs.copyFileSync(srcPath, tgtPath);
                                console.log(`[LAUNCHER STORE] Copied file: ${srcPath} -> ${tgtPath}`);
                            } else {
                                console.log(`[LAUNCHER STORE] Skipped existing file: ${tgtPath}`);
                            }
                        }
                    } catch (err) {
                        console.error(`[LAUNCHER STORE] Error copying ${srcPath} to ${tgtPath}: ${err.message}`);
                    }
                });
            }
        };
        try {
            copyFolderRecursiveSync(oldLauncherStoreDir, launcherDataStoreDir);
            console.log(`[LAUNCHER STORE] Migrated data from old store: ${oldLauncherStoreDir} to new store: ${launcherDataStoreDir}`);
        } catch (err) {
            console.error(`[LAUNCHER STORE] Error migrating data: ${err.message}`);
        }

        const deleteFolderRecursiveSync = (dirPath) => {
            if (fs.existsSync(dirPath)) {
                fs.readdirSync(dirPath).forEach((file) => {
                    const curPath = path.join(dirPath, file);
                    try {
                        if (fs.lstatSync(curPath).isDirectory()) {
                            deleteFolderRecursiveSync(curPath);
                        } else {
                            fs.unlinkSync(curPath);
                        }
                    } catch (err) {
                        // Log and skip if unable to delete a file/folder
                        console.warn(`[LAUNCHER STORE] Unable to delete ${curPath}: ${err.message}`);
                    }
                });
                try {
                    fs.rmdirSync(dirPath);
                } catch (err) {
                    // Log and skip if unable to remove directory
                    console.warn(`[LAUNCHER STORE] Unable to remove directory ${dirPath}: ${err.message}`);
                }
            }
        };
        try {
            // Attempt to clean up old data store - may fail if access is restricted (CFA)
            deleteFolderRecursiveSync(oldLauncherStoreDir);
            console.log(`[LAUNCHER STORE] Cleaned up old data store: ${oldLauncherStoreDir}`);
        } catch (err) {
            console.error(`[LAUNCHER STORE] Error cleaning up old data store: ${err.message}`);
        }
        return;
    });
}

// Wrap all startup/migration config file manipulations in the mutex
withConfigFileLock(async () => {
    loadConfigFromDisk();
    console.info(`[LAUNCHER CONFIG] Current config:\n ${JSON.stringify(config)}`);

    if (fs.existsSync(oldConfigFile)) {
        try {
            fs.copyFileSync(oldConfigFile, configFile);
            fs.unlinkSync(oldConfigFile);
        } catch (err) {
            console.error('[LAUNCHER CONFIG] Error copying and cleaning up old config file:', err);
        }
    }
    return;
});

app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-gpu-sandbox");

var logFile = path.join(launcherDataStoreDir, 'awakening-launcher-log.txt');
if (!fs.existsSync(logFile))
    fs.writeFileSync(logFile, "SWG Awakening Launcher Log File\n");


// Patch console logging to also write to log file, trimming if too large
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const TRIM_LOG_SIZE = 1 * 1024 * 1024; // 1 MB
const appendToLogFile = (msg) => {
    try {
        // Check log file size
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size > MAX_LOG_SIZE) {
                // Read last TRIM_LOG_SIZE bytes
                const fd = fs.openSync(logFile, 'r');
                const buffer = Buffer.alloc(TRIM_LOG_SIZE);
                let start = stats.size - TRIM_LOG_SIZE;
                if (start < 0) start = 0;
                fs.readSync(fd, buffer, 0, TRIM_LOG_SIZE, start);
                fs.closeSync(fd);
                let trimmed = buffer.toString();
                // Ensure we start at the next full line (skip partial line)
                const firstNewline = trimmed.indexOf('\n');
                if (firstNewline !== -1) {
                    trimmed = trimmed.slice(firstNewline + 1);
                }
                fs.writeFileSync(logFile, trimmed);
            }
        }
        fs.appendFileSync(logFile, msg + '\n');
    } catch (e) {
        // If log file is not available, skip
    }
};

// Patch console logging to also write to log file
['log', 'warn', 'error'].forEach((level) => {
    const orig = console[level];
    console[level] = function (...args) {
        const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
        appendToLogFile(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`);
        orig.apply(console, args);
    };
});

// Allow renderer processes to log to the main log file
ipcMain.handle('log-to-file', (event, { level = 'log', message }) => {
    if (typeof message !== 'string') message = JSON.stringify(message, null, 2);
    appendToLogFile(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
    return true;
});

log.transports.file.resolvePathFn = () => {
    return logFile;
}
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

if (err !== undefined)
    log.info(err);

// mainWindow is declared near the top (console-forwarding block).
let newsView = null;
let newsRefreshView = null;
let newsRefreshState = 'hidden';
let rulesRefreshView = null;
let rulesRefreshState = 'hidden';
let rulesViewVisible = true;

function applyRulesRefreshStateToOverlay() {
    if (!rulesRefreshView || rulesRefreshView.webContents.isDestroyed()) return;
    const state = String(rulesRefreshState || 'hidden');
    rulesRefreshView.webContents.executeJavaScript(`window.__setRefreshState && window.__setRefreshState(${JSON.stringify(state)});`, true).catch(() => {});
}

function applyNewsRefreshStateToOverlay() {
    if (!newsRefreshView || newsRefreshView.webContents.isDestroyed()) return;
    const state = String(newsRefreshState || 'hidden');
    newsRefreshView.webContents.executeJavaScript(`window.__setRefreshState && window.__setRefreshState(${JSON.stringify(state)});`, true).catch(() => {});
}

function attachExternalNavigationPolicy(viewWebContents) {
    if (!viewWebContents) return;

    const openExternalSafe = (url) => {
        try {
            if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
                shell.openExternal(url);
            }
        } catch (e) {
            console.warn('[WEB VIEW] Failed to open external URL:', url);
        }
    };

    // Covers in-page navigations, redirects, and link clicks.
    viewWebContents.on('will-navigate', (event, navUrl) => {
        event.preventDefault();
        openExternalSafe(navUrl);
    });

    // Covers target="_blank" and window.open().
    viewWebContents.setWindowOpenHandler(({ url }) => {
        openExternalSafe(url);
        return { action: 'deny' };
    });
}

function createWindow() {
    console.info('[WINDOW] createWindow() called');
    mainWindow = new BrowserWindow({
        width: 1096,
        height: 602,
        useContentSize: true,
        center: true,
        resizable: false,
        fullscreen: false,
        fullscreenable: false,
        maximizable: false,
        minWidth: 1096,
        minHeight: 602,
        maxWidth: 1096,
        maxHeight: 602,
        transparent: true,
        show: false,
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        frame: false,
        roundedCorners: false,
        webPreferences: {
            disableBlinkFeatures: 'Auxclick',
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'img/launcher-icon.ico')
    });
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Flush any main-process logs buffered before the renderer was ready, and
    // keep forwarding live once the DevTools console can receive them.
    mainWindow.webContents.on('did-finish-load', flushMainLogBuffer);

    if (canOpenDevTools) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // If first paint stalls, still show the window so the app is usable.
    const showFallbackTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
            console.warn('[WINDOW] ready-to-show timeout; forcing window show.');
            mainWindow.show();
        }
    }, 4000);

    // ── News / updates WebContentsView ──────────────────────────────────────
    newsView = new WebContentsView({
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    mainWindow.contentView.addChildView(newsView);
    newsView.webContents.loadURL('https://swgawakening.com/launcher-home.php');
    attachExternalNavigationPolicy(newsView.webContents);

    newsRefreshView = new WebContentsView({
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    mainWindow.contentView.addChildView(newsRefreshView);
    newsRefreshView.setBackgroundColor('#00000000');
    const refreshIconPath = path.join(__dirname, 'img', 'buttons', 'btn-refresh.png');
    let refreshIconDataUrl = '';
    try {
        const refreshIconBase64 = fs.readFileSync(refreshIconPath).toString('base64');
        refreshIconDataUrl = `data:image/png;base64,${refreshIconBase64}`;
    } catch (err) {
        console.warn('[NEWS REFRESH] Could not load refresh icon for overlay:', err && err.message ? err.message : err);
    }
    const refreshButtonStyle = refreshIconDataUrl
        ? `background:transparent url('${refreshIconDataUrl}') center center / 18px 18px no-repeat;`
        : `background:transparent;`;
    const refreshOverlayHtml = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}button{width:100%;height:100%;border:0;${refreshButtonStyle}color:#fff;font-size:13px;cursor:pointer;opacity:0}button::before{content:'↻';display:${refreshIconDataUrl ? 'none' : 'block'};line-height:16px;text-align:center}button.idle{opacity:.55}button.idle:hover{opacity:.85}button.spinner{opacity:.85;cursor:default;animation:swgaSpin 0.9s linear infinite}button.hidden{opacity:0;cursor:default}@keyframes swgaSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style></head><body><button id="refreshBtn" class="hidden" aria-label="Refresh news" onclick="if(!this.classList.contains('spinner')) location.href='swga-refresh://reload'; return false;"></button><script>window.__setRefreshState=function(state){var btn=document.getElementById('refreshBtn');if(!btn)return;btn.className='';if(state==='spinner')btn.classList.add('spinner');else if(state==='idle')btn.classList.add('idle');else btn.classList.add('hidden');};</script></body></html>`;
    newsRefreshView.webContents.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(refreshOverlayHtml)}`);
    newsRefreshView.webContents.on('did-finish-load', () => {
        applyNewsRefreshStateToOverlay();
    });
    newsRefreshView.webContents.on('will-navigate', (event, navUrl) => {
        event.preventDefault();
        if (typeof navUrl === 'string' && navUrl.startsWith('swga-refresh://reload')) {
            if (newsView) newsView.webContents.reloadIgnoringCache();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('news-refresh-clicked');
            }
        }
    });
    newsRefreshView.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });

    newsView.webContents.on('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('news-view-loaded');
        }
    });

    newsView.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.warn('[NEWS VIEW] did-fail-load', { errorCode, errorDescription, validatedURL });
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('[WINDOW] did-fail-load', { errorCode, errorDescription, validatedURL });
    });

    mainWindow.webContents.on('console-message', (_event, ...args) => {
        let level;
        let message;
        let line;
        let sourceId;

        if (args.length === 1 && args[0] && typeof args[0] === 'object') {
            ({ level, message, line, sourceId } = args[0]);
        } else {
            [level, message, line, sourceId] = args;
        }

        // Skip our own forwarded [MAIN] logs: they already originated in the
        // main process (and were printed to the terminal via rawConsole), so
        // re-logging them here would duplicate output and, because these
        // console methods are wrapped, feed them back to the renderer forever.
        if (typeof message === 'string' && message.startsWith('[MAIN]')) return;

        rawConsole.log(`[RENDERER CONSOLE L${level}] ${message} (${sourceId}:${line})`);
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[WINDOW] render-process-gone', details);
    });

    mainWindow.on('unresponsive', () => {
        console.error('[WINDOW] main window became unresponsive');
    });

    mainWindow.once('ready-to-show', () => {
        clearTimeout(showFallbackTimer);
        console.info('[WINDOW] ready-to-show');
        mainWindow.show();
    });
    mainWindow.once('closed', () => {
        clearTimeout(showFallbackTimer);
        console.info('[WINDOW] closed');
        mainWindow = null;
        newsView = null;
        newsRefreshView = null;
    });
}

ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
});
ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
});
ipcMain.on('window-toggle-devtools', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.webContents.toggleDevTools();
});

ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

app.on('ready', () => setTimeout(createWindow, 100)); // Linux / MacOS transparancy fix
app.on('window-all-closed', () => app.quit());

let rpc = null;
let rpcActivityTimer = null;
const startTimestamp = new Date();

async function setActivity() {
    if (!rpc || !mainWindow || !rpc.user) {
        return;
    }

    rpc.user.setActivity({
        details: discordRPCConfig.details,
        state: discordRPCConfig.state,
        startTimestamp,
        largeImageKey: discordRPCConfig.largeImageKey,
        largeImageText: discordRPCConfig.largeImageText,
        smallImageKey: discordRPCConfig.smallImageKey,
        smallImageText: discordRPCConfig.smallImageText,
        instance: false,
    });
}

function initDiscordRpc() {
    try {
        rpc = new DiscordRpcClient({ clientId });

        rpc.on('ready', () => {
            setActivity();

            // Activity can only be set every 15 seconds.
            if (!rpcActivityTimer) {
                rpcActivityTimer = setInterval(() => {
                    setActivity();
                }, 15e3);
            }
        });

        rpc.on('disconnected', () => {
            if (rpcActivityTimer) {
                clearInterval(rpcActivityTimer);
                rpcActivityTimer = null;
            }
        });

        // Do not await; keep startup non-blocking.
        rpc.login().catch((e) => {
            console.warn('[DISCORD RPC] Login failed:', e && e.message ? e.message : e);
        });
    } catch (e) {
        console.warn('[DISCORD RPC] Init failed:', e && e.message ? e.message : e);
    }
}

ipcMain.on('open-directory-dialog', async (event, response) => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    // Always reply — send null when the user cancels — so renderers that guard a
    // "busy" flag on this reply (e.g. the setup window's install button) don't
    // get stuck waiting for a message that never arrives.
    const selectedPath = (!result.canceled && result.filePaths && result.filePaths[0])
        ? result.filePaths[0]
        : null;
    if (!event.sender.isDestroyed()) {
        event.sender.send(response, selectedPath);
    }
    log.info('Selected Directory Path', selectedPath);
});


// --- Config Update Queue Implementation ---
const configUpdateQueue = [];
let configUpdateInProgress = false;

// Helper: Deep merge patch into target (shallow for arrays)
function deepMergePatch(target, patch) {
    for (const key of Object.keys(patch)) {
        if (
            patch[key] && typeof patch[key] === 'object' &&
            !Array.isArray(patch[key]) &&
            target[key] && typeof target[key] === 'object' &&
            !Array.isArray(target[key])
        ) {
            deepMergePatch(target[key], patch[key]);
        } else {
            target[key] = patch[key];
        }
    }
    return target;
}

async function processConfigQueue() {
    if (configUpdateInProgress) return;
    configUpdateInProgress = true;
    try {
        while (configUpdateQueue.length > 0) {
            const nextUpdate = configUpdateQueue.shift();
            if (!nextUpdate || typeof nextUpdate !== 'object') {
                console.warn('[LAUNCHER CONFIG] Skipping malformed queue item.');
                continue;
            }

            try {
                let diskConfig = {};
                if (fs.existsSync(configFile)) {
                    try {
                        diskConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
                    } catch (e) {
                        console.error('[LAUNCHER CONFIG] Failed to load config from disk (queue):', e);
                    }
                }
                if (nextUpdate.patch) {
                    // Merge in correct precedence order:
                    // 1. Start with diskConfig (what was saved)
                    // 2. Merge in-memory config (newer state takes precedence)
                    // 3. Apply the new patch (newest change takes precedence)
                    let mergedConfig = deepMergePatch({ ...diskConfig }, config);
                    mergedConfig = deepMergePatch(mergedConfig, nextUpdate.patch);
                    let release;
                    try {
                        if (!fs.existsSync(configFile)) {
                            fs.writeFileSync(configFile, '{}');
                        }
                        release = await lockfile.lock(configFile, {
                            retries: {
                                retries: 5,
                                factor: 2,
                                minTimeout: 1 * 1000,
                                maxTimeout: 2 * 1000,
                                randomize: false,
                            }
                        });
                        console.info(`[LAUNCHER CONFIG] Saving merged config (patch):\n ${JSON.stringify(mergedConfig)}`);
                        fs.writeFileSync(configFile, JSON.stringify(mergedConfig));
                        config = mergedConfig;
                        if (nextUpdate.resolve) nextUpdate.resolve(true);
                    } catch (err) {
                        console.error(`[LAUNCHER CONFIG] Error (patch): ${err.message}`);
                        if (nextUpdate.reject) nextUpdate.reject(err);
                    } finally {
                        if (release) await release();
                    }
                } else if (nextUpdate.deleteKeys) {
                    // Start with current config and delete specified keys
                    let modifiedConfig = { ...config };
                    let changed = false;
                    for (const key of nextUpdate.deleteKeys) {
                        if (key in modifiedConfig) {
                            delete modifiedConfig[key];
                            changed = true;
                        }
                    }
                    if (changed) {
                        let release;
                        try {
                            if (!fs.existsSync(configFile)) {
                                fs.writeFileSync(configFile, '{}');
                            }
                            release = await lockfile.lock(configFile, {
                                retries: {
                                    retries: 5,
                                    factor: 2,
                                    minTimeout: 1 * 1000,
                                    maxTimeout: 2 * 1000,
                                    randomize: false,
                                }
                            });
                            fs.writeFileSync(configFile, JSON.stringify(modifiedConfig));
                            config = modifiedConfig;
                        } catch (err) {
                            console.error(`[LAUNCHER CONFIG] Error (delete): ${err.message}`);
                        } finally {
                            if (release) await release();
                        }
                    }
                    if (nextUpdate.resolve) nextUpdate.resolve(true);
                } else {
                    console.warn('[LAUNCHER CONFIG] Queue item had no patch or deleteKeys.');
                    if (nextUpdate.resolve) nextUpdate.resolve(false);
                }
            } catch (err) {
                if (nextUpdate.reject) nextUpdate.reject(err);
            }
        }
    } finally {
        configUpdateInProgress = false;
    }
}

// Queue a config patch update
function queueConfigPatch(patch) {
    return new Promise((resolve, reject) => {
        configUpdateQueue.push({ patch, resolve, reject });
        processConfigQueue();
    });
}

// IPC: Patch config (update only specified keys, queued)
ipcMain.handle('set-launcher-config', async (event, patch) => {
    await queueConfigPatch(patch);
    return true;
});

// --- Config Delete Queue Implementation ---
function queueConfigDelete(keys) {
    return new Promise((resolve, reject) => {
        configUpdateQueue.push({ deleteKeys: keys, resolve, reject });
        processConfigQueue();
    });
}

// IPC: Delete config keys (remove specified keys from config and save, queued)
ipcMain.handle('delete-launcher-config', async (event, keys) => {
    if (!Array.isArray(keys)) return false;
    await queueConfigDelete(keys);
    return true;
});

ipcMain.handle('get-launcher-config', async () => {
    // Wait for any startup migration/copy (guarded by the separate configFileMutex)
    // to finish before reading, so early readers don't see pre-migration/default values.
    try { await configFileMutex; } catch (e) { /* migration errors are logged elsewhere */ }
    // Wait for any queued config updates to finish before returning config
    const waitStart = Date.now();
    const maxWaitMs = 5000;
    while (configUpdateInProgress || configUpdateQueue.length > 0) {
        if (Date.now() - waitStart > maxWaitMs) {
            console.warn('[LAUNCHER CONFIG] get-launcher-config timed out waiting for queue; reading from disk.');
            break;
        }
        // Wait in 50ms intervals until the queue is empty and not in progress
        await new Promise(res => setTimeout(res, 50));
    }
    loadConfigFromDisk();
    return config;
});

async function modifyCfg(cfgPath, changes, isRemoveRequest) {
    if (!fs.existsSync(cfgPath)) {
        console.error(`[MODIFY CFG] File not found: ${cfgPath}`);
        return;
    }

    let release;
    try {
        // Acquire lock
        release = await lockfile.lock(cfgPath, {
            retries: {
                retries: 5,
                factor: 2,
                minTimeout: 1 * 1000,
                maxTimeout: 2 * 1000,
                randomize: false,
            }
        });

        const content = fs.readFileSync(cfgPath, 'utf-8');
        if (!content) {
            console.error(`[MODIFY CFG] File is empty or unreadable: ${cfgPath}`);
            return;
        }

        const lines = content.split(/\r?\n/);
        const resultLines = [];

        let currentSection = null;
        let sectionStartIndex = -1;
        let sectionEndIndex = -1;
        const sectionFoundMap = new Set();
        const handledKeys = {};

        for (const section of Object.keys(changes)) {
            handledKeys[section] = new Set();
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Section header
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                // If we were in a section, record the end index
                if (currentSection && sectionFoundMap.has(currentSection)) {
                    sectionEndIndex = resultLines.length;
                    // If add mode and any key was missing, insert it now
                    if (!isRemoveRequest) {
                        for (const [key, value] of Object.entries(changes[currentSection])) {
                            if (!handledKeys[currentSection].has(key)) {
                                console.log(`[MODIFY CFG] Section found but key (${key}) not present, adding to the end of section with value: ${value}`);
                                resultLines.splice(resultLines.length - 1, 0, `\t${key}=${value}`);
                                handledKeys[currentSection].add(key);
                            }
                        }
                    }
                }

                currentSection = trimmed.slice(1, -1);
                if (changes[currentSection]) {
                    sectionFoundMap.add(currentSection);
                    sectionStartIndex = resultLines.length;
                }

                resultLines.push(line);
                continue;
            }

            if (currentSection && changes[currentSection]) {
                let handledThisLine = false;

                for (const key of Object.keys(changes[currentSection])) {
                    if (trimmed.startsWith(`${key}=`)) {
                        if (isRemoveRequest) {
                            console.log(`[MODIFY CFG] Section found, key (${key}) present, removing key`);
                            handledThisLine = true;
                            handledKeys[currentSection].add(key);
                            break;
                        } else {
                            const value = changes[currentSection][key];
                            console.log(`[MODIFY CFG] Section found, key (${key}) present, updating value to: ${value}`);
                            resultLines.push(`\t${key}=${value}`);
                            handledThisLine = true;
                            handledKeys[currentSection].add(key);
                            break;
                        }
                    }
                }

                if (handledThisLine) continue;
            }

            resultLines.push(line);
        }

        // Handle sections that weren't found
        for (const [section, keyValues] of Object.entries(changes)) {
            if (!sectionFoundMap.has(section) && !isRemoveRequest) {
                const [[firstKey, firstValue]] = Object.entries(keyValues);
                console.log(`[MODIFY CFG] Section (${section}) not found, creating section with key (${firstKey}) and value: ${firstValue}`);
                if (resultLines.length > 0 && resultLines[resultLines.length - 1].trim() !== '') {
                    resultLines.push('');
                }
                resultLines.push(`[${section}]`);
                for (const [key, value] of Object.entries(keyValues)) {
                    resultLines.push(`\t${key}=${value}`);
                }
                resultLines.push('');
            }
        }

        // Handle unhandled keys in found sections
        for (const section of sectionFoundMap) {
            const keys = changes[section];
            for (const [key, value] of Object.entries(keys)) {
                if (!handledKeys[section].has(key) && !isRemoveRequest) {
                    console.log(`[MODIFY CFG] Section found but key (${key}) not present, adding to the end of section with value: ${value}`);
                    // Find last index of this section
                    const insertIndex = (() => {
                        for (let j = resultLines.length - 1; j >= 0; j--) {
                            if (resultLines[j].trim() === `[${section}]`) {
                                for (let k = j + 1; k < resultLines.length; k++) {
                                    if (resultLines[k].trim().startsWith('[')) return k;
                                }
                                return resultLines.length;
                            }
                        }
                        return resultLines.length;
                    })();
                    resultLines.splice(insertIndex - 1, 0, `\t${key}=${value}`);
                    handledKeys[section].add(key);
                }
            }
        }

        // Remove empty sections after key removals
        for (const section of sectionFoundMap) {
            const startIdx = resultLines.findIndex(line => line.trim() === `[${section}]`);
            if (startIdx === -1) continue;

            const endIdx = (() => {
                for (let i = startIdx + 1; i < resultLines.length; i++) {
                    if (resultLines[i].trim().startsWith('[')) return i;
                }
                return resultLines.length;
            })();

            const sectionBody = resultLines.slice(startIdx + 1, endIdx);
            const isEmpty = sectionBody.every(line =>
                line.trim() === '' || line.trim().startsWith('#')
            );

            if (isRemoveRequest && isEmpty) {
                console.log(`[MODIFY CFG] Section [${section}] is now empty, removing it`);
                resultLines.splice(startIdx, endIdx - startIdx);
                if (resultLines[startIdx] && resultLines[startIdx].trim() === '') {
                    resultLines.splice(startIdx, 1);
                }
            }
        }

        fs.writeFileSync(cfgPath, resultLines.join('\n'), 'utf-8');
    } catch (err) {
        console.error(`[MODIFY CFG] Error: ${err.message}`);
    } finally {
        // Release lock
        if (release) {
            await release();
        }
    }
}

ipcMain.handle('modify-cfg', async (event, cfgPath, changes, isRemove) => {
    // Validate that config.folder exists before proceeding
    if (!config.folder || typeof config.folder !== 'string') {
        console.error('[MODIFY CFG] Config folder not set or invalid');
        return false;
    }
    // Only the two known config keys are accepted; both resolve inside config.folder.
    // The old "any other string is a full path" fallback was an unbounded write sink
    // that no current caller uses (renderer always passes 'options' or 'login').
    let resolvedPath;
    if (cfgPath === 'options') {
        resolvedPath = path.join(config.folder, 'options.cfg');
    } else if (cfgPath === 'login') {
        resolvedPath = path.join(config.folder, 'login.cfg');
    } else {
        console.warn('[MODIFY CFG] Rejected unknown config key:', cfgPath);
        return false;
    }
    return await modifyCfg(resolvedPath, changes, isRemove);
});

ipcMain.on('setup-game', function () {
    setupGame();
});
    let rulesView = null;

    ipcMain.on('set-rules-view-bounds', (event, bounds) => {
        if (rulesView && rulesViewVisible) {
            rulesView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
        }
    });

    ipcMain.on('set-rules-view-visible', (_event, visible) => {
        rulesViewVisible = !!visible;
        if (!rulesViewVisible) {
            if (rulesView) rulesView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            if (rulesRefreshView) rulesRefreshView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            rulesRefreshState = 'hidden';
            applyRulesRefreshStateToOverlay();
        }
    });

    ipcMain.on('set-rules-refresh-bounds', (_event, bounds) => {
        if (rulesRefreshView && rulesViewVisible) {
            rulesRefreshView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
        }
    });

    ipcMain.on('set-rules-refresh-state', (_event, state) => {
        rulesRefreshState = state;
        applyRulesRefreshStateToOverlay();
    });

function setupGame() {
    if (setupWindow == null) {
        setupWindow = new BrowserWindow({
            parent: mainWindow,
            modal: true,
            width: 774,
            height: 600,
            useContentSize: true,
            center: true,
            resizable: false,
            fullscreen: false,
            fullscreenable: false,
            maximizable: false,
            minWidth: 774,
            minHeight: 600,
            maxWidth: 774,
            maxHeight: 600,
            transparent: true,
            show: false,
            autoHideMenuBar: true,
            titleBarStyle: 'hidden',
            frame: false,
            roundedCorners: false,
            webPreferences: {
                disableBlinkFeatures: 'Auxclick',
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false,
                preload: path.join(__dirname, 'setup', 'preload.js')
            },
            icon: path.join(__dirname, 'img/installer-icon.ico')
        });
        setupWindow.loadFile(path.join(__dirname, 'setup', 'index.html'));

        if (canOpenDevTools) {
            setupWindow.webContents.openDevTools({ mode: 'detach' });
        }

        // ── Rules / ToS WebContentsView ──────────────────────────────────
        rulesView = new WebContentsView({
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
        });
        setupWindow.contentView.addChildView(rulesView);
        rulesView.webContents.loadURL('https://swgawakening.com/launcher-terms.php');
        attachExternalNavigationPolicy(rulesView.webContents);

        // ── Rules refresh overlay ────────────────────────────────────────
        rulesRefreshView = new WebContentsView({
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
        });
        setupWindow.contentView.addChildView(rulesRefreshView);
        rulesRefreshView.setBackgroundColor('#00000000');
        const rulesRefreshIconPath = path.join(__dirname, 'img', 'buttons', 'btn-refresh.png');
        let rulesRefreshIconDataUrl = '';
        try {
            const rulesRefreshIconBase64 = fs.readFileSync(rulesRefreshIconPath).toString('base64');
            rulesRefreshIconDataUrl = `data:image/png;base64,${rulesRefreshIconBase64}`;
        } catch (err) {
            console.warn('[RULES REFRESH] Could not load refresh icon for overlay:', err && err.message ? err.message : err);
        }
        const rulesRefreshButtonStyle = rulesRefreshIconDataUrl
            ? `background:transparent url('${rulesRefreshIconDataUrl}') center center / 18px 18px no-repeat;`
            : `background:transparent;`;
        const rulesRefreshOverlayHtml = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}button{width:100%;height:100%;border:0;${rulesRefreshButtonStyle}color:#fff;font-size:13px;cursor:pointer;opacity:0}button::before{content:'↻';display:${rulesRefreshIconDataUrl ? 'none' : 'block'};line-height:16px;text-align:center}button.idle{opacity:.55}button.idle:hover{opacity:.85}button.spinner{opacity:.85;cursor:default;animation:swgaSpin 0.9s linear infinite}button.hidden{opacity:0;cursor:default}@keyframes swgaSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style></head><body><button id="refreshBtn" class="hidden" aria-label="Refresh terms" onclick="if(!this.classList.contains('spinner')) location.href='swga-refresh://reload'; return false;"></button><script>window.__setRefreshState=function(state){var btn=document.getElementById('refreshBtn');if(!btn)return;btn.className='';if(state==='spinner')btn.classList.add('spinner');else if(state==='idle')btn.classList.add('idle');else btn.classList.add('hidden');};<\/script></body></html>`;
        rulesRefreshView.webContents.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(rulesRefreshOverlayHtml)}`);
        rulesRefreshView.webContents.on('did-finish-load', () => {
            applyRulesRefreshStateToOverlay();
        });
        rulesRefreshView.webContents.on('will-navigate', (event, navUrl) => {
            event.preventDefault();
            if (typeof navUrl === 'string' && navUrl.startsWith('swga-refresh://reload')) {
                if (rulesView) rulesView.webContents.reloadIgnoringCache();
                if (setupWindow && !setupWindow.isDestroyed()) {
                    setupWindow.webContents.send('rules-refresh-clicked');
                }
            }
        });
        rulesRefreshView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

        rulesView.webContents.on('did-finish-load', () => {
            if (setupWindow && !setupWindow.isDestroyed()) {
                setupWindow.webContents.send('rules-view-loaded');
            }
        });

        setupWindow.once('ready-to-show', () => setupWindow.show());
        setupWindow.on('closed', () => {
            setupWindow = null;
            rulesView = null;
            rulesRefreshView = null;
        });
    } else {
        setupWindow.focus();
    }
}

ipcMain.on('setup-complete', (event, arg) => {
    mainWindow.webContents.send('setup-begin-install', arg);
});


    // ── News view IPC ─────────────────────────────────────────────────────────────
    ipcMain.on('set-news-view-bounds', (_event, bounds) => {
        if (newsView) newsView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    });
    ipcMain.on('set-news-refresh-bounds', (_event, bounds) => {
        if (newsRefreshView) newsRefreshView.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    });
    ipcMain.on('set-news-refresh-state', (_event, state) => {
        newsRefreshState = state;
        applyNewsRefreshStateToOverlay();
    });
    ipcMain.on('reload-news-view', () => {
        if (newsView) newsView.webContents.reloadIgnoringCache();
    });

    // ── File-system helpers ───────────────────────────────────────────────────────
    ipcMain.handle('file-exists', async (_event, filePath) => fs.existsSync(filePath));

    ipcMain.handle('cleanup-install-files', async (_event, folder, fileNames) => {
        const root = path.resolve(folder);
        for (const name of fileNames) {
            const p = path.join(folder, name);
            // Containment: a malformed entry (stray "..") shouldn't delete outside `folder`.
            const resolved = path.resolve(p);
            if (resolved !== root && !resolved.startsWith(root + path.sep)) {
                console.log('[CLEANUP] Skipped entry outside install folder: ' + name);
                continue;
            }
            if (fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch (e) { console.log('[CLEANUP] Could not delete: ' + name); }
            }
        }
        return true;
    });

    ipcMain.handle('check-game-installed', async (_event, folder) =>
        fs.existsSync(path.join(folder, 'qt-mt305.dll'))
    );

    ipcMain.handle('check-swg-source', async (_event, dir) =>
        fs.existsSync(path.join(dir, 'bottom.tre')) &&
        fs.existsSync(path.join(dir, 'data_animation_00.tre')) &&
        fs.existsSync(path.join(dir, 'data_texture_04.tre'))
    );

    ipcMain.handle('get-cleanup-info', async (_event, folder, files) => {
        let count = 0, size = 0;
        for (const file of files) {
            if (fs.existsSync(path.join(folder, file.name))) { count++; size += file.size; }
        }
        return { count, size };
    });

    // ── Install / patch system ────────────────────────────────────────────────────
    const install = require('./install');

    ipcMain.handle('start-install', async (_event, swgPath, fullScan, isResume) => {
            // Validate that config.folder exists before proceeding
            if (!config.folder || typeof config.folder !== 'string') {
                console.error('[INSTALL IPC] Config folder not set or invalid');
                throw new Error('Config folder not configured');
            }
            const installStart = Date.now();
            console.info('[INSTALL IPC] start-install requested', {
                swgPath,
                fullScan,
                isResume,
                folder: config.folder,
                login: config.login,
            });
        const emuPath = config.folder;
        const srcPath = swgPath || config.folder;
        install.progress = (completed, total) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('install-progress', { completed, total });
            }
        };
        install.onError = (message) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('install-error', String(message || 'Install failed'));
            }
        };
            try {
                install.install(srcPath, emuPath, fullScan, config.login, isResume);
            } catch (err) {
                console.error('[INSTALL IPC] start-install failed', err);
                throw err;
            }
            console.info('[INSTALL IPC] start-install dispatched', {
                elapsedMs: Date.now() - installStart,
                srcPath,
                emuPath,
                isResume,
            });
        return true;
    });

        ipcMain.handle('cancel-install', async () => {
            console.info('[INSTALL IPC] cancel-install requested');
            install.cancel();
            return true;
        });

    ipcMain.handle('get-install-resume-state', async () => {
        const state = install.getResumeState();
        return {
            completedFiles: Array.from(state.completedFiles.entries()),
            completedBytes: state.completedBytes,
        };
    });

    ipcMain.handle('clear-install-resume-state', async () => {
        install.clearResumeState();
        return true;
    });

    // ── EXE patching (FPS) ────────────────────────────────────────────────────────
    // Read-only: returns current FPS from exe without modifying it.
    ipcMain.handle('read-exe-fps', async (_event) => {
        // Validate that config.folder exists before proceeding
        if (!config.folder || typeof config.folder !== 'string') {
            console.error('[READ EXE FPS] Config folder not set or invalid');
            return { exeFps: null, error: 'Config folder not configured' };
        }
        const exePath = path.join(config.folder, 'SWGEmu.exe');
        const { Worker } = require('worker_threads');
        return new Promise((resolve) => {
            const workerCode = `
                const { workerData, parentPort } = require('worker_threads');
                const fs = require('fs');
                try {
                    const rfd = fs.openSync(workerData.exePath, 'r');
                    const rbuf = Buffer.alloc(7);
                    const bytesRead = fs.readSync(rfd, rbuf, 0, 7, 0x1153);
                    fs.closeSync(rfd);
                    if (bytesRead === 7 && rbuf[0] === 0xc7 && rbuf[1] === 0x45 && rbuf[2] === 0x94) {
                        const exeFps = rbuf.readFloatLE(3);
                        parentPort.postMessage({ exeFps });
                    } else {
                        parentPort.postMessage({ exeFps: null, reason: 'opcode_mismatch', bytesRead, opcodeBytes: rbuf.slice(0, 3).toString('hex') });
                    }
                } catch (err) {
                    parentPort.postMessage({ exeFps: null, error: err.message, code: err.code });
                }
            `;
            const worker = new Worker(workerCode, { eval: true, workerData: { exePath } });
            worker.on('message', (result) => resolve(result));
            worker.on('error', (err) => resolve({ exeFps: null, error: err.message }));
        });
    });

    // Reads current FPS from exe, writes desiredFps if it differs, then replies.
    // Runs entirely in a worker thread — main process event loop is never blocked.
    ipcMain.on('patch-exe-fps', (_event, desiredFps) => {
        // Validate that config.folder exists before proceeding
        if (!config.folder || typeof config.folder !== 'string') {
            console.error('[PATCH EXE FPS] Config folder not set or invalid');
            if (_event && _event.sender && !_event.sender.isDestroyed()) {
                _event.sender.send('exe-fps-ready', { patched: false, error: 'Config folder not configured' });
            }
            return;
        }
        const exePath = path.join(config.folder, 'SWGEmu.exe');
        const sender = _event.sender;
        const { Worker } = require('worker_threads');
        const workerCode = `
            const { workerData, parentPort } = require('worker_threads');
            const fs = require('fs');
            function patchFps() {
                try {
                    // Read current FPS value (7 bytes at 0x1153: opcode + offset + float)
                    const rfd = fs.openSync(workerData.exePath, 'r');
                    const rbuf = Buffer.alloc(7);
                    const bytesRead = fs.readSync(rfd, rbuf, 0, 7, 0x1153);
                    fs.closeSync(rfd);
                    if (bytesRead !== 7 || rbuf[0] !== 0xc7 || rbuf[1] !== 0x45 || rbuf[2] !== 0x94) {
                        parentPort.postMessage({ patched: false, reason: 'opcode_mismatch' });
                        return;
                    }
                    const currentFps = rbuf.readFloatLE(3);
                    const desired = workerData.desiredFps;
                    if (!isFinite(desired) || Math.abs(currentFps - desired) <= 0.01) {
                        parentPort.postMessage({ patched: false, reason: 'no_change_needed', currentFps });
                        return;
                    }
                    // Write new FPS
                    const wfd = fs.openSync(workerData.exePath, 'r+');
                    const wbuf = Buffer.alloc(4);
                    wbuf.writeFloatLE(desired);
                    fs.writeSync(wfd, wbuf, 0, 4, 0x1156);
                    fs.closeSync(wfd);
                    // Read-back verification
                    const vfd = fs.openSync(workerData.exePath, 'r');
                    const vbuf = Buffer.alloc(4);
                    fs.readSync(vfd, vbuf, 0, 4, 0x1156);
                    fs.closeSync(vfd);
                    const verifiedFps = vbuf.readFloatLE(0);
                    if (Math.abs(verifiedFps - desired) > 0.01) {
                        parentPort.postMessage({ patched: false, reason: 'verify_failed', verifiedFps, desired });
                        return;
                    }
                    parentPort.postMessage({ patched: true, verifiedFps });
                } catch (err) {
                    parentPort.postMessage({ patched: false, error: err.message, code: err.code });
                }
            }
            patchFps();
        `;
        const worker = new Worker(workerCode, {
            eval: true,
            workerData: { exePath, desiredFps: Number(desiredFps) }
        });
        worker.on('message', (result) => {
            if (!sender.isDestroyed()) sender.send('exe-fps-ready', result);
        });
        worker.on('error', (err) => {
            if (!sender.isDestroyed()) sender.send('exe-fps-ready', { patched: false, error: err.message });
        });
    });

    // ── Game / tool launching ─────────────────────────────────────────────────────
    const _childProcess = require('child_process');
    const _os = require('os');

    ipcMain.handle('spawn-game', async (_event, folder, launchArgs, ramMB) => {
        const env = Object.assign({}, process.env, { SWGCLIENT_MEMORY_SIZE_MB: String(ramMB) });
        const sender = _event.sender;
        if (_os.platform() === 'win32') {
            const child = _childProcess.spawn('SWGEmu.exe', launchArgs,
                { cwd: folder, env, detached: false, stdio: 'ignore' });
            // Wait briefly to confirm window opened, then re-enable button
            setTimeout(() => {
                if (!child.killed && !sender.isDestroyed()) {
                    sender.send('game-launched');
                }
            }, 500);
            child.on('exit', () => {
                if (!sender.isDestroyed()) sender.send('game-exited');
            });
            child.unref();
        } else {
            const child = _childProcess.exec('wine SWGEmu.exe',
                { cwd: folder, env, detached: false, stdio: 'ignore' }, () => {});
            // Wait briefly to confirm window opened, then re-enable button
            setTimeout(() => {
                if (!child.killed && !sender.isDestroyed()) {
                    sender.send('game-launched');
                }
            }, 500);
            child.on('exit', () => {
                if (!sender.isDestroyed()) sender.send('game-exited');
            });
            child.unref();
        }
        return true;
    });

    ipcMain.handle('spawn-exe', async (_event, folder, exe) => {
        if (_os.platform() === 'win32') {
            const child = _childProcess.spawn('cmd', ['/c', path.join(folder, exe)],
                { cwd: folder, detached: true, stdio: 'ignore' });
            child.unref();
        } else {
            const child = _childProcess.exec(`wine ${exe}`,
                { cwd: folder, detached: true, stdio: 'ignore' }, () => {});
            child.unref();
        }
        return true;
    });

    // ── Shell ─────────────────────────────────────────────────────────────────────
    ipcMain.handle('open-external', async (_event, extUrl) => {
        // Only allow http(s) — never hand file://, UNC, or custom-protocol URIs to the
        // OS shell. Mirrors the openExternalSafe guard used by the embedded web views.
        if (typeof extUrl === 'string' && /^https?:\/\//i.test(extUrl)) {
            await shell.openExternal(extUrl);
            return true;
        }
        console.warn('[SHELL] Blocked open-external for non-http(s) URL:', extUrl);
        return false;
    });

    autoUpdater.on('update-downloaded', (info) => {
    autoUpdater.quitAndInstall();
});

autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', progress);
    }
});

autoUpdater.on('update-available', info => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('downloading-update', 'Downloading V' + info.version);
    }
});

app.on('ready', function () {
    // Initialize after window creation path is underway to avoid startup lockups.
    setTimeout(() => initDiscordRpc(), 500);

    if (!isDev)
        autoUpdater.checkForUpdates();
});
