const ipc = require('electron').ipcRenderer;
const shell = require('electron').shell;
const remote = require('@electron/remote');
const fs = require('fs');
const request = require('request');
const process = require('child_process');
const server = require('./json/server');
const cleanup = require('./json/cleanup');
const package = require('./package');
const install = require('./install');
const path = require('path');
const os = require('os');

const playBtn = document.getElementById('play');

const cancelBtn = document.getElementById('cancelBtn');

const progressBar = document.getElementById('progress');
const progressText = document.getElementById('progresstext');

const donationBar = document.getElementById('donation');
const donationText = document.getElementById('donationtext');

const helpBtn = document.getElementById('help');
const minBtn = document.getElementById('minimize');
const closeBtn = document.getElementById('close');

const swgOptionsBtn = document.getElementById('swgOptionsBtn');
const gameConfigBtn = document.getElementById('gameConfigBtn');
const gameConfigSection = document.getElementById('configSection');

const configPromptOverlay = document.getElementById("configPromptOverlay");
const configPromptClose = document.getElementById("configPromptClose");
const closeConfigPrompt = document.getElementsByClassName("closeConfigPrompt");
const gameDirBox = document.getElementById('gameDir');
const helpLinks = document.getElementById('helpLinks');
const setupComplete = document.getElementById('setupCompletePrompt');
const changeDirBtn = document.getElementById('changeDirBtn');
const verifyBtn = document.getElementById('verifyBtn');
const configSetupBtn = document.getElementById('configSetupBtn');

const loginServerSel = document.getElementById('loginServerSelect');
const loginServerConfirm = document.getElementById('loginServerConfirm');

const ramSel = document.getElementById('ram');
const fpsSel = document.getElementById('fps');
const zoomSel = document.getElementById('zoom');

// External Links
const headerLinks = document.getElementById("headerLinks");
const mainButtonLinks = document.getElementById('mainButtonLinks');
const newsUpdatesView = document.getElementById('newsUpdatesView');
const newsUpdatesRefresh = document.getElementById('newsUpdatesRefresh');

const skillPlanner = document.getElementById('skillPlanner');

const serverStatus = document.getElementById('serverStatus');
const serverUptime = document.getElementById('serverUptime');
const activeServer = document.getElementById('activeServer');
const versionDiv = document.getElementById('version');

const configFile = os.homedir() + '/Documents/My Games/SWG - Awakening/SWG-Awakening-Launcher-config.json';
var config = { folder: 'C:\\SWGAwakening' };

const launchSound = document.getElementById('launcherSound');
const buttonClickSound = document.getElementById('buttonClickSound');
const buttonHoverSound = document.getElementById('buttonHoverSound');
const openSound = "./sound/awakening.mp3";
const butClickSound = "./sound/int_select.wav";
const butHoverSound = "./sound/ui_rollover.wav";
const wrapper = document.getElementById('launcher-wrapper'); //Used to apply events to every tag in launcher-wrap div
const enableSounds = document.getElementById('enableSounds');

if (fs.existsSync(configFile))
    config = JSON.parse(fs.readFileSync(configFile));
gameDirBox.value = config.folder;
var needSave = false;

/*
 * Launcher Sound Functionality
 */
if (config.soundsrc != " " && config.soundsrc != openSound) {
    config.soundsrc = openSound;
    needSave = true;
}
launchSound.src = config.soundsrc;

if ((config.buttonclicksrc != " " && config.buttonclicksrc != butClickSound)) {
    config.buttonclicksrc = butClickSound;
    needSave = true;
}
buttonClickSound.src = config.buttonclicksrc;

if ((config.buttonhoversrc != " " && config.buttonhoversrc != butHoverSound)) {
    config.buttonhoversrc = butHoverSound;
    needSave = true;
}
buttonHoverSound.src = config.buttonhoversrc;

if (config.soundsrc == openSound) {
    enableSounds.checked = true;
} else {
    enableSounds.checked = false;
}

