const ipc = require('electron').ipcRenderer;
const shell = require('electron').shell;
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

// Disable game config, play, verify, and swg options buttons until configReady
playBtn.disabled = true;
verifyBtn.disabled = true;
gameConfigBtn.disabled = true;
swgOptionsBtn.disabled = true;

// Use Electron's userData directory for the launcher data store

let config = { folder: 'C:\\SWGAwakening' };
// Always fetch config from main process
async function loadConfig() {
    config = await ipc.invoke('get-launcher-config');
}

// Save config via main process
async function saveConfig() {
    await ipc.invoke('set-launcher-config', config);
}

// On startup, load config and initialize UI
let configReady = (async () => {
    await loadConfig();
    gameDirBox.value = config.folder;
    enableSounds.checked = config.soundsEnabled;
    fpsSel.value = config.fps;
    ramSel.value = config.ram;
    zoomSel.value = config.zoom;
    loginServerSel.value = config.login;
    loginServerSel.setAttribute("data-previous", config.login);
    versionDiv.innerHTML = package.version;
    activeServer.innerHTML = server[config.login][0].address;
    await getServerStatus(config.login);
})();

// Constants for sound paths
const OPEN_SOUND = "./sound/awakening.mp3";
const BUTTON_CLICK_SOUND = "./sound/int_select.wav";
const BUTTON_HOVER_SOUND = "./sound/ui_rollover.wav";

// Elements for sounds
const launchSound = document.getElementById('launcherSound');
const buttonClickSound = document.getElementById('buttonClickSound');
const buttonHoverSound = document.getElementById('buttonHoverSound');
const wrapper = document.getElementById('launcher-wrapper'); //Used to apply events to every tag in launcher-wrap div
const enableSounds = document.getElementById('enableSounds');

function getOptionsFile() { return path.join(config.folder, 'options.cfg'); }
function getLoginFile() { return path.join(config.folder, 'login.cfg'); }
/*
 * ---------------------
 *    Config Loading & Saving
 * ---------------------
 */
// Helper to set config defaults, always reloads config from disk first

async function setDefault(key, defaultValue) {
    await loadConfig();
    if (config[key] === undefined || config[key] === null) {
        console.error(`[CONFIG] Config key "${key}" not found, setting default value: ${defaultValue}`);
        config[key] = defaultValue;
        await saveConfig();
    }
}


// Set defaults (ensure config is loaded first)
(async () => {
    await configReady;
    await setDefault('soundsEnabled', true);
    await setDefault('fps', 60);
    await setDefault('ram', 2048);
    await setDefault('zoom', 1);
    await setDefault('login', 'live');

    //Apply to cfg files
    await ipc.invoke('modify-cfg', getLoginFile(), {
        "ClientGame": {
            "loginServerAddress0": server[config.login][0].address,
            "loginServerPort0": server[config.login][0].port,
            "freeChaseCameraMaximumZoom": config.zoom
        }
    }, false);
    await ipc.invoke('modify-cfg', getOptionsFile(), {
        "Direct3d9": {
            "fullscreenRefreshRate": config.fps
        }
    }, false);
})();

async function cleanOldConfig() {
    await loadConfig();
    const removedKeys = [
        'soundsrc',
        'buttonclicksrc',
        'buttonhoversrc'
    ];
    let modified = false;
    removedKeys.forEach(key => {
        if (key in config) {
            delete config[key];
            modified = true;
        }
    });
    if (modified) {
        await saveConfig();
        console.log("[CONFIG CLEANER] Old config keys removed.");
    }
}
(async () => { await configReady; await cleanOldConfig(); })();

/*
 * ---------------------
 *    Launcher Sound Functionality
 * ---------------------
 */

// Load audio sources directly from constants
function setupSoundSources() {
    launchSound.src = OPEN_SOUND;
    buttonClickSound.src = BUTTON_CLICK_SOUND;
    buttonHoverSound.src = BUTTON_HOVER_SOUND;
}

