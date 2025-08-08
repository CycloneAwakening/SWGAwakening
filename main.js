const { app, WebContentsView, BrowserView, BrowserWindow, ipcMain, dialog } = require('electron');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const url = require('url');
const fs = require('fs');
const lockfile = require('proper-lockfile');
const isDev = require('electron-is-dev');
const discordRPC = require('discord-rpc');
const discordRPCConfig = require('./json/discordrpc');

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

// Old data store location for migration
const homeDir = require('os').homedir();
const documentsDir = 'Documents';
const myGamesDir = 'My Games';
const swgaDir = 'SWG - Awakening';
const oldLauncherStoreDir = path.join(homeDir, documentsDir, myGamesDir, swgaDir);

// Migrate data from old location if it exists and new location does not have a config file (indicator that migration has already happened)
// This ensures we don't overwrite existing data in the new location
if (fs.existsSync(oldLauncherStoreDir) && !fs.existsSync(path.join(launcherDataStoreDir, 'awakening-launcher-config.json'))) {
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
}

//Change config naming conventions
const oldConfigFile = path.join(launcherDataStoreDir, 'SWG-Awakening-Launcher-config.json');

const configFile = path.join(launcherDataStoreDir, 'awakening-launcher-config.json');


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

app.commandLine.appendSwitch("disable-http-cache");

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

let mainWindow;

function createWindow() {
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
            disableBlinkFeatures: "Auxclick",
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false,
            webviewTag: true
        },
        icon: path.join(__dirname, 'img/launcher-icon.ico')
    });
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file:',
        slashes: true
    }));
    /* FOR FUTURE USE IF ELECTRON FORCES USE OF BROWSERVIEW - THIS IS NOW DEPRECATED USE WEBCONTENTSVIEW
    const feed = new BrowserView()
    mainWindow.setBrowserView(feed)
    feed.setBounds({ 
       x: 37,
       y: 136, 
       width: 406, 
       height: 320 
   });
   feed.webContents.loadURL('https://swgawakening.com/launcher-home.php')
   */


    //if (isDev) mainWindow.webContents.openDevTools();
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.once('closed', () => mainWindow = null);
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

discordRPC.register(clientId);

const rpc = new discordRPC.Client({ transport: 'ipc' });
const startTimestamp = new Date();

async function setActivity() {
    if (!rpc || !mainWindow) {
        return;
    }

    rpc.setActivity({
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

rpc.on('ready', () => {
    setActivity();

    //activity can only be set every 15 seconds
    setInterval(() => {
        setActivity();
    }, 15e3);
});

rpc.login({ clientId }).catch(console.error);

ipcMain.on('open-directory-dialog', async (event, response) => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.filePaths[0] != undefined) {
        event.sender.send(response, result.filePaths[0]);
    }
    log.info('Selected Directory Path', result.filePaths[0]);
});

// IPC: Set config (update global and disk)
async function setLauncherConfig(newConfig) {
    let release;
    try {
        if (!fs.existsSync(launcherDataStoreDir)) {
            fs.mkdirSync(launcherDataStoreDir, { recursive: true });
        }
        // Acquire lock if config file exists
        if (fs.existsSync(configFile)) {
            release = await lockfile.lock(configFile, {
                retries: {
                    retries: 5,
                    factor: 2,
                    minTimeout: 1 * 1000,
                    maxTimeout: 2 * 1000,
                    randomize: false,
                }
            });
            console.info(`[LAUNCHER CONFIG] Saving config:\n ${JSON.stringify(newConfig)}`);
            fs.writeFileSync(configFile, JSON.stringify(newConfig));
            if (release) {
                await release();
            }
        } else {
            console.info(`[LAUNCHER CONFIG] Saving config:\n ${JSON.stringify(newConfig)}`);
            fs.writeFileSync(configFile, JSON.stringify(newConfig));
        }
        // Update global config
        config = newConfig;
    } catch (err) {
        console.error(`[LAUNCHER CONFIG] Error: ${err.message}`);
    }
}

// IPC: Set config (update global and disk)
ipcMain.handle('set-launcher-config', async (event, newConfig) => {
    await setLauncherConfig(newConfig);
    return true;
});

// IPC: Get current config
ipcMain.handle('get-launcher-config', async () => {
    // Always reload from disk to ensure latest
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
    return await modifyCfg(cfgPath, changes, isRemove);
});

ipcMain.on('setup-game', function () {
    setupGame();
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
                disableBlinkFeatures: "Auxclick",
                nodeIntegration: true,
                enableRemoteModule: true,
                contextIsolation: false,
                webviewTag: true
            },
            icon: path.join(__dirname, 'img/installer-icon.ico')
        });
        setupWindow.loadURL(url.format({
            pathname: path.join(__dirname, 'setup', 'index.html'),
            protocol: 'file:',
            slashes: true
        }));
        setupWindow.once('ready-to-show', () => setupWindow.show());
        setupWindow.on('closed', () => {
            setupWindow = null;
        });
    } else {
        setupWindow.focus();
    }
}

ipcMain.on('setup-complete', (event, arg) => {
    mainWindow.webContents.send('setup-begin-install', arg);
});


autoUpdater.on('update-downloaded', (info) => {
    autoUpdater.quitAndInstall();
});

autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('download-progress', progress);
});

autoUpdater.on('update-available', info => {
    mainWindow.webContents.send('downloading-update', 'Downloading V' + info.version);
});

app.on('ready', function () {
    if (!isDev)
        autoUpdater.checkForUpdates();
});