function buttonPlaySound(audioType) {
    audioType.cloneNode(true).play();
}

wrapper.addEventListener('click', (event) => {
    const isButton = event.target.nodeName === 'BUTTON';
    const isA = event.target.nodeName === 'A';
    if (!isButton && !isA) {
        return;
    }

    buttonPlaySound(buttonClickSound);
})

wrapper.addEventListener('mouseover', (event) => {
    const isButton = event.target.nodeName === 'BUTTON';
    const isA = event.target.nodeName === 'A';
    if (!isButton && !isA) {
        return;
    }

    buttonPlaySound(buttonHoverSound);
})

//End of launcher sound function (exception enable sounds button)


if (!config.fps) {
    config.fps = 60;
    needSave = true;
}
fpsSel.value = config.fps;
if (!config.ram) {
    config.ram = 2048;
    needSave = true;
}
ramSel.value = config.ram;
if (!config.zoom) {
    config.zoom = 1;
    needSave = true;
}
zoomSel.value = config.zoom;
if (!config.login) {
    config.login = "live";
    needSave = true;
}
loginServerSel.value = config.login;
loginServerSel.setAttribute("data-previous", config.login);
if (needSave) saveConfig();

versionDiv.innerHTML = package.version;
activeServer.innerHTML = server[config.login][0].address;
getServerStatus(config.login);

function getServerStatus(serverLogin) {
    request({ url: server[serverLogin][0].statusUrl, json: true, rejectUnauthorized: false }, function (err, response, body) {
        if (err) return console.error(err);
        if (body.status != undefined) {
            serverStatus.innerHTML = body.status;
            switch (serverStatus.innerHTML) {
                case "Online":
                    serverStatus.style.color = 'green';
                    break;
                case "Loading":
                    serverStatus.style.color = 'yellow';
                    break;
                case "Locked":
                    serverStatus.style.color = '#FF7722';
                    break;
                default: //Handles Offline or Unknown
                    serverStatus.style.color = '#CC1100';
            }
        }

        if (body.uptime != undefined) {
            serverUptime.innerHTML = body.uptime;
        }

        if (body.donation - goal != 0 || body.donation - goal != undefined) {
            var goal = body.donation_goal;
            var received = body.donations_received;
            donationText.innerHTML = 'Donation Statistics: $' + received + ' received of the $' + goal + ' goal (' + Math.trunc(received * 100 / goal) + '%).';
            if ((received * 100 / goal) <= 100) {
                donationBar.style.width = (received * 100 / goal) + '%';
            }
        }

        if (serverStatus.innerHTML == "Unknown" || serverStatus.innerHTML == "Offline") {
            getServerStatusRetry(serverLogin);
        }
    });
}

function getServerStatusRetry(serverLogin) {
    for (var i = 10; i > 0; i--) {
        if (serverStatus.innerHTML == "Unknown" || serverStatus.innerHTML == "Offline") {
            request({ url: server[serverLogin][0].statusUrl, json: true }, function (err, response, body) {
                if (err) return console.error(err);
                if (body.status != undefined) {
                    serverStatus.innerHTML = body.status;
                    switch (serverStatus.innerHTML) {
                        case "Online":
                            serverStatus.style.color = 'green';
                            break;
                        case "Loading":
                            serverStatus.style.color = 'yellow';
                            break;
                        case "Locked":
                            serverStatus.style.color = '#FF7722';
                            break;
                        default: //Handles Offline or Unknown
                            serverStatus.style.color = '#CC1100';
                    }
                }

                if (body.uptime != undefined) {
                    serverUptime.innerHTML = body.uptime;
                }

                if (body.donation_goal != 0 || body.donation_goal != undefined) {
                    var goal = body.donation_goal;
                    var received = body.donations_received;
                    donationText.innerHTML = 'Donation Statistics: $' + received + ' received of the $' + goal + ' goal (' + Math.trunc(received * 100 / goal) + '%).';
                    if ((received * 100 / goal) <= 100) {
                        donationBar.style.width = (received * 100 / goal) + '%';
                    }
                }
            });
        }
    }
}

