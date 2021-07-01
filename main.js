const { app, BrowserView, BrowserWindow, ipcMain, dialog } = require('electron');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const url = require('url');
const fs = require('fs');

var setupWindow = null;
var err;

var documentsDir = require('os').homedir() + '/Documents';
var myGamesDir = documentsDir + '/My Games';
var swgaDir = myGamesDir + '/SWG - Awakening';

app.commandLine.appendSwitch("disable-http-cache");

if (!fs.existsSync(documentsDir)) {
    fs.mkdirSync(documentsDir);
}

if (!fs.existsSync(myGamesDir))
    fs.mkdirSync(myGamesDir);

if (!fs.existsSync(swgaDir))
    fs.mkdirSync(swgaDir);

var setupLogFile = swgaDir + '/SWGAwakening-Launcher-log.txt';

if (!fs.existsSync(setupLogFile))
    fs.writeFileSync(setupLogFile, " ");

log.transports.file.file = swgaDir + '/SWGAwakening-Launcher-log.txt';
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
        frame: false,
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
    /* FOR FUTURE USE IF ELECTRON FORCES USE OF BROWSERVIEW
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
    //if (require('electron-is-dev')) mainWindow.webContents.openDevTools();
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.once('closed', () => mainWindow = null);
}

app.on('ready', () => setTimeout(createWindow, 100)); // Linux / MacOS transparancy fix
app.on('window-all-closed', () => app.quit());


ipcMain.on('open-directory-dialog', async (event, response) => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (result.filePaths[0] != undefined) {
        event.sender.send(response, result.filePaths[0]);
    }
    log.info('Selected Directory Path', result.filePaths[0]);
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
    if (!require('electron-is-dev'))
        autoUpdater.checkForUpdates();
});
