const cleanup = window.electronAPI.cleanupConfig;
const pathJoin = window.electronAPI.pathJoin;

const sidebarLinks = document.getElementById('sidebarLinks');
const rulesAgree = document.getElementById('ToSReadOnline');

const folderBox = document.getElementById('folder'); // SWG Awakening Folder Location
const browseBtn = document.getElementById('browse'); // Set Installation Location Button
const installBtn = document.getElementById('install'); // SWG Base Installation Button
const swgFolderBox = document.getElementById('swgFolder'); // SWG Awakening Folder Location

const cancelBtn = document.getElementById('cancel');

//const minBtn = document.getElementById('minimize');
const closeBtn = document.getElementById('close');

const setupPrev = document.getElementById('setupPrev');
const setupNext = document.getElementById('setupNext');
const setupCancel = document.getElementById('setupCancel');

const rulesRegView = document.getElementById('rulesRegView');
const rulesRefresh = document.getElementById('rulesRefresh');

const agreeRules = document.getElementById('agreeRules');
const agreeOwner = document.getElementById('agreeOwner');

const swgDirSection = document.getElementById('swgDirSection');
const swgInstallMessageSuccess = document.getElementById('swgInstallMessageSuccess');
const swgInstallMessageFail = document.getElementById('swgInstallMessageFail');

const cleanUpFiles = document.getElementById('cleanUpFilesSection');
const agreeCleanUp = document.getElementById('agreeCleanUp');
const cleanUpCount = document.getElementById('cleanUpCount');
const cleanUpSize = document.getElementById('cleanUpSize');



// Use Electron's userData directory for the launcher data store

let config = { folder: 'C:\\SWGAwakening' };
async function loadConfig() {
    config = await window.electronAPI.getConfig();
}
async function saveConfig(patch) {
    await window.electronAPI.setConfig(patch);
    // Update local config object
    if (patch && typeof patch === 'object') {
        for (const key in patch) {
            config[key] = patch[key];
        }
    }
}
async function deleteConfigKeys(keys) {
    await window.electronAPI.deleteConfig(keys);
    // Remove keys from local config object
    if (Array.isArray(keys)) {
        for (const key of keys) {
            delete config[key];
        }
    }
}

// On startup, load config and initialize UI
let configReady = loadConfig().then(() => {
    folderBox.value = config.folder;
    fileCleanUp();
});

function updateRulesViewBounds() {
    const rect = rulesRegView.getBoundingClientRect();
    window.electronAPI.setRulesViewBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    });

    const refreshRect = rulesRefresh.getBoundingClientRect();
    window.electronAPI.setRulesRefreshBounds({
        x: Math.round(refreshRect.left),
        y: Math.round(refreshRect.top),
        width: Math.max(1, Math.round(refreshRect.width)),
        height: Math.max(1, Math.round(refreshRect.height))
    });
}

function isRulesScreenActive() {
    const rulesScreen = document.getElementById('rulesAgree');
    return !!(rulesScreen && rulesScreen.classList.contains('active'));
}

function syncRulesViewVisibility() {
    const visible = isRulesScreenActive();
    window.electronAPI.setRulesViewVisible(visible);
    if (!visible) {
        rulesRefresh.disabled = true;
        rulesRefresh.className = 'rules-refresh hidden';
        window.electronAPI.setRulesRefreshState('hidden');
        return;
    }

    updateRulesViewBounds();
    if (rulesRefresh.classList.contains('spinner')) return;
    rulesRefresh.disabled = false;
    rulesRefresh.className = 'rules-refresh idle';
    window.electronAPI.setRulesRefreshState('idle');
}

window.addEventListener('resize', updateRulesViewBounds);
window.addEventListener('load', updateRulesViewBounds);
setTimeout(updateRulesViewBounds, 50);
setTimeout(updateRulesViewBounds, 350);
setTimeout(syncRulesViewVisibility, 50);

window.electronAPI.onRulesViewLoaded(function () {
    if (!isRulesScreenActive()) {
        rulesRefresh.className = 'rules-refresh hidden';
        window.electronAPI.setRulesRefreshState('hidden');
        return;
    }

    rulesRefresh.className = 'rules-refresh hidden';
    window.electronAPI.setRulesRefreshState('hidden');
    setTimeout(function () {
        if (!isRulesScreenActive()) return;
        rulesRefresh.disabled = false;
        rulesRefresh.className = 'rules-refresh idle';
        window.electronAPI.setRulesRefreshState('idle');
        updateRulesViewBounds();
    }, 2000);
});

window.electronAPI.onRulesRefreshClicked(function () {
    rulesRefresh.disabled = true;
    rulesRefresh.className = 'rules-refresh spinner';
    window.electronAPI.setRulesRefreshState('spinner');
});

rulesRefresh.addEventListener('click', function () {
    rulesRefresh.disabled = true;
    rulesRefresh.className = 'rules-refresh spinner';
    window.electronAPI.setRulesRefreshState('spinner');
});


closeBtn.addEventListener('click', () => window.electronAPI.close());

setupCancel.addEventListener('click', function (event) {
    window.electronAPI.close();
});