minBtn.addEventListener('click', event => remote.getCurrentWindow().minimize());
closeBtn.addEventListener('click', event => remote.getCurrentWindow().close());

playBtn.addEventListener('click', event => {
    if (playBtn.disabled) return;
    if (playBtn.classList.contains("game-setup")) {
        ipc.send('setup-game');
    } else {
        var fd = fs.openSync(path.join(config.folder, "SWGEmu.exe"), "r");
        var buf = new Buffer(7);
        var bytes = fs.readSync(fd, buf, 0, 7, 0x1153);
        fs.closeSync(fd);
        fd = null;
        if (bytes == 7 && buf.readUInt8(0) == 0xc7 && buf.readUInt8(1) == 0x45 && buf.readUInt8(2) == 0x94 && buf.readFloatLE(3) != config.fps) {
            var file = require('random-access-file')(path.join(config.folder, "SWGEmu.exe"));
            buf = new Buffer(4);
            buf.writeFloatLE(config.fps);
            file.write(0x1156, buf, err => {
                if (err) alert("Could not modify FPS. Close all instances of the game to update FPS.\n" + ex.toString());
                file.close(play);
            })
        } else {
            play();
        }
    }
});

ipc.on('setup-begin-install', function (event, args) {
    playBtn.innerHTML = "Play";
    playBtn.className = "button";
    swgOptionsBtn.disabled = false;
    disableAll(false);
    helpBtn.disabled = false;
    // Welcome message
    configPromptClose.setAttribute("data-prompt-attr", "setupCompletePrompt");
    configPromptClose.setAttribute("data-prompt-value", "setupCompletePrompt");
    configOverlayPrompt("setupCompletePrompt");
    gameConfigSection.style.display = 'block';
    gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left active";
    resetProgress();
    if (fs.existsSync(configFile)) {
        config = JSON.parse(fs.readFileSync(configFile));
        gameDirBox.value = config.folder;
    }
    // Cleanup
    if (args.cleanup == true) {
        var cleanUpFile;
        for (let file of cleanup) {
            if (fs.existsSync(cleanUpFile = path.join(config.folder, file.name))) {
                fs.unlink(cleanUpFile, (err) => {
                    if (err) {
                        console.log("Could not Delete: " + file.name);
                        return;
                    }
                });
            }
        }
    }
    if (args.swgdir !== '') {
        console.log('Copying over files.');
        install.install(args.swgdir, config.folder);
    }
    else {
        install.install(config.folder, config.folder, true);
    }
});

function play() {
    fs.writeFileSync(path.join(config.folder, "login.cfg"), `[ClientGame]\r\nloginServerAddress0=${server[config.login][0].address}\r\nloginServerPort0=${server[config.login][0].port}\r\nfreeChaseCameraMaximumZoom=${config.zoom}`);
    var args = ["--",
        "-s", "ClientGame", "loginServerAddress0=" + server[config.login][0].address, "loginServerPort0=" + server[config.login][0].port,
        "-s", "Station", "gameFeatures=34929",
        "-s", "SwgClient", "allowMultipleInstances=true"];
    var env = Object.create(require('process').env);
    env.SWGCLIENT_MEMORY_SIZE_MB = config.ram;
    if (os.platform() === 'win32') {
        const child = process.spawn("SWGEmu.exe", args, { cwd: config.folder, env: env, detached: true, stdio: 'ignore' });
        child.unref();
    } else {
        const child = process.exec('wine SWGEmu.exe', { cwd: config.folder, env: env, detached: true, stdio: 'ignore' }, function (error, stdout, stderr) { });
        child.unref();
    }
}

/*
 * ---------------------
 *    Skill Planner Executable
 * ---------------------
 */
