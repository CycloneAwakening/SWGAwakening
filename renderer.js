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

if (fs.existsSync(configFile))
    config = JSON.parse(fs.readFileSync(configFile));
gameDirBox.value = config.folder;
var needSave = false;

/*
 * ---------------------
 *    Config Loading & Saving
 * ---------------------
 */
 
 function saveConfig() {
    fs.writeFileSync(configFile, JSON.stringify(config));
}
 
// Helper to set config defaults
function setDefault(key, defaultValue) {
    if (config[key] === undefined || config[key] === null || (key === 'fps' && config[key] === 144)) {
        config[key] = defaultValue;
        needSave = true;
    }
}

// Set defaults
setDefault('soundsEnabled', true);
setDefault('fps', 60);
setDefault('ram', 2048);
setDefault('zoom', 1);
setDefault('login', 'live');

// Apply to UI
enableSounds.checked = config.soundsEnabled;
fpsSel.value = config.fps;
ramSel.value = config.ram;
zoomSel.value = config.zoom;
loginServerSel.value = config.login;
loginServerSel.setAttribute("data-previous", config.login);

// Save if needed
if (needSave) saveConfig();

// Update UI
versionDiv.innerHTML = package.version;
activeServer.innerHTML = server[config.login][0].address;
getServerStatus(config.login);

function cleanOldConfig() {
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
        saveConfig();
        console.log("[CONFIG CLEANER] Old config keys removed.");
    }
}
cleanOldConfig();

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
        audioElement.pause();
        audioElement.currentTime = 0;
        audioElement.play();
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

// Autoplay launchSound if sounds enabled
if (config.soundsEnabled) {
    try {
        launchSound.pause(); // Reset state
        launchSound.currentTime = 0;
        launchSound.play().catch(err => {
            console.warn(`[SOUND MANAGER] Autoplay failed, likely needs user gesture: ${err.message}`);
        });
    } catch (err) {
        console.error(`[SOUND MANAGER] Error playing launch sound: ${err.message}`);
    }
}

// Toggle sound setting
enableSounds.addEventListener('click', () => {
    config.soundsEnabled = enableSounds.checked;
    saveConfig();
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
        console.error(`[SERVER STATUS] Error fetching server status: ${err.message}`);
		serverStatus.style.color = '#CC1100';
		serverStatus.innerHTML = "Error";
		serverUptime.innerHTML = "--D:--H:--M:--S";
        donationText.innerHTML = `Error: Unable to retrieve data (MSG: ${err.message})`;
		donationBar.style.width = "0%";
		await getServerStatusRetry(serverLogin);
    } finally {
        getServerStatus.locked = false;
		console.log("[SERVER STATUS] Request complete (unlocked).");
    }
}

async function getServerStatusRetry(serverLogin) {
    let retryFailed = true;

    for (let i = 0; i < 5; i++) {
		const currentStatus = serverStatus.innerHTML.toLowerCase();
        if (currentStatus !== "unknown" && currentStatus !== "offline") {
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
            if (status !== "unknown" && serverStatus.innerHTML !== "offline" && !status.includes("error") && !status.includes("invalid")) {
                console.log(`[SERVER STATUS] Server produced a non-error or offline state during retry attempt ${i + 1}.`);
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

serverStatus.addEventListener('click', event => getServerStatus(config.login));

function serverStatLoop() {
    getServerStatus(config.login);
    setTimeout(serverStatLoop, 60000);
}
serverStatLoop();

/*
 * ---------------------
 *    Window Buttons
 * ---------------------
 */
minBtn.addEventListener('click', event => remote.getCurrentWindow().minimize());
closeBtn.addEventListener('click', event => remote.getCurrentWindow().close());

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
        install.install(args.swgdir, config.folder); //Mark area for file copying - cfg errors potential
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
    enableAll();
	cancelledState = true;
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
	if(navigator.onLine){
		progressText.innerHTML = Math.trunc(completed * 100 / total) + '% (' + parseFloat(rate.toPrecision(3)) + units + ')';
    progressBar.style.width = (completed * 100 / total) + '%';
	} else {
		progressText.innerHTML = "Network Error: File operation failed";
		progressBar.style.width = '0%';
		cancelledState = true;
	}
    if (completed == total && navigator.onLine) {
        enableAll();
        progressText.className = 'complete';
		cancelledState = false;
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

	if(cancelledState === true) {
		cancelledState = false
	}
	
}

if(!navigator.onLine) {
	progressText.innerHTML = "Network Error: File operation failed";
	progressBar.style.width = '0%';
	cancelledState = true;
}

async function handleReconnect() {
    console.log("[NETWORK] Reconnected to internet.");
    isDisconnected = false;

    // window.location.reload(); // Full reload if necessary
    getServerStatus(config.login); // Retry status fetch
    newsUpdatesView.reloadIgnoringCache(); // Reload news and updates feed

    if (
        cancelledState === true ||
        progressText.className === 'active' ||
        cancelBtn.disabled === false
    ) {
        install.cancel();

        // Pause for 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));

        disableAll(true);
        resetProgress();
        install.install(config.folder, config.folder, true);
    }
}


/*
 * ---------------------
 *    Launcher Debug
 * ---------------------
 */
versionDiv.addEventListener('click', event => remote.getCurrentWindow().toggleDevTools()); //Launcher debugging tool button on the launcher version section