// Safely play a sound if sounds are enabled
function playSound(audioElement) {
    if (!config.soundsEnabled) return;

    try {
        // Only pause if not already paused
        if (!audioElement.paused) {
            audioElement.pause();
        }
        audioElement.currentTime = 0;
        // Use .play() and catch DOMException
        audioElement.play().catch(err => {
            if (err.name !== 'AbortError') {
                console.warn(`[SOUND MANAGER] Sound play failed: ${err.message}`);
            }
        });
    } catch (err) {
        console.warn(`[SOUND MANAGER] Sound play failed: ${err.message}`);
    }
}

// Event delegation for button click and hover
function setupSoundListeners() {
    wrapper.addEventListener('click', (event) => {
        if (isInteractiveElement(event.target)) {
            playSound(buttonClickSound);
        }
    });

    wrapper.addEventListener('mouseover', (event) => {
        if (isInteractiveElement(event.target)) {
            playSound(buttonHoverSound);
        }
    });
}

// Helper: is the element a button or a link
function isInteractiveElement(element) {
    const tag = element.tagName.toUpperCase();
    return tag === 'BUTTON' || tag === 'A';
}

// Initialize system
setupSoundSources();
setupSoundListeners();

// Autoplay launchSound if sounds enabled, after config is loaded
(async () => {
    await configReady;
    if (config.soundsEnabled) {
        try {
            launchSound.currentTime = 0;
            launchSound.play().catch(err => {
                console.warn(`[SOUND MANAGER] Autoplay failed, likely needs user gesture: ${err.message}`);
            });
        } catch (err) {
            console.error(`[SOUND MANAGER] Error playing launch sound: ${err.message}`);
        }
    }
})();

// Toggle sound setting
enableSounds.addEventListener('click', () => {
    config.soundsEnabled = enableSounds.checked;
    (async () => {
        ipc.invoke('set-launcher-config', config);
    })();
});

/*
 * ---------------------
 *    Server Status Functionality
 * ---------------------
 */
async function getServerStatus(serverLogin) {
    // Persistent state
    if (getServerStatus.locked) {
        console.log("[SERVER STATUS] Tried to start server status check, blocked due to lock.");
        return;
    }
    if (!server[serverLogin] || !server[serverLogin][0] || !server[serverLogin][0].statusUrl) {
        console.error(`[SERVER STATUS] Invalid serverLogin: ${serverLogin}`);
        serverStatus.style.color = '#CC1100';
        serverStatus.innerHTML = "Error";
        serverUptime.innerHTML = "--D:--H:--M:--S";
        donationText.innerHTML = `Error: Invalid server configuration`;
        donationBar.style.width = "0%";
        return;
    }
    getServerStatus.locked = true;
    console.log("[SERVER STATUS] Starting get server status attempt (lock).");

    try {
        const body = await fetchWithTimeout(server[serverLogin][0].statusUrl, 5000);
        if (!validateBody(body)) {
            console.warn("[SERVER STATUS] Invalid body format. Retrying...");
            updateServerDisplay(body);
            await getServerStatusRetry(serverLogin);
            return;
        }

        updateServerDisplay(body);

        const status = serverStatus.innerHTML.toLowerCase();
        if (status === "unknown" || status === "offline") {
            await getServerStatusRetry(serverLogin);
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            // Timeout occurred, handle gracefully
            console.warn('[SERVER STATUS] Server status request timed out.');
            serverStatus.style.color = '#CC1100';
            serverStatus.innerHTML = "Timeout";
            serverUptime.innerHTML = "--D:--H:--M:--S";
            donationText.innerHTML = `Error: Unable to retrieve data (Request Timed Out.)`;
            donationBar.style.width = "0%";
        } else {
            console.error(`[SERVER STATUS] Error fetching server status: ${err.message}`);
            serverStatus.style.color = '#CC1100';
            serverStatus.innerHTML = "Error";
            serverUptime.innerHTML = "--D:--H:--M:--S";
            donationText.innerHTML = `Error: Unable to retrieve data (Network Unreachable?)`;
            donationBar.style.width = "0%";
        }
        await getServerStatusRetry(serverLogin);
    } finally {
        getServerStatus.locked = false;
        console.log("[SERVER STATUS] Request complete (unlocked).");
    }
}