skillPlanner.addEventListener('click', event => {
    if (os.platform() === 'win32') {
        const child = process.spawn("cmd", ["/c", path.join(config.folder, "KSWGProfCalcEditor.exe")], { cwd: config.folder, detached: true, stdio: 'ignore' });
        child.unref();
    } else {
        const child = process.exec('wine KSWGProfCalcEditor.exe', { cwd: config.folder, detached: true, stdio: 'ignore' }, function (error, stdout, stderr) { });
        child.unref();
    }
});

swgOptionsBtn.addEventListener('click', event => {
    if (os.platform() === 'win32') {
        const child = process.spawn("cmd", ["/c", path.join(config.folder, "SWGEmu_Setup.exe")], { cwd: config.folder, detached: true, stdio: 'ignore' });
        child.unref();
    } else {
        const child = process.exec('wine SWGEmu_Setup.exe', { cwd: config.folder, detached: true, stdio: 'ignore' }, function (error, stdout, stderr) { });
        child.unref();
    }
});

gameConfigBtn.addEventListener('click', event => {
    if (gameConfigSection.style.display == 'none' || gameConfigBtn.className == "option-button swga-button swga-btn-icon swga-btn-icon-left") {
        configOverlayClose(true);
        gameConfigSection.style.display = 'block';
        gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left active";
    } else {
        gameConfigSection.style.display = 'none';
        gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left";
        configOverlayClose(true);
    }
});

headerLinks.addEventListener('click', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("header-link"))
        shell.openExternal(e.target.href);
});

headerLinks.addEventListener('auxclick', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("header-link"))
        shell.openExternal(e.target.href);
});

mainButtonLinks.addEventListener('click', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("button-link"))
        shell.openExternal(e.target.href);
});

mainButtonLinks.addEventListener('auxclick', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("button-link"))
        shell.openExternal(e.target.href);
});

newsUpdatesView.addEventListener('will-navigate', function (e) {
    const protocol = require('url').parse(e.url).protocol;
    if (protocol === 'http:' || protocol === 'https:')
        shell.openExternal(e.url);
    newsUpdatesView.stop();
});

newsUpdatesView.addEventListener('dom-ready', function (e) {
    newsUpdatesRefresh.className = 'news-updates-refresh hidden';
    newsUpdatesView.style.opacity = '1';
    setTimeout(function () {
        newsUpdatesRefresh.disabled = false;
        newsUpdatesRefresh.className = 'news-updates-refresh';
    }, 2000);
});

newsUpdatesRefresh.addEventListener('click', function (e) {
    newsUpdatesRefresh.disabled = true;
    newsUpdatesRefresh.className = 'news-updates-refresh spinner';
    newsUpdatesView.reloadIgnoringCache();
    newsUpdatesView.style.opacity = '0';
});

/*
 * ---------------------
 *    Launcher Config
 * ---------------------
 */

enableSounds.addEventListener('click', function (event) {
    if (enableSounds.checked) {
        config.soundsrc = openSound;
        config.buttonclicksrc = butClickSound;
        config.buttonhoversrc = butHoverSound;
        buttonClickSound.src = config.buttonclicksrc
        buttonHoverSound.src = config.buttonhoversrc
        saveConfig();
    } else {
        config.soundsrc = " ";
        config.buttonclicksrc = " ";
        config.buttonhoversrc = " ";
        saveConfig();
        launchSound.src = config.soundsrc;
        buttonClickSound.src = config.buttonclicksrc
        buttonHoverSound.src = config.buttonhoversrc
    }
});

/* 
 * -----------------
 *    Game Config
 * -----------------
 */

// SWG Config
fpsSel.addEventListener('change', event => {
    config.fps = event.target.value;
    saveConfig();
});
ramSel.addEventListener('change', event => {
    config.ram = event.target.value;
    saveConfig();
});
zoomSel.addEventListener('change', event => {
    config.zoom = event.target.value;
    saveConfig();
});

// "Change" directory button button pressed
changeDirBtn.addEventListener('click', function (event) {
    ipc.send('open-directory-dialog', 'selected-directory');
});

