require("@electron/remote/main").initialize();
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

var documentsDir = require('os').homedir() + '/Documents';
var myGamesDir = documentsDir + '/My Games';
var swgaDir = myGamesDir + '/SWG - Awakening';

app.commandLine.appendSwitch("disable-http-cache");

if (!fs.existsSync(documentsDir))
    fs.mkdirSync(documentsDir);

if (!fs.existsSync(myGamesDir))
    fs.mkdirSync(myGamesDir);

if (!fs.existsSync(swgaDir))
    fs.mkdirSync(swgaDir);

var logFile = swgaDir + '/awakening-launcher-log.txt';

if (!fs.existsSync(logFile))
    fs.writeFileSync(logFile, "- Awakening Launcher Log File -\n");

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

    require('@electron/remote/main').enable(mainWindow.webContents);
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

//Originally had this in the renderer, proved unreliable to have it there so offloaded it to main
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
            width: 775,
            height: 600,
            useContentSize: true,
            center: true,
            resizable: false,
            fullscreen: false,
            fullscreenable: false,
            maximizable: false,
            maxWidth: 810,
            maxHeight: 610,
            transparent: true,
            show: false,
            frame: false,
            autoHideMenuBar: true,
            webPreferences: {
                disableBlinkFeatures: "Auxclick",
                nodeIntegration: true,
                enableRemoteModule: true,
                contextIsolation: false,
                webviewTag: true
            },
            icon: path.join(__dirname, 'img/installer-icon.ico')
        });

        require('@electron/remote/main').enable(setupWindow.webContents);
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
