'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Load static configs in the privileged preload context (Node.js available here)
const serverConfig  = require('./json/server.json');
const cleanupConfig = require('./json/cleanup.json');
const appVersion    = require('./package.json').version;

contextBridge.exposeInMainWorld('electronAPI', {

    // ── Static config data ──────────────────────────────────────────────────
    serverConfig,
    cleanupConfig,
    appVersion,

    // ── Path utilities (safe – string-only operations) ──────────────────────
    pathJoin: (...parts) => path.join(...parts),

    // ── Launcher config ──────────────────────────────────────────────────────
    getConfig:    ()      => ipcRenderer.invoke('get-launcher-config'),
    setConfig:    (patch) => ipcRenderer.invoke('set-launcher-config', patch),
    deleteConfig: (keys)  => ipcRenderer.invoke('delete-launcher-config', keys),

    // ── Window management ────────────────────────────────────────────────────
    minimize:      () => ipcRenderer.send('window-minimize'),
    close:         () => ipcRenderer.send('window-close'),
    toggleDevTools:() => ipcRenderer.send('window-toggle-devtools'),

    // ── User-data path ───────────────────────────────────────────────────────
    getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

    // ── Logging ──────────────────────────────────────────────────────────────
    logToFile: (level, message) => ipcRenderer.invoke('log-to-file', { level, message }),

    // ── Game-config file (.cfg) manipulation ─────────────────────────────────
    // cfgKey: 'options' | 'login'  (resolved to full path in main process)
    modifyCfg: (cfgKey, changes, isRemove) =>
        ipcRenderer.invoke('modify-cfg', cfgKey, changes, isRemove),

    // ── Directory dialog ─────────────────────────────────────────────────────
    openDirectoryDialog: (responseChannel) =>
        ipcRenderer.send('open-directory-dialog', responseChannel),

    onDirectorySelected: (callback) =>
        ipcRenderer.on('selected-directory', (_event, selectedPath) => callback(selectedPath)),

    // ── File-system helpers (path construction done in main) ─────────────────
    // Check if config.folder contains the SWG client (qt-mt305.dll present)
    checkGameInstalled: (folder) =>
        ipcRenderer.invoke('check-game-installed', folder),

    // Bulk-delete cleanup files inside folder (from cleanup.json)
    cleanupFiles: (folder, fileNames) =>
        ipcRenderer.invoke('cleanup-install-files', folder, fileNames),

    // ── Install / patch system ───────────────────────────────────────────────
    // swgPath: source SWG dir (null = use config.folder in main); fullScan: bool; isResume: skip completed files
    startInstall: (swgPath, fullScan, isResume) =>
        ipcRenderer.invoke('start-install', swgPath, fullScan, isResume),

    cancelInstall: () => ipcRenderer.invoke('cancel-install'),

    getInstallResumeState: () => ipcRenderer.invoke('get-install-resume-state'),

    clearInstallResumeState: () => ipcRenderer.invoke('clear-install-resume-state'),

    onInstallProgress: (callback) =>
        ipcRenderer.on('install-progress', (_event, data) => callback(data.completed, data.total)),

    onInstallError: (callback) =>
        ipcRenderer.on('install-error', (_event, message) => callback(message)),

    // True while at least one game client is running (detected from the exe's
    // write lock, so clients started outside this launcher session count too).
    isGameRunning: () => ipcRenderer.invoke('is-game-running'),

    // ── EXE patching (FPS) ───────────────────────────────────────────────────
    // Reads actual FPS from exe (for initialization verification).
    readExeFps: () => ipcRenderer.invoke('read-exe-fps'),
    // Fires off a worker-thread read+compare+write; calls callback when done.
    startPatchExeFps: (desiredFps) => ipcRenderer.send('patch-exe-fps', desiredFps),
    onExeFpsReady: (callback) =>
        ipcRenderer.once('exe-fps-ready', (_event, result) => callback(result)),

    // ── Game / tool launching ────────────────────────────────────────────────
    spawnGame: (folder, launchArgs, ramMB) =>
        ipcRenderer.invoke('spawn-game', folder, launchArgs, ramMB),
    onGameLaunched: (callback) =>
        ipcRenderer.on('game-launched', () => callback()),
    onGameExited: (callback) =>
        ipcRenderer.on('game-exited', () => callback()),

    spawnExe: (folder, exe) =>
        ipcRenderer.invoke('spawn-exe', folder, exe),

    // ── Shell ────────────────────────────────────────────────────────────────
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // ── Setup wizard ─────────────────────────────────────────────────────────
    setupGame: () => ipcRenderer.send('setup-game'),

    // ── News / updates WebContentsView ───────────────────────────────────────
    // Notify main process of the placeholder div's position so it can size the view
    setNewsViewBounds: (bounds) => ipcRenderer.send('set-news-view-bounds', bounds),
    setNewsRefreshBounds: (bounds) => ipcRenderer.send('set-news-refresh-bounds', bounds),
    setNewsRefreshState: (state) => ipcRenderer.send('set-news-refresh-state', state),
    reloadNewsView:    () => ipcRenderer.send('reload-news-view'),

    onNewsViewLoaded: (callback) =>
        ipcRenderer.on('news-view-loaded', () => callback()),

    onNewsRefreshClicked: (callback) =>
        ipcRenderer.on('news-refresh-clicked', () => callback()),

    // ── Auto-updater events ──────────────────────────────────────────────────
    onDownloadingUpdate: (callback) =>
        ipcRenderer.on('downloading-update', (_event, text) => callback(text)),

    onDownloadProgress: (callback) =>
        ipcRenderer.on('download-progress', (_event, info) => callback(info)),

    // Fired by main process after setup window closes and install should begin
    onSetupBeginInstall: (callback) =>
        ipcRenderer.on('setup-begin-install', (_event, args) => callback(args)),
});

// ── Mirror main-process console output into this window's DevTools console ────
// Main forwards its console.log/info/warn/error over the 'main-console' channel;
// print each line (prefixed [MAIN]) so it shows up in the renderer DevTools.
ipcRenderer.on('main-console', (_event, payload) => {
    if (!payload) return;
    const level = payload.level;
    const fn = (level === 'error' || level === 'warn' || level === 'info')
        ? console[level]
        : console.log;
    fn(`[MAIN] ${payload.text}`);
});

window.addEventListener('error', (event) => {
    const message = `[WINDOW ERROR] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
    ipcRenderer.invoke('log-to-file', { level: 'error', message }).catch(() => {});
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason ? String(event.reason) : 'Unknown rejection reason';
    ipcRenderer.invoke('log-to-file', { level: 'error', message: `[WINDOW REJECTION] ${reason}` }).catch(() => {});
});