gameDirBox.addEventListener('keyup', event => {
    config.folder = event.target.value;
    saveConfig();
});

ipc.on('selected-directory', function (event, dir) {
    configPromptClose.setAttribute("data-prompt-attr", "gameDir");
    configPromptClose.setAttribute("data-prompt-value", gameDirBox.value);
    if (fs.existsSync(path.join(dir, 'qt-mt305.dll'))) {
        gameDirBox.value = dir;
        config.folder = dir;
        saveConfig();
        disableAll(true);
        resetProgress();
        install.install(config.folder, config.folder, true);
    } else {
        var gameDirPromptDir = document.getElementById('gameDirPromptDir');
        gameDirPromptBox.value = dir;
        configOverlayPrompt("gameDirPrompt");
        helpBtn.disabled = true;
    }
});

// Config "Run Setup" button pressed
configSetupBtn.addEventListener('click', function (event) {
    ipc.send('setup-game');
});

// Config "Login Server" select pressed
loginServerSel.addEventListener('change', event => {
    configPromptClose.setAttribute("data-prompt-attr", "loginServerSelect");
    configPromptClose.setAttribute("data-prompt-value", loginServerSel.getAttribute("data-previous"));
    configOverlayPrompt("loginServerPrompt");
    helpBtn.disabled = true;
});

loginServerConfirm.addEventListener('click', function (event) {
    config.login = loginServerSel.value;
    saveConfig();
    loginServerSel.setAttribute("data-previous", config.login);
    activeServer.className = "no-opacity";
    setTimeout(function () { activeServer.className = "fade-in"; }, 1000);
    activeServer.innerHTML = server[config.login][0].address;
    serverStatus.className = "no-opacity";
    setTimeout(function () { serverStatus.className = "fade-in"; }, 1000);
    serverUptime.className = "no-opacity";
    setTimeout(function () { serverUptime.className = "fade-in"; }, 1000);
    getServerStatus(config.login);
    disableAll(true);
    resetProgress();
    install.install(config.folder, config.folder, true);
    configOverlayClose(false);
});

// Help / Info button
helpBtn.addEventListener('click', function (event) {
    if (gameConfigSection.style.display == 'none') {
        gameConfigSection.style.display = 'block';
        gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left active";
        configOverlayPrompt("helpInfoPrompt");
    } else {
        if (document.getElementById("configPromptOverlay").style.display == "none") {
            configOverlayPrompt("helpInfoPrompt");
        } else {
            if (document.getElementById("helpInfoPrompt").className == "config-prompt active") {
                gameConfigSection.style.display = 'none';
                gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left";
                // Run exit task in case user opened help on top of already opened prompt
                configOverlayClose(true);
            }
            // Another prompt is open
        }
    }
});

helpLinks.addEventListener('click', function (e) {
    e.preventDefault();
    shell.openExternal(e.target.href);
});

setupComplete.addEventListener('click', function (e) {
    e.preventDefault();
    shell.openExternal(e.target.href);
});

function configOverlayPrompt(promptID) {
    var i, prompts;
    configPromptOverlay.style.display = "block";
    prompts = configPromptOverlay.getElementsByClassName("config-prompt");
    for (i = 0; i < prompts.length; i++)
        prompts[i].className = prompts[i].className.replace(" active", "");
    document.getElementById(promptID).classList.add("active");
    gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left";
}

// Close prompt button pressed
Object.entries(closeConfigPrompt).map((object) => {
    object[1].addEventListener("click", function () {
        configOverlayClose(true);
    });
});

function configOverlayClose(exit) {
    // Performs exit process for set values
    if (exit == true) {
        var promptAttr = configPromptClose.getAttribute("data-prompt-attr");
        var promptVal = configPromptClose.getAttribute("data-prompt-value");
        if (promptAttr != '' && promptVal != '')
            document.getElementById(promptAttr).value = promptVal;
    }
    gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left";
    configPromptClose.setAttribute("data-prompt-attr", "");
    configPromptClose.setAttribute("data-prompt-value", "");
    configPromptOverlay.style.display = "none";
    gameConfigSection.style.display = 'none';
    helpBtn.disabled = false;
}