async function getServerStatusRetry(serverLogin, maxRetries = 5) {
    if (!server[serverLogin] || !server[serverLogin][0] || !server[serverLogin][0].statusUrl) {
        console.error(`[SERVER STATUS] Invalid serverLogin for retry: ${serverLogin}`);
        serverStatus.style.color = '#CC1100';
        serverStatus.innerHTML = "Error";
        serverUptime.innerHTML = "--D:--H:--M:--S";
        donationText.innerHTML = `Error: Invalid server configuration`;
        donationBar.style.width = "0%";
        return;
    }
    let retryFailed = true;

    for (let i = 0; i < maxRetries; i++) {
        const currentStatus = serverStatus.innerHTML.toLowerCase();
        // Retry if status is unknown, offline, timeout, or error
        if (
            currentStatus !== "unknown" &&
            currentStatus !== "offline" &&
            currentStatus !== "timeout" &&
            !currentStatus.includes("error")
        ) {
            retryFailed = false;
            break;
        }

        try {
            console.log(`[SERVER STATUS] Retry attempt ${i + 1}...`);

            const body = await fetchWithTimeout(server[serverLogin][0].statusUrl, 5000);
            if (!validateBody(body)) {
                console.warn(`[SERVER STATUS] Invalid server response during retry attempt ${i + 1}.`);
                continue;
            }

            updateServerDisplay(body);

            const status = serverStatus.innerHTML.toLowerCase();
            if (
                status !== "unknown" &&
                status !== "offline" &&
                status !== "timeout" &&
                !status.includes("error") &&
                !status.includes("invalid")
            ) {
                console.log(`[SERVER STATUS] Server produced a non-error, non-offline, non-timeout, non-error state during retry attempt ${i + 1}.`);
                retryFailed = false;
                break;
            }
        } catch (err) {
            console.warn(`[SERVER STATUS] Retry ${i + 1} failed: ${err.message}`);

        }

        await new Promise(res => setTimeout(res, 2000 * Math.pow(1.5, i)));
    }

    if (retryFailed) {
        console.log("[SERVER STATUS] All retry attempts failed. Displaying failure message.");
    }
}

function updateServerDisplay(body) {
    // Persistent state
    if (!updateServerDisplay.lastBody) {
        updateServerDisplay.lastBody = {};
    }

    const last = updateServerDisplay.lastBody;
    let updated = false;

    if (body.status !== last.status || serverStatus.innerHTML.toLowerCase().includes("error")) {
        serverStatus.innerHTML = body.status;
        switch (body.status) {
            case "Online":
                serverStatus.style.color = 'green';
                break;
            case "Loading":
                serverStatus.style.color = 'yellow';
                break;
            case "Locked":
                serverStatus.style.color = '#FF7722';
                break;
            default:
                serverStatus.style.color = '#CC1100'; // Offline, Unknown or Invalid
        }
        last.status = body.status;
        updated = true;
    }

    if (body.uptime !== last.uptime) {
        serverUptime.innerHTML = body.uptime;
        last.uptime = body.uptime;
        updated = true;
    }

    // Handle donation section
    const goal = body.donation_goal;
    const received = body.donations_received;

    if (goal === undefined || received === undefined) {
        donationText.innerHTML = "Error: Invalid data received from server";
        donationBar.style.width = "0%";
    } else if (
        goal !== last.donation_goal ||
        received !== last.donations_received ||
        donationText.innerHTML.toLowerCase().includes("error")
    ) {
        const percentage = Math.trunc(received * 100 / goal);
        donationText.innerHTML = `Donation Statistics: $${received} received of the $${goal} goal (${percentage}%).`;

        donationBar.style.width = `${Math.min(percentage, 100)}%`;

        last.donation_goal = goal;
        last.donations_received = received;
        updated = true;
    }

    if (updated) {
        console.log(`[SERVER STATUS] UI updated.`);
    }
}