agreeRules.addEventListener('click', function (event) {
    if (agreeRules.checked)
        setupNext.disabled = false;
    else
        setupNext.disabled = true;
});

agreeOwner.addEventListener('click', function (event) {
    if (agreeOwner.checked) {
        swgDirSection.style.visibility = 'visible';
        swgDirSection.style.opacity = '1';
        //setupNext.disabled = false;
    } else {
        swgDirSection.style.visibility = 'hidden';
        swgDirSection.style.opacity = '0';
        setupNext.disabled = true;
    }
});

setupNext.addEventListener('click', function (event) {
    changeActiveScreen(this);
});

setupPrev.addEventListener('click', function (event) {
    changeActiveScreen(this);
});

function changeActiveScreen(button) {
    var i, screens, activeScreen, args = {};
    screens = document.getElementsByClassName("setup-tab");
    for (i = 0; i < screens.length; i++) {
        if (screens[i].classList.contains("active"))
            activeScreen = screens[i];
        screens[i].className = screens[i].className.replace(" active", "");
    }
    switch (activeScreen.id) {
        case "rulesAgree":
            if (navButtonNext(button.id)) {
                document.getElementById("installDir").classList.add("active");
                setupPrev.style.visibility = 'visible';
            }
            break;
        case "installDir":
            if (navButtonNext(button.id)) {
                document.getElementById("swgInstall").classList.add("active");
                setupNext.disabled = true;
                setupNext.innerHTML = "Finish";
                setupNext.className = "swga-button swga-btn-icon swga-btn-icon-right setup-next-finish";
            } else {
                document.getElementById("rulesAgree").classList.add("active");
                agreeRules.checked = false;
                agreeOwner.checked = false;
                setupNext.disabled = true;
                setupPrev.style.visibility = 'hidden';
            }
            break;
        case "swgInstall":
            if (navButtonNext(button.id)) {
                console.log(agreeCleanUp.value);
                args = { "swgdir": swgFolderBox.value, "cleanup": agreeCleanUp.checked };
                window.electronAPI.setupComplete(args);
                window.electronAPI.close();
            } else {
                setupNext.innerHTML = "Next";
                setupNext.className = "swga-button swga-btn-icon swga-btn-icon-right";
                agreeOwner.checked = false;
                setupNext.disabled = false;
                swgDirSection.style.visibility = 'hidden';
                swgDirSection.style.opacity = '0';
                document.getElementById("installDir").classList.add("active");
            }
            break;
        default:
            window.electronAPI.close();
    }

    syncRulesViewVisibility();
}

function navButtonNext(button) {
    if (button == "setupNext")
        return true;
    else
        return false;
}

async function fileCleanUp() {
    const info = await window.electronAPI.getCleanupInfo(config.folder, cleanup);
    const cleanUpCountValue = info.count;
    const cleanUpSizeValue = info.size;

    if (cleanUpCountValue != 0) {
        cleanUpFiles.style.display = 'none';//Change to 'block' and uncomment fileCleanUp() to make work
        cleanUpCount.innerHTML = cleanUpCountValue;
        var cleanUpSizeValueGB = (cleanUpSizeValue / Math.pow(1024, 3)).toFixed(2);
        if (cleanUpSizeValueGB > 0.009)
            cleanUpSize.innerHTML = cleanUpSizeValueGB + " GB";
        else
            cleanUpSize.innerHTML = (cleanUpSizeValue / Math.pow(1024, 2)).toFixed(2) + " MB";
    } else {
        cleanUpFiles.style.display = 'none';
    }
}

rulesAgree.addEventListener('click', function (e) {
    e.preventDefault();
    window.electronAPI.openExternal(e.target.href);
});

sidebarLinks.addEventListener('click', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("sidebar-link"))
    window.electronAPI.openExternal(e.target.href);
});


browseBtn.addEventListener('click', function (event) {
    window.electronAPI.openDirectoryDialog('selected-directory');
});


folderBox.addEventListener('keyup', async event => {
    await loadConfig();
    await saveConfig({ "folder": event.target.value });
});


window.electronAPI.onDirectorySelected(async function (dirPath) {
    folderBox.value = dirPath;
    await loadConfig();
    await saveConfig({ "folder": dirPath });
    await fileCleanUp();
});

let installBtnBusy = false;
installBtn.addEventListener('click', function (event) {
    if (installBtnBusy) return;
    installBtnBusy = true;
    window.electronAPI.openDirectoryDialog('install-selected');
});

window.electronAPI.onInstallDirectorySelected(async function (dir) {
    // Always clear the busy guard first — main now replies (with null) even when the
    // dialog is cancelled, so the install button never gets stuck disabled.
    installBtnBusy = false;
    if (!dir) return;
    if (await window.electronAPI.checkSwgSource(dir)) {
        swgFolderBox.value = dir;
        swgInstallMessageSuccess.style.display = 'block';
        swgInstallMessageFail.style.display = 'none';
        setupNext.disabled = false;
    } else {
        swgFolderBox.value = dir;
        swgInstallMessageFail.style.display = 'block';
        swgInstallMessageSuccess.style.display = 'none';
    }
});