// Progress bar cancel button
cancelBtn.addEventListener('click', function (event) {
    install.cancel();
    progressBar.style.width = '100%';
    progressText.className = 'complete';
    enableAll();
})

ipc.on('downloading-update', function (event, text) {
    versionDiv.innerHTML = text;
    disableAll(false);
});

ipc.on('download-progress', function (event, info) {
    install.progress(info.transferred, info.total);
})

var lastCompleted = 0;
var lastTime = new Date();
var rate = 0;
var units = " B/s";

function resetProgress() {
    lastCompleted = 0;
    lastTime = new Date();
    rate = 0;
}

install.progress = function (completed, total) {
    var time = new Date();
    var elapsed = (time - lastTime) / 1000;
    if (elapsed >= 1) {
        var bytes = completed - lastCompleted;
        units = " B/s";
        rate = bytes / elapsed;
        if (rate > 1024) {
            rate = rate / 1024;
            units = " KB/s";
        }
        if (rate > 1024) {
            rate = rate / 1024;
            units = " MB/s";
        }
        lastCompleted = completed;
        lastTime = time;
    }
    if (progressText.className == 'complete') progressText.className = 'active';
    progressText.innerHTML = Math.trunc(completed * 100 / total) + '% (' + parseFloat(rate.toPrecision(3)) + units + ')';
    progressBar.style.width = (completed * 100 / total) + '%';
    if (completed == total) {
        enableAll();
        progressText.className = 'complete';
    }
}

verifyBtn.addEventListener('click', function (event) {
    verifyFiles();
});

function verifyFiles() {
    if (verifyBtn.disabled) return;
    disableAll(true);
    resetProgress();
    install.install(config.folder, config.folder, true);
}

if (fs.existsSync(path.join(config.folder, 'qt-mt305.dll'))) {
    disableAll(true);
    resetProgress();
    install.install(config.folder, config.folder, true);
} else {
    console.log("First Run");
    progressText.innerHTML = "Click the SETUP button to get started."
    playBtn.innerHTML = "Setup";
    playBtn.disabled = false;
    playBtn.className = "button game-setup";
    verifyBtn.disabled = true;
    changeDirBtn.disabled = true;
    configSetupBtn.disabled = true;
    loginServerSel.disabled = true;
    loginServerConfirm.disabled = true;
    swgOptionsBtn.disabled = true;
    cancelBtn.disabled = true;
    skillPlanner.disabled = true;
}

function disableAll(cancel) {
    verifyBtn.disabled = true;
    playBtn.disabled = true;
    changeDirBtn.disabled = true;
    configSetupBtn.disabled = true;
    loginServerSel.disabled = true;
    loginServerConfirm.disabled = true;
    helpBtn.disabled = true;
    skillPlanner.disabled = true;
    if (cancel == true)
        cancelBtn.disabled = false;
}

function enableAll() {
    verifyBtn.disabled = false;
    playBtn.disabled = false;
    changeDirBtn.disabled = false;
    configSetupBtn.disabled = false;
    swgOptionsBtn.disabled = false;
    cancelBtn.disabled = true;
    loginServerSel.disabled = false;
    loginServerConfirm.disabled = false;
    helpBtn.disabled = false;
    skillPlanner.disabled = false;
}

function saveConfig() {
    fs.writeFileSync(configFile, JSON.stringify(config));
}

versionDiv.addEventListener('click', event => remote.getCurrentWindow().toggleDevTools()); //Launcher debugging tool button on the launcher version section
serverStatus.addEventListener('click', event => getServerStatus(config.login));
serverUptime.addEventListener('click', event => getServerStatus(config.login));

function serverStatLoop() {
    getServerStatus(config.login);
    setTimeout(serverStatLoop, 60000);
}
serverStatLoop();