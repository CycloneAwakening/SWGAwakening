const ipc = require('electron').ipcRenderer;
const shell = require('electron').shell;
const remote = require('@electron/remote');
const fs = require('fs');
const process = require('child_process');
const cleanup = require('../json/cleanup');
const install = require('../install');
const path = require('path');

const sidebarLinks = document.getElementById('sidebarLinks');
const rulesAgree = document.getElementById('ToSReadOnline');

const folderBox = document.getElementById('folder'); // SWG Awakening Folder Location
const browseBtn = document.getElementById('browse'); // Set Installation Location Button
const installBtn = document.getElementById('install'); // SWG Base Installation Button
const swgFolderBox = document.getElementById('swgFolder'); // SWG Awakening Folder Location

const cancelBtn = document.getElementById('cancel');

const minBtn = document.getElementById('minimize');
const closeBtn = document.getElementById('close');

const setupPrev = document.getElementById('setupPrev');
const setupNext = document.getElementById('setupNext');
const setupCancel = document.getElementById('setupCancel');

const agreeRules = document.getElementById('agreeRules');
const agreeOwner = document.getElementById('agreeOwner');

const swgDirSection = document.getElementById('swgDirSection');
const swgInstallMessageSuccess = document.getElementById('swgInstallMessageSuccess');
const swgInstallMessageFail = document.getElementById('swgInstallMessageFail');

const cleanUpFiles = document.getElementById('cleanUpFilesSection');
const agreeCleanUp = document.getElementById('agreeCleanUp');
const cleanUpCount = document.getElementById('cleanUpCount');
const cleanUpSize = document.getElementById('cleanUpSize');

const configFile = require('os').homedir() + '/Documents/My Games/SWG - Awakening/SWG-Awakening-Launcher-config.json';
var config = { folder: 'C:\\SWGAwakening' };
if (fs.existsSync(configFile))
    config = JSON.parse(fs.readFileSync(configFile));
folderBox.value = config.folder;

fileCleanUp();

minBtn.addEventListener('click', event => remote.getCurrentWindow().minimize());
closeBtn.addEventListener('click', event => remote.getCurrentWindow().close());

setupCancel.addEventListener('click', function (event) {
    remote.getCurrentWindow().close();
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
                setupPrev.style.display = 'block';
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
                setupPrev.style.display = 'none';
            }
            break;
        case "swgInstall":
            if (navButtonNext(button.id)) {
                console.log(agreeCleanUp.value);
                args = { "swgdir": swgFolder.value, "cleanup": agreeCleanUp.checked };
                ipc.send('setup-complete', args);
                remote.getCurrentWindow().close();
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
            remote.getCurrentWindow().close();
    }
}

function navButtonNext(button) {
    if (button == "setupNext")
        return true;
    else
        return false;
}

function fileCleanUp() {
    var cleanUpCountValue = 0;
    var cleanUpSizeValue = 0;

    for (let file of cleanup) {
        if (fs.existsSync(path.join(config.folder, file.name))) {
            cleanUpCountValue += 1;
            cleanUpSizeValue += file.size;
            console.log("Found: " + file.name);
        }
    }

    if (cleanUpCountValue != 0) {
        cleanUpFilesSection.style.display = 'none';//Change to 'block' and uncomment fileCleanUp() to make work
        cleanUpCount.innerHTML = cleanUpCountValue;
        var cleanUpSizeValueGB = (cleanUpSizeValue / Math.pow(1024, 3)).toFixed(2);
        if (cleanUpSizeValueGB > 0.009)
            cleanUpSize.innerHTML = cleanUpSizeValueGB + " GB";
        else
            cleanUpSize.innerHTML = (cleanUpSizeValue / Math.pow(1024, 2)).toFixed(2) + " MB";
    } else {
        cleanUpFilesSection.style.display = 'none';
    }
}

rulesAgree.addEventListener('click', function (e) {
    e.preventDefault();
    shell.openExternal(e.target.href);
});

sidebarLinks.addEventListener('click', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("sidebar-link"))
        shell.openExternal(e.target.href);
});


browseBtn.addEventListener('click', function (event) {
    ipc.send('open-directory-dialog', 'selected-directory');
});

folderBox.addEventListener('keyup', event => {
    config.folder = event.target.value;
    saveConfig();
});

ipc.on('selected-directory', function (event, path) {
    folderBox.value = path;
    config.folder = path;
    saveConfig();
    fileCleanUp();
});

installBtn.addEventListener('click', function (event) {
    if (installBtn.disabled = false) return;
    installBtn.disabled = true;
    ipc.send('open-directory-dialog', 'install-selected');
});

ipc.on('install-selected', function (event, dir) {
    if (fs.existsSync(path.join(dir, 'bottom.tre')) && fs.existsSync(path.join(dir, 'data_animation_00.tre')) && fs.existsSync(path.join(dir, 'data_texture_04.tre'))) {
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

function saveConfig() {
    fs.writeFileSync(configFile, JSON.stringify(config));
}