function validateBody(body) {
    if (!body || typeof body !== 'object') {
        return false;
    }

    const isValid =
        typeof body.status === 'string' &&
        typeof body.uptime === 'string' &&
        typeof body.donation_goal === 'number' &&
        typeof body.donations_received === 'number';

    if (!isValid) {
        body.status = "Invalid";
        body.uptime = "--D:--H:--M:--S";
        body.donation_goal = undefined;
        body.donations_received = undefined;
    }

    return isValid;
}

async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

serverStatus.addEventListener('click', async event => {
    await configReady;
    await getServerStatus(config.login);
});

async function serverStatLoop() {
    await configReady;
    await getServerStatus(config.login);
    setTimeout(serverStatLoop, 60000);
}
(async () => { await configReady; serverStatLoop(); })();

/*
 * ---------------------
 *    Window Buttons
 * ---------------------
 */
minBtn.addEventListener('click', event => ipc.send('window-minimize'));
closeBtn.addEventListener('click', event => ipc.send('window-close'));

/*
 * ---------------------
 *    Play Button Logic
 * ---------------------
 */
playBtn.addEventListener('click', event => {
    if (playBtn.disabled) return;
    if (playBtn.classList.contains("game-setup")) {
        ipc.send('setup-game');
    } else {
        var fd = fs.openSync(path.join(config.folder, "SWGEmu.exe"), "r");
        var buf = Buffer.alloc(7);
        var bytes = fs.readSync(fd, buf, 0, 7, 0x1153);
        fs.closeSync(fd);
        fd = null;
        if (bytes == 7 && buf.readUInt8(0) == 0xc7 && buf.readUInt8(1) == 0x45 && buf.readUInt8(2) == 0x94 && buf.readFloatLE(3) != config.fps) {
            var randomAccessFile = require('random-access-file');
            var file = new randomAccessFile(path.join(config.folder, "SWGEmu.exe"));
            buf = Buffer.alloc(4);
            buf.writeFloatLE(config.fps);
            file.write(0x1156, buf, err => {
                if (err) alert(`Could not apply new FPS value (${config.fps} FPS). Close all instances of the game to update FPS. The requested SWG client instance will launch with old FPS value applied.`);
                file.close(play);
            })
        } else {
            play();
        }
    }
});

