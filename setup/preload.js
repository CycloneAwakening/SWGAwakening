'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Load static configs in the privileged preload context
const cleanupConfig = require(path.join(__dirname, '..', 'json', 'cleanup.json'));

contextBridge.exposeInMainWorld('electronAPI', {

    // ── Static config data
    cleanupConfig,

    // ── Path utilities
    pathJoin: (...parts) => path.join(...parts),

    // ── Launcher config
    getConfig:    ()      => ipcRenderer.invoke('get-launcher-config'),
    setConfig:    (patch) => ipcRenderer.invoke('set-launcher-config', patch),
    deleteConfig: (keys)  => ipcRenderer.invoke('delete-launcher-config', keys),

    // ── Window management
    close: () => ipcRenderer.send('window-close'),

    // ── Logging
    logToFile: (level, message) => ipcRenderer.invoke('log-to-file', { level, message }),

    // ── Directory dialog
    openDirectoryDialog: (responseChannel) =>
        ipcRenderer.send('open-directory-dialog', responseChannel),

    onDirectorySelected: (callback) =>
        ipcRenderer.on('selected-directory', (_event, selectedPath) => callback(selectedPath)),

    onInstallDirectorySelected: (callback) =>
        ipcRenderer.on('install-selected', (_event, selectedPath) => callback(selectedPath)),

    // ── File-system helpers
    // Returns info about cleanup files present in folder: { count, size }
    getCleanupInfo: (folder, files) =>
        ipcRenderer.invoke('get-cleanup-info', folder, files),

    // Check dir contains required SWG source files
    checkSwgSource: (dir) => ipcRenderer.invoke('check-swg-source', dir),

    // ── Setup completion (triggers main window install)
    setupComplete: (args) => ipcRenderer.send('setup-complete', args),

    // ── Shell
    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    // ── Rules / ToS WebContentsView
    setRulesViewBounds: (bounds) => ipcRenderer.send('set-rules-view-bounds', bounds),
    setRulesViewVisible: (visible) => ipcRenderer.send('set-rules-view-visible', visible),

    // ── Rules refresh overlay
    setRulesRefreshBounds: (bounds) => ipcRenderer.send('set-rules-refresh-bounds', bounds),
    setRulesRefreshState: (state) => ipcRenderer.send('set-rules-refresh-state', state),
    onRulesViewLoaded: (callback) =>
        ipcRenderer.on('rules-view-loaded', () => callback()),
    onRulesRefreshClicked: (callback) =>
        ipcRenderer.on('rules-refresh-clicked', () => callback()),
});

// Mirror the main preload's global handlers so setup-window failures are logged
// to file instead of vanishing silently.
window.addEventListener('error', (event) => {
    const message = `[SETUP WINDOW ERROR] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
    ipcRenderer.invoke('log-to-file', { level: 'error', message }).catch(() => {});
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason ? String(event.reason) : 'Unknown rejection reason';
    ipcRenderer.invoke('log-to-file', { level: 'error', message: `[SETUP WINDOW REJECTION] ${reason}` }).catch(() => {});
});