ipc.on('setup-begin-install', async function (event, args) {
    playBtn.innerHTML = "Play";
    playBtn.className = "button";
    swgOptionsBtn.disabled = false;
    toggleAll(false);
    helpBtn.disabled = false;
    // Welcome message
    configPromptClose.setAttribute("data-prompt-attr", "setupCompletePrompt");
    configPromptClose.setAttribute("data-prompt-value", "setupCompletePrompt");
    configOverlayPrompt("setupCompletePrompt");
    gameConfigSection.style.display = 'block';
    gameConfigBtn.className = "option-button swga-button swga-btn-icon swga-btn-icon-left active";
    resetProgress();
    // Always reload config from main process
    await loadConfig();
    gameDirBox.value = config.folder;
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
    //Keeping here just in case the new system proves unreliable - needs more testing as I had some mixed results while implementing it, want to make sure its bullet proof
    //fs.writeFileSync(path.join(config.folder, "login.cfg"), `[ClientGame]\r\nloginServerAddress0=${server[config.login][0].address}\r\nloginServerPort0=${server[config.login][0].port}\r\nfreeChaseCameraMaximumZoom=${config.zoom}`);
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

/*
 * ---------------------
 *    SWG Setup Executable
 * ---------------------
 */
swgOptionsBtn.addEventListener('click', event => {
    if (os.platform() === 'win32') {
        const child = process.spawn("cmd", ["/c", path.join(config.folder, "SWGEmu_Setup.exe")], { cwd: config.folder, detached: true, stdio: 'ignore' });
        child.unref();
    } else {
        const child = process.exec('wine SWGEmu_Setup.exe', { cwd: config.folder, detached: true, stdio: 'ignore' }, function (error, stdout, stderr) { });
        child.unref();
    }
});

/*
 * ---------------------
 *    Game Config Button
 * ---------------------
 */
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

/*
 * ---------------------
 *    Misc Link Buttons
 * ---------------------
 */
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

/*
 * ---------------------
 *    News & Updates View Window
 * ---------------------
 */
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
 * -----------------
 *    Game Config
 * -----------------
 */
fpsSel.addEventListener('change', event => {
    if (event.target.value > 60)
        (async () => {
            ipc.invoke('modify-cfg', getOptionsFile(), {
                "Direct3d9": {
                    "allowTearing": 1
                }
            }, false);
        })();

    (async () => {
    ipc.invoke('modify-cfg', getOptionsFile(), {
            "Direct3d9": {
                "fullscreenRefreshRate": event.target.value
            }
        }, false);
    })();


    config.fps = event.target.value;
    (async () => {
        ipc.invoke('set-launcher-config', config);
    })();
    alert(`The first time you launch the SWG client after changing your FPS value, it will take an extended time to open the client window due to needing to edit the executable directly. Please be patient.`);
});
ramSel.addEventListener('change', event => {
    config.ram = event.target.value;
    (async () => {
        ipc.invoke('set-launcher-config', config);
    })();
});
zoomSel.addEventListener('change', event => {
    (async () => {
    ipc.invoke('modify-cfg', getLoginFile(), {
            "ClientGame": {
                "freeChaseCameraMaximumZoom": event.target.value
            }
        }, false);
    })();

    config.zoom = event.target.value;
    (async () => {
        ipc.invoke('set-launcher-config', config);
    })();
});

// "Change" directory button button pressed
changeDirBtn.addEventListener('click', function (event) {
    ipc.send('open-directory-dialog', 'selected-directory');
});

gameDirBox.addEventListener('keyup', event => {
    config.folder = event.target.value;
    (async () => {
        ipc.invoke('set-launcher-config', config);
    })();
});

ipc.on('selected-directory', function (event, dir) {
    configPromptClose.setAttribute("data-prompt-attr", "gameDir");
    configPromptClose.setAttribute("data-prompt-value", gameDirBox.value);
    if (fs.existsSync(path.join(dir, 'qt-mt305.dll'))) {
        gameDirBox.value = dir;
        config.folder = dir;
        (async () => {
            ipc.invoke('set-launcher-config', config);
        })();
        toggleAll(false, true);
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
    (async () => {
        ipc.invoke('set-launcher-config', config);
    })();

    (async () => {
    ipc.invoke('modify-cfg', getLoginFile(), {
            "ClientGame": {
                "loginServerAddress0": server[config.login][0].address,
                "loginServerPort0": server[config.login][0].port,
            }
        }, false);
    })();

    loginServerSel.setAttribute("data-previous", config.login);
    activeServer.className = "no-opacity";
    setTimeout(function () { activeServer.className = "fade-in"; }, 1000);
    activeServer.innerHTML = server[config.login][0].address;
    serverStatus.className = "no-opacity";
    setTimeout(function () { serverStatus.className = "fade-in"; }, 1000);
    serverUptime.className = "no-opacity";
    setTimeout(function () { serverUptime.className = "fade-in"; }, 1000);
    getServerStatus(config.login);
    toggleAll(false, true);
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

/*
 * ---------------------
 *    Progress Bar Logic
 * ---------------------
 */
let cancelledState = false;
// Progress bar cancel button
cancelBtn.addEventListener('click', function (event) {
    install.cancel();
    progressBar.style.width = '100%';
    progressText.className = 'complete';
    toggleAll(true);
    cancelledState = true;
})

ipc.on('downloading-update', function (event, text) {
    versionDiv.innerHTML = text;
    toggleAll(false);
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
    if (navigator.onLine) {
        progressText.innerHTML = Math.trunc(completed * 100 / total) + '% (' + parseFloat(rate.toPrecision(3)) + units + ')';
        progressBar.style.width = (completed * 100 / total) + '%';
    } else {
        progressText.innerHTML = "Network Error: File operation failed";
        progressBar.style.width = '0%';
        cancelledState = true;
    }
    if (completed == total && navigator.onLine) {
        toggleAll(true)
        progressText.className = 'complete';
        cancelledState = false;
    }
}


verifyBtn.addEventListener('click', function (event) {
    verifyFiles();
});

function verifyFiles() {
    if (verifyBtn.disabled) return;
    toggleAll(false, true);
    resetProgress();
    install.install(config.folder, config.folder, true);
}

// Ensure this block only runs after config is loaded
(async () => {
    await configReady;
    // Enable play, game config, and swg options buttons after config is ready
    gameConfigBtn.disabled = false;
    swgOptionsBtn.disabled = false;
    if (fs.existsSync(path.join(config.folder, 'qt-mt305.dll'))) {
        toggleAll(false, true);
        resetProgress();
        install.install(config.folder, config.folder, true);
    } else {
        console.log("First Run");
        progressText.innerHTML = "Click the SETUP button to get started.";
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
        ramSel.disabled = true;
        fpsSel.disabled = true;
        zoomSel.disabled = true;
    }
})();

function toggleAll(enable, cancel = false) {
    verifyBtn.disabled = !enable;
    playBtn.disabled = !enable;
    changeDirBtn.disabled = !enable;
    configSetupBtn.disabled = !enable;
    loginServerSel.disabled = !enable;
    loginServerConfirm.disabled = !enable;
    helpBtn.disabled = !enable;
    ramSel.disabled = !enable;
    fpsSel.disabled = !enable;
    zoomSel.disabled = !enable;
    skillPlanner.disabled = !enable;


    if (!enable && cancel) cancelBtn.disabled = true;

    //Only enable
    // cancelBtn logic
    if (enable) {
        cancelBtn.disabled = true;
    } else {
        cancelBtn.disabled = !cancel;
    }
}

/*
 * ---------------------
 *    Network State Handling
 * ---------------------
 */
window.addEventListener('online', handleReconnect);
window.addEventListener('offline', handleDisconnect);

let isDisconnected = false;

function handleDisconnect() {
    console.warn("[NETWORK] Disconnected from internet.");
    isDisconnected = true;

    if (cancelledState === true) {
        cancelledState = false
    }

}

if (!navigator.onLine) {
    progressText.innerHTML = "Network Error: File operation failed";
    progressBar.style.width = '0%';
    cancelledState = true;
}

async function handleReconnect() {
    console.log("[NETWORK] Reconnected to internet.");
    isDisconnected = false;

    // window.location.reload(); // Full reload if necessary
    await configReady;
    await getServerStatus(config.login); // Retry status fetch
    newsUpdatesView.reloadIgnoringCache(); // Reload news and updates feed

    if (
        cancelledState === true ||
        progressText.className === 'active' ||
        cancelBtn.disabled === false
    ) {
        install.cancel();

        // Pause for 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));

        toggleAll(false, true);
        resetProgress();
        install.install(config.folder, config.folder, true);
    }
}


/*
 * ---------------------
 *    Launcher Debug
 * ---------------------
 */
versionDiv.addEventListener('click', event => ipc.send('window-toggle-devtools'));