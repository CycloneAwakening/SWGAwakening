// All Node.js / Electron APIs are accessed through the contextBridge (preload.js)
const { serverConfig: server, cleanupConfig: cleanup, appVersion, pathJoin } = window.electronAPI;

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
const zoomValue = document.getElementById('zoomValue');
const zoomPopoverToggle = document.getElementById('zoomPopoverToggle');
const zoomPopover = document.getElementById('zoomPopover');
const zoomPopoverClose = document.getElementById('zoomPopoverClose');
const fpsNoticePanel = document.getElementById('fpsNoticePanel');
const fpsNoticeClose = document.getElementById('fpsNoticeClose');

const DEFAULT_CONFIG = {
    folder: 'C:\\SWGAwakening',
    soundsEnabled: true,
    fps: 60,
    ram: 2048,
    zoom: 1,
    login: 'live',
};

const ALLOWED_FPS = new Set([30, 60, 120, 144]);
const ALLOWED_RAM = new Set([750, 1024, 1536, 2048]);

function normalizeLauncherConfig(rawConfig) {
    const normalized = {};

    const folder = typeof rawConfig.folder === 'string' ? rawConfig.folder.trim() : '';
    normalized.folder = folder.length > 0 ? folder : DEFAULT_CONFIG.folder;

    normalized.soundsEnabled = typeof rawConfig.soundsEnabled === 'boolean'
        ? rawConfig.soundsEnabled
        : DEFAULT_CONFIG.soundsEnabled;

    const fps = Number.parseInt(rawConfig.fps, 10);
    normalized.fps = ALLOWED_FPS.has(fps) ? fps : DEFAULT_CONFIG.fps;

    const ram = Number.parseInt(rawConfig.ram, 10);
    normalized.ram = ALLOWED_RAM.has(ram) ? ram : DEFAULT_CONFIG.ram;

    const zoom = Number.parseInt(rawConfig.zoom, 10);
    if (Number.isFinite(zoom)) {
        normalized.zoom = Math.min(10, Math.max(1, zoom));
    } else {
        normalized.zoom = DEFAULT_CONFIG.zoom;
    }

    normalized.login = rawConfig.login === 'test' ? 'test' : DEFAULT_CONFIG.login;

    return normalized;
}

function diffConfigPatch(currentConfig, normalizedConfig) {
    const patch = {};
    for (const key of Object.keys(normalizedConfig)) {
        if (currentConfig[key] !== normalizedConfig[key]) {
            patch[key] = normalizedConfig[key];
        }
    }
    return patch;
}

function updateZoomDisplay(value) {
    if (!zoomValue) return;
    const normalized = normalizeZoom(value);
    const sliderPercent = Math.round(((normalized - 1) / 9) * 100);
    const zoomBand = getZoomBand(normalized);
    zoomValue.textContent = `Zoom: ${normalized} (${zoomBand})`;
    if (zoomPopoverToggle) {
        const optionLabel = `${normalized} (${zoomBand})`;
        if (zoomPopoverToggle.tagName === 'SELECT') {
            if (zoomPopoverToggle.options.length === 0) {
                const option = document.createElement('option');
                zoomPopoverToggle.appendChild(option);
            }
            zoomPopoverToggle.options[0].text = optionLabel;
            zoomPopoverToggle.options[0].value = String(normalized);
            zoomPopoverToggle.selectedIndex = 0;
        } else {
            zoomPopoverToggle.textContent = optionLabel;
        }
    }
    if (zoomSel) {
        zoomSel.style.setProperty('--zoom-progress', `${sliderPercent}%`);
    }
}

function normalizeZoom(value) {
    return Math.min(10, Math.max(1, Number.parseInt(value, 10) || 1));
}

function getZoomBand(value) {
    const normalized = normalizeZoom(value);
    if (normalized === 1) return 'DEFAULT';
    if (normalized <= 3) return 'NEAR';
    if (normalized <= 7) return 'MID';
    return 'FAR';
}

// External Links
const headerLinks = document.getElementById("headerLinks");
const mainButtonLinks = document.getElementById('mainButtonLinks');
const newsUpdatesView = document.getElementById('newsUpdatesView');
const newsUpdatesRefresh = document.getElementById('newsUpdatesRefresh');
const newsUpdatesWrapper = document.querySelector('.news-updates-wrapper');

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

let fpsNoticeHideTimer = null;

function showFpsNotice() {
    if (!fpsNoticePanel) return;
    fpsNoticePanel.style.display = 'block';
    if (fpsNoticeHideTimer) clearTimeout(fpsNoticeHideTimer);
    fpsNoticeHideTimer = setTimeout(() => {
        fpsNoticePanel.style.display = 'none';
        fpsNoticeHideTimer = null;
    }, 6000);
}

function hideFpsNotice() {
    if (!fpsNoticePanel) return;
    fpsNoticePanel.style.display = 'none';
    if (fpsNoticeHideTimer) {
        clearTimeout(fpsNoticeHideTimer);
        fpsNoticeHideTimer = null;
    }
}

if (fpsNoticeClose) {
    fpsNoticeClose.addEventListener('click', hideFpsNotice);
}

// Runs fn only after the renderer has painted and the launcher UI has settled.
// A synchronous window.alert() during startup freezes the main renderer before
// it paints, so the window appears blank (only the separate news WebContentsView
// renders). Waiting past two animation frames guarantees a first paint, and the
// extra delay lets the full launcher UI (background, config, news view) finish
// rendering before any blocking dialog is shown.
const STARTUP_DIALOG_DELAY_MS = 2000;
function scheduleAfterPaint(fn) {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(fn, STARTUP_DIALOG_DELAY_MS)));
}

// Use Electron's userData directory for the launcher data store

let config = { folder: 'C:\\SWGAwakening' };
// Always fetch config from main process
async function loadConfig() {
    config = await window.electronAPI.getConfig();
}

// Save config patch via main process
async function saveConfig(patch) {
    await window.electronAPI.setConfig(patch);
    // Update local config object
    if (patch && typeof patch === 'object') {
        for (const key in patch) {
            config[key] = patch[key];
        }
    }
}

// Delete config keys via main process
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
let configReady = (async () => {
  try {
    console.log('[RENDERER] configReady start');
    await loadConfig();

    // Normalize invalid or missing values and persist corrections.
    const normalizedConfig = normalizeLauncherConfig(config || {});
    const patch = diffConfigPatch(config || {}, normalizedConfig);
    config = normalizedConfig;
    if (Object.keys(patch).length > 0) {
        console.warn('[LAUNCHER CONFIG] Corrected invalid startup config values:', patch);
        await saveConfig(patch);
    }

    const loginKey = config.login;

    gameDirBox.value = config.folder;
    enableSounds.checked = config.soundsEnabled;
    fpsSel.value = config.fps;
    ramSel.value = config.ram;
    zoomSel.value = config.zoom;
    updateZoomDisplay(config.zoom);
    loginServerSel.value = loginKey;
    loginServerSel.setAttribute("data-previous", loginKey);
    versionDiv.innerHTML = appVersion;
    activeServer.innerHTML = server[loginKey][0].address;

    // Read actual FPS from exe to seed session tracker.
    // This handles the case where user changed FPS in UI but exited before playing.
    try {
        const result = await window.electronAPI.readExeFps();
        console.log('[RENDERER] readExeFps result:', JSON.stringify(result));
        if (result && result.exeFps !== null && result.exeFps !== undefined) {
            sessionLastPatchedFps = Number(result.exeFps);
            console.log('[RENDERER] Seeded sessionLastPatchedFps from exe:', result.exeFps, '| configFps:', config.fps);
            
            // Alert user if there's an unapplied FPS change
            const exeFps = Number(result.exeFps);
            const configFps = Number(config.fps);
            if (exeFps !== configFps) {
                console.warn('[RENDERER] Unapplied FPS change detected! Exe:', exeFps, 'Config:', configFps);
                // Defer the blocking dialog so it doesn't stall the first paint.
                scheduleAfterPaint(() => {
                    alert(`Unapplied FPS Change Detected\n\nYour FPS setting was changed from ${exeFps} FPS to ${configFps} FPS, but was not applied last session.\n\nThe updated value of ${configFps} FPS will apply next time you click "Play".`);
                });
            }
        } else {
            // Fallback to config FPS if exe read fails
            sessionLastPatchedFps = Number(config.fps);
            console.warn('[RENDERER] readExeFps returned null/undefined, falling back to config.fps:', config.fps, 'Full result:', JSON.stringify(result));
        }
    } catch (err) {
        // Fallback to config FPS if read errors
        sessionLastPatchedFps = Number(config.fps);
        console.error('[RENDERER] readExeFps threw error, falling back to config.fps:', config.fps, 'Error:', err.message || err);
    }

    // Do not block startup readiness on network calls.
    getServerStatus(loginKey).catch((err) => {
        console.warn('[RENDERER] Initial server status request failed:', err && err.message ? err.message : err);
    });
    console.log('[RENDERER] configReady complete');
  } catch (err) {
    // Never let a config-load failure leave configReady rejected — downstream code
    // `await`s it before enabling the UI, so a rejection would brick the launcher
    // with no feedback. Surface an error and let startup continue with defaults.
    console.error('[RENDERER] configReady failed:', err && err.message ? err.message : err);
    try { progressText.innerHTML = 'Failed to load launcher configuration. Some settings may be unavailable.'; } catch (e) {}
  }
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

function getOptionsFile() { return 'options'; }
function getLoginFile() { return 'login'; }
/*
 * ---------------------
 *    Config Loading & Saving
 * ---------------------
 */
// Helper to set config defaults, always reloads config from disk first

async function setDefault(key, defaultValue) {
    await loadConfig();
    if (config[key] === undefined || config[key] === null) {
        console.error(`[LAUNCHER CONFIG] Config key "${key}" not found, setting default value: ${defaultValue}`);
        config[key] = defaultValue;
        await saveConfig({ [key]: defaultValue });
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
    await window.electronAPI.modifyCfg(getLoginFile(), {
        "ClientGame": {
            "loginServerAddress0": server[config.login][0].address,
            "loginServerPort0": server[config.login][0].port,
            "freeChaseCameraMaximumZoom": config.zoom
        }
    }, false);
    await window.electronAPI.modifyCfg(getOptionsFile(), {
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
    // Only use deleteConfigKeys, which updates both main and local config
    await deleteConfigKeys(removedKeys);
    console.log("[LAUNCHER CONFIG] Old config keys removed.");
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
    (async () => {
        await saveConfig({ "soundsEnabled": enableSounds.checked });
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
        const body = await fetchWithTimeout(server[serverLogin][0].statusUrl, 8000);
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
        if (err.name === 'AbortError' || (err && err.message === 'Request timed out')) {
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
    let sawValidResponse = false;

    function normalizeStatus(statusText) {
        return String(statusText || '').trim().toLowerCase();
    }

    function isRetryableStatus(statusText) {
        const status = normalizeStatus(statusText);
        return (
            status === 'unknown' ||
            status === 'offline' ||
            status === 'timeout' ||
            status === 'invalid' ||
            status.includes('error')
        );
    }

    for (let i = 0; i < maxRetries; i++) {
        const currentStatus = normalizeStatus(serverStatus.innerHTML);
        // Retry if status is unknown, offline, timeout, or error
        if (!isRetryableStatus(currentStatus)) {
            retryFailed = false;
            break;
        }

        try {
            console.log(`[SERVER STATUS] Retry attempt ${i + 1}...`);

            const body = await fetchWithTimeout(server[serverLogin][0].statusUrl, 8000);
            if (!validateBody(body)) {
                console.warn(`[SERVER STATUS] Invalid server response during retry attempt ${i + 1}.`);
                continue;
            }

            sawValidResponse = true;
            updateServerDisplay(body);

            const status = normalizeStatus(body.status);
            if (!isRetryableStatus(status)) {
                console.log(`[SERVER STATUS] Server produced a non-error, non-offline, non-timeout, non-error state during retry attempt ${i + 1}.`);
                retryFailed = false;
                break;
            }
        } catch (err) {
            console.warn(`[SERVER STATUS] Retry ${i + 1} failed: ${err.message}`);

        }

        await new Promise(res => setTimeout(res, 2000 * Math.pow(1.5, i)));
    }

    if (retryFailed && !sawValidResponse) {
        console.log("[SERVER STATUS] All retry attempts failed. Displaying failure message.");
    } else if (retryFailed && sawValidResponse) {
        console.log("[SERVER STATUS] Retry attempts completed with valid responses, but server remained in a retryable state.");
    }
}

function updateServerDisplay(body) {
    // Persistent state
    if (!updateServerDisplay.lastBody) {
        updateServerDisplay.lastBody = {};
    }

    const last = updateServerDisplay.lastBody;
    let updated = false;
    const displayedStatus = String(serverStatus.innerHTML || '').trim().toLowerCase();
    const incomingStatus = String(body.status || '').trim().toLowerCase();

    if (body.status !== last.status || displayedStatus !== incomingStatus || displayedStatus.includes("error")) {
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
    let didTimeout = false;
    const timeout = setTimeout(() => {
        didTimeout = true;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (err) {
        if (didTimeout) {
            throw new Error('Request timed out');
        }
        throw err;
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
minBtn.addEventListener('click', () => window.electronAPI.minimize());
closeBtn.addEventListener('click', () => window.electronAPI.close());

let sessionLastPatchedFps = null;
let gameIsRunning = false;
let buttonPriorLabel = 'Play';

function logPlayFlow(state, details) {
    if (typeof details === 'undefined') {
        console.log(`[PLAY FLOW] ${state}`);
        return;
    }
    try {
        console.log(`[PLAY FLOW] ${state} ${JSON.stringify(details)}`);
    } catch (_err) {
        console.log(`[PLAY FLOW] ${state} ${String(details)}`);
    }
}

/*
 * ---------------------
 *    Play Button Logic
 * ---------------------
 */
playBtn.addEventListener('click', () => {
    logPlayFlow('click', {
        disabled: playBtn.disabled,
        setupMode: playBtn.classList.contains('game-setup'),
        label: playBtn.innerHTML,
        configFps: config.fps
    });
    if (playBtn.disabled) return;
    if (playBtn.classList.contains("game-setup")) {
        logPlayFlow('setup mode -> setupGame');
        window.electronAPI.setupGame();
        return;
    }

    const desiredFps = Number(config.fps);
    buttonPriorLabel = playBtn.innerHTML;
    playBtn.disabled = true;
    logPlayFlow('play button disabled; requesting fps patch check', {
        priorLabel: buttonPriorLabel,
        desiredFps
    });

    function launchGame() {
        playBtn.innerHTML = "Launching...";
        logPlayFlow('state -> Launching...');
        gameIsRunning = true;
        play()
            .catch((err) => {
                console.error(`[PLAY] Launch failed: ${err.message}`);
                gameIsRunning = false;
                playBtn.innerHTML = buttonPriorLabel;
                playBtn.disabled = false;
            });
    }

    function afterPatch(result) {
        logPlayFlow('patch result', result || null);
        if (result && result.error && result.code === 'EBUSY') {
            logPlayFlow('patch locked (EBUSY); alert then launch anyway');
            alert(`Could not apply new FPS value (${config.fps} FPS). Close all instances of the game to update FPS. The requested SWG client instance will launch with old value (${sessionLastPatchedFps} FPS) applied.`);
            launchGame();
            return;
        }

        if (result && result.patched) {
            sessionLastPatchedFps = Number(config.fps);
            logPlayFlow('fps patch applied; continue launch');
            launchGame();
        } else {
            sessionLastPatchedFps = Number(config.fps);
            logPlayFlow('no patch required; continue launch');
            launchGame();
        }
    }

    if (desiredFps !== sessionLastPatchedFps) {
        playBtn.innerHTML = "Applying FPS...";
        logPlayFlow('state -> Applying FPS...');
        logPlayFlow('waiting for exe-fps-ready event');
        window.electronAPI.onExeFpsReady(afterPatch);
        window.electronAPI.startPatchExeFps(desiredFps);
    } else {
        logPlayFlow('fps already patched this session', { desiredFps, sessionLastPatchedFps });
        launchGame();
    }
});

// Listen for game lifecycle events
window.electronAPI.onGameLaunched(() => {
    logPlayFlow('event: game-launched; window opened successfully');
    gameIsRunning = true;
    playBtn.innerHTML = 'Play';
    playBtn.disabled = false;
});

window.electronAPI.onGameExited(() => {
    logPlayFlow('event: game-exited; game instance closed');
});

async function beginInstall(args) {
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
        await window.electronAPI.cleanupFiles(config.folder, cleanup.map(file => file.name));
    }
    if (args.swgdir !== '') {
        console.log('Copying over files.');
        await window.electronAPI.startInstall(args.swgdir, false);
    }
    else {
        await window.electronAPI.startInstall(null, true);
    }
}

window.electronAPI.onSetupBeginInstall((args) => { beginInstall(args); });

async function play() {
    var args = ["--",
        "-s", "ClientGame", "loginServerAddress0=" + server[config.login][0].address, "loginServerPort0=" + server[config.login][0].port,
        "-s", "Station", "gameFeatures=34929",
        "-s", "SwgClient", "allowMultipleInstances=true"];
    logPlayFlow('spawnGame invoke', { folder: config.folder, ram: config.ram, args });
    window.electronAPI.spawnGame(config.folder, args, config.ram);
    logPlayFlow('spawnGame completed');
}

/*
 * ---------------------
 *    Skill Planner Executable
 * ---------------------
 */
skillPlanner.addEventListener('click', event => {
    window.electronAPI.spawnExe(config.folder, 'KSWGProfCalcEditor.exe');
});

/*
 * ---------------------
 *    SWG Setup Executable
 * ---------------------
 */
swgOptionsBtn.addEventListener('click', event => {
    window.electronAPI.spawnExe(config.folder, 'SWGEmu_Setup.exe');
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
        window.electronAPI.openExternal(e.target.href);
});

headerLinks.addEventListener('auxclick', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("header-link"))
        window.electronAPI.openExternal(e.target.href);
});

mainButtonLinks.addEventListener('click', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("button-link"))
        window.electronAPI.openExternal(e.target.href);
});

mainButtonLinks.addEventListener('auxclick', function (e) {
    e.preventDefault();
    if (e.target.classList.contains("button-link"))
    window.electronAPI.openExternal(e.target.href);
});

/*
 * ---------------------
 *    News & Updates View Window
 * ---------------------
 */
function updateNewsViewBounds() {
    const rect = newsUpdatesView.getBoundingClientRect();
    window.electronAPI.setNewsViewBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    });

    const refreshRect = newsUpdatesRefresh.getBoundingClientRect();
    window.electronAPI.setNewsRefreshBounds({
        x: Math.round(refreshRect.left),
        y: Math.round(refreshRect.top),
        width: Math.max(1, Math.round(refreshRect.width)),
        height: Math.max(1, Math.round(refreshRect.height)),
    });
}

window.addEventListener('resize', updateNewsViewBounds);
window.addEventListener('load', updateNewsViewBounds);
setTimeout(updateNewsViewBounds, 50);
setTimeout(updateNewsViewBounds, 350);
if (newsUpdatesWrapper) {
    newsUpdatesWrapper.addEventListener('mouseenter', updateNewsViewBounds);
}

window.electronAPI.onNewsViewLoaded(function () {
    newsUpdatesRefresh.className = 'news-updates-refresh hidden';
    window.electronAPI.setNewsRefreshState('hidden');
    newsUpdatesView.style.opacity = '1';
    updateNewsViewBounds();
    setTimeout(function () {
        newsUpdatesRefresh.disabled = false;
        newsUpdatesRefresh.className = 'news-updates-refresh';
        window.electronAPI.setNewsRefreshState('idle');
        updateNewsViewBounds();
    }, 2000);
});

window.electronAPI.onNewsRefreshClicked(function () {
    newsUpdatesRefresh.disabled = true;
    newsUpdatesRefresh.className = 'news-updates-refresh spinner';
    window.electronAPI.setNewsRefreshState('spinner');
    newsUpdatesView.style.opacity = '0';
});

newsUpdatesRefresh.addEventListener('click', function (e) {
    newsUpdatesRefresh.disabled = true;
    newsUpdatesRefresh.className = 'news-updates-refresh spinner';
    window.electronAPI.setNewsRefreshState('spinner');
    window.electronAPI.reloadNewsView();
    newsUpdatesView.style.opacity = '0';
});

/* 
 * -----------------
 *    Game Config
 * -----------------
 */
fpsSel.addEventListener('change', async event => {
    const val = Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(val)) return;
    if (val > 60) {
        await window.electronAPI.modifyCfg(getOptionsFile(), {
            "Direct3d9": { "allowTearing": 1 }
        }, false);
    }
    await window.electronAPI.modifyCfg(getOptionsFile(), {
        "Direct3d9": { "fullscreenRefreshRate": val }
    }, false);
    await saveConfig({ "fps": val });
    showFpsNotice();
});
ramSel.addEventListener('change', async event => {
    const ram = Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(ram)) return;
    await saveConfig({ "ram": ram });
});
async function persistZoom(zoomValueNum) {
    updateZoomDisplay(zoomValueNum);
    zoomSel.value = String(zoomValueNum);
    await window.electronAPI.modifyCfg(getLoginFile(), {
        "ClientGame": { "freeChaseCameraMaximumZoom": zoomValueNum }
    }, false);
    await saveConfig({ "zoom": zoomValueNum });
}

zoomSel.addEventListener('change', async event => {
    const zoomValueNum = normalizeZoom(event.target.value);
    await persistZoom(zoomValueNum);
});

zoomSel.addEventListener('input', event => {
    const zoomValueNum = normalizeZoom(event.target.value);
    updateZoomDisplay(zoomValueNum);
});

if (zoomPopoverToggle && zoomPopover) {
    const setZoomPopoverOpen = (open) => {
        const isOpen = Boolean(open) && !zoomPopoverToggle.disabled;
        zoomPopover.hidden = !isOpen;
        zoomPopoverToggle.classList.toggle('active', isOpen);
        zoomPopoverToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    };

    const toggleZoomPopover = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (zoomPopoverToggle.disabled) return;
        setZoomPopoverOpen(zoomPopover.hidden);
    };

    if (zoomPopoverToggle.tagName === 'SELECT') {
        zoomPopoverToggle.addEventListener('mousedown', toggleZoomPopover);
        zoomPopoverToggle.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
        });
        zoomPopoverToggle.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                toggleZoomPopover(event);
            }
        });
    } else {
        zoomPopoverToggle.addEventListener('click', toggleZoomPopover);
    }

    if (zoomPopoverClose) {
        zoomPopoverClose.addEventListener('click', event => {
            event.stopPropagation();
            setZoomPopoverOpen(false);
        });
    }

    zoomPopover.addEventListener('click', event => {
        event.stopPropagation();
    });

    document.addEventListener('click', () => {
        setZoomPopoverOpen(false);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') setZoomPopoverOpen(false);
    });
}

// "Change" directory button button pressed
let gameDirSaveTimer = null;
changeDirBtn.addEventListener('click', function (event) {
    // A pending debounced save of a typed path would otherwise fire ~500ms later
    // and clobber the folder the user is about to pick from the dialog.
    clearTimeout(gameDirSaveTimer);
    window.electronAPI.openDirectoryDialog('selected-directory');
});

gameDirBox.addEventListener('keyup', event => {
    clearTimeout(gameDirSaveTimer);
    const val = event.target.value;
    gameDirSaveTimer = setTimeout(async () => {
        await saveConfig({ "folder": val });
    }, 500);
});

window.electronAPI.onDirectorySelected(async function (dir) {
    // Cancel any pending debounced save of a typed path so it can't overwrite the
    // folder chosen here. Ignore a cancelled dialog (main replies null on cancel).
    clearTimeout(gameDirSaveTimer);
    if (!dir) return;
    configPromptClose.setAttribute("data-prompt-attr", "gameDir");
    configPromptClose.setAttribute("data-prompt-value", gameDirBox.value);
    if (await window.electronAPI.checkGameInstalled(dir)) {
        gameDirBox.value = dir;
        await saveConfig({ "folder": dir });
        toggleAll(false, true);
        resetProgress();
        await window.electronAPI.startInstall(null, true);
    } else {
        document.getElementById('gameDirPromptBox').value = dir;
        configOverlayPrompt("gameDirPrompt");
        helpBtn.disabled = true;
    }
});

// Config "Run Setup" button pressed
configSetupBtn.addEventListener('click', function (event) {
    window.electronAPI.setupGame();
});

// Config "Login Server" select pressed
loginServerSel.addEventListener('change', event => {
    configPromptClose.setAttribute("data-prompt-attr", "loginServerSelect");
    configPromptClose.setAttribute("data-prompt-value", loginServerSel.getAttribute("data-previous"));
    configOverlayPrompt("loginServerPrompt");
    helpBtn.disabled = true;
});

loginServerConfirm.addEventListener('click', async function (event) {
    // Switching servers always rewrites the game files that differ between test and
    // live. A running client keeps those files memory-mapped, so the replace cannot
    // land — check before touching config or starting a patch, otherwise the switch
    // half-applies: the new server is saved but its files fail to install.
    if (await window.electronAPI.isGameRunning()) {
        alert('Close all running game clients before switching servers.\n\nThe game holds its data files open while running, so the launcher cannot swap them for the other server\'s versions.');
        configOverlayClose(true); // restores the dropdown to the current server
        return;
    }

    config.login = loginServerSel.value;

    // Persist the new server selection to the launcher config BEFORE starting
    // the install. The main process resolves which server's files to fetch from
    // its own copy of config.login (updated asynchronously via set-launcher-config),
    // so the install must not start until that write has landed — otherwise it
    // runs against the previously selected server.
    await saveConfig({ "login": loginServerSel.value });

    await window.electronAPI.modifyCfg(getLoginFile(), {
            "ClientGame": {
                "loginServerAddress0": server[config.login][0].address,
                "loginServerPort0": server[config.login][0].port,
            }
        }, false);

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
    window.electronAPI.startInstall(null, true);
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
    const anchor = e.target.closest('a');
    if (!anchor) return;
    e.preventDefault();
    window.electronAPI.openExternal(anchor.href);
});

setupComplete.addEventListener('click', function (e) {
    const anchor = e.target.closest('a');
    if (!anchor) return;
    e.preventDefault();
    window.electronAPI.openExternal(anchor.href);
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
    // cancelInstall also drops a patch that is only waiting on the game to close.
    window.electronAPI.cancelInstall();
    cancelledState = true;
    networkPaused = false; // Explicit user cancel - do not auto-resume on reconnect
    progressActive = false;
    stopProgressAnimation();
    resetProgress();
    window.electronAPI.clearInstallResumeState();
    progressText.className = 'active';
    progressText.innerHTML = 'Patch canceled.';
    toggleAll(true);
})

// A patch that can't start (or couldn't finish) because a client is open is held in
// main until the clients close, then run from there. These two events report that wait
// starting and ending — the launcher stays usable throughout, so the only control that
// changes is CANCEL, which here means "stop waiting" rather than "abort a patch".
window.electronAPI.onInstallDeferred(function (reason) {
    progressActive = false;
    stopProgressAnimation();
    progressText.className = 'active';
    progressText.innerHTML = reason === 'interrupted'
        ? 'Patch interrupted by an open game client — it will continue once all clients are closed.'
        : 'Close all game clients — the patch will start automatically.';
    toggleAll(true);
    cancelBtn.disabled = false;
    cancelledState = true;
    networkPaused = false;
});

window.electronAPI.onInstallResumed(function (reason) {
    progressText.className = 'active';
    progressText.innerHTML = reason === 'interrupted'
        ? 'Game clients closed. Continuing patch...'
        : 'Game clients closed. Starting patch...';
    cancelledState = false;
    toggleAll(false, true);
    resetProgress();
});

window.electronAPI.onDownloadingUpdate(function (text) {
    versionDiv.innerHTML = text;
    toggleAll(false);
});

window.electronAPI.onDownloadProgress(function (info) {
    progressUpdate(info.transferred, info.total);
});

window.electronAPI.onInstallProgress(function (completed, total) {
    progressUpdate(completed, total);
});

window.electronAPI.onInstallError(function (message) {
    progressActive = false;
    stopProgressAnimation();
    progressText.className = 'active';
    const text = String(message || 'Unknown error');
    if (text.toLowerCase().includes('network interruption')) {
        progressText.innerHTML = 'Patch paused: network interruption. Reconnect to resume.';
        cancelledState = true;
        networkPaused = true;
        toggleAll(false, true);
        return;
    }
    progressText.innerHTML = 'Install failed: ' + text;
    toggleAll(true);
    cancelledState = true;
});

var lastCompleted = 0;
var lastTime = new Date();
var smoothedRateBps = 0;
var targetPercent = 0;
var displayedPercent = 0;
var progressAnimationFrame = null;
var progressActive = false;

function formatRate(bps) {
    var rate = Math.max(0, bps);
    var units = ' B/s';
    if (rate > 1024) {
        rate = rate / 1024;
        units = ' KB/s';
    }
    if (rate > 1024) {
        rate = rate / 1024;
        units = ' MB/s';
    }
    if (!Number.isFinite(rate)) {
        return '0 B/s';
    }
    return parseFloat(rate.toPrecision(3)) + units;
}

function stopProgressAnimation() {
    if (progressAnimationFrame !== null) {
        cancelAnimationFrame(progressAnimationFrame);
        progressAnimationFrame = null;
    }
}

function renderProgress() {
    var delta = targetPercent - displayedPercent;
    if (Math.abs(delta) < 0.05) {
        displayedPercent = targetPercent;
    } else {
        // Ease toward target so bursty backend updates appear smoother.
        displayedPercent += delta * 0.2;
    }

    var safePercent = Math.max(0, Math.min(100, displayedPercent));
    progressBar.style.width = safePercent + '%';

    if (navigator.onLine) {
        progressText.innerHTML = Math.trunc(safePercent) + '% (' + formatRate(smoothedRateBps) + ')';
    }

    if (progressActive || Math.abs(targetPercent - displayedPercent) >= 0.05) {
        progressAnimationFrame = requestAnimationFrame(renderProgress);
    } else {
        progressAnimationFrame = null;
    }
}

function ensureProgressAnimation() {
    if (progressAnimationFrame === null) {
        progressAnimationFrame = requestAnimationFrame(renderProgress);
    }
}

function resetProgress() {
    lastCompleted = 0;
    lastTime = new Date();
    smoothedRateBps = 0;
    targetPercent = 0;
    displayedPercent = 0;
    progressActive = false;
    stopProgressAnimation();
    progressBar.style.width = '0%';
}

function progressUpdate(completed, total) {
    // Late progress events can arrive briefly after cancel; ignore those.
    if (cancelledState && cancelBtn.disabled) {
        return;
    }

    if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
        console.warn('[PATCH PROGRESS] Invalid progress payload:', { completed, total });
        return;
    }

    if (completed < total) {
        cancelledState = false;
        toggleAll(false, true);
        progressActive = true;
    }

    var time = new Date();
    var elapsed = (time - lastTime) / 1000;
    if (elapsed >= 0.25) {
        var bytes = completed - lastCompleted;
        var instantRateBps = Math.max(0, bytes / elapsed);
        var alpha = 0.25;
        smoothedRateBps = smoothedRateBps === 0
            ? instantRateBps
            : alpha * instantRateBps + (1 - alpha) * smoothedRateBps;
        lastCompleted = completed;
        lastTime = time;
    }

    targetPercent = Math.max(0, Math.min(100, (completed * 100 / total)));

    if (progressText.className == 'complete') progressText.className = 'active';
    // Do not check navigator.onLine here - handleDisconnect owns the offline transition
    // and sets networkPaused correctly. An inline check here races against it, wiping
    // the progress bar and setting cancelledState without setting networkPaused.
    ensureProgressAnimation();
    if (completed == total && navigator.onLine) {
        progressActive = false;
        targetPercent = 100;
        ensureProgressAnimation();
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
    window.electronAPI.startInstall(null, true);
}

// Ensure this block only runs after config is loaded
(async () => {
    await configReady;
    // Enable play, game config, and swg options buttons after config is ready
    gameConfigBtn.disabled = false;
    swgOptionsBtn.disabled = false;
    if (await window.electronAPI.checkGameInstalled(config.folder)) {
        toggleAll(false, true);
        resetProgress();
        await window.electronAPI.startInstall(null, true);
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
        if (zoomPopoverToggle) zoomPopoverToggle.disabled = true;
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
    swgOptionsBtn.disabled = !enable;
    ramSel.disabled = !enable;
    fpsSel.disabled = !enable;
    zoomSel.disabled = !enable;
    if (zoomPopoverToggle) zoomPopoverToggle.disabled = !enable;
    if (!enable && zoomPopover) {
        zoomPopover.hidden = true;
        if (zoomPopoverToggle) zoomPopoverToggle.classList.remove('active');
    }
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
// Distinct from cancelledState: only true when a network drop paused an active install.
// Prevents reconnect from resuming a user-cancelled or never-started install.
let networkPaused = false;
// Guard against multiple rapid 'online' events starting concurrent resumes.
let isResuming = false;

function handleDisconnect() {
    console.warn("[NETWORK] Disconnected from internet.");
    isDisconnected = true;

    // cancelBtn is only enabled while patching is actively running (set by toggleAll(false, true)).
    // Using this is more reliable than className which is also 'active' in error/failed states.
    if (cancelBtn.disabled === false) {
        console.warn('[NETWORK] Pausing install due to network disconnection');
        window.electronAPI.cancelInstall();
        progressActive = false;
        stopProgressAnimation();
        progressText.className = 'active';
        progressText.innerHTML = 'Patch paused: network disconnected. Reconnect to resume.';
        cancelledState = true;
        networkPaused = true;
        toggleAll(false, true);
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

    await configReady;
    await getServerStatus(config.login);
    window.electronAPI.reloadNewsView();

    // Only resume if a network drop specifically paused an active install,
    // not a user-initiated cancel or an install that was never running.
    if (!networkPaused || isResuming) return;

    isResuming = true;
    try {
        console.log('[NETWORK] Attempting to resume network-paused install');

        progressActive = false;
        stopProgressAnimation();
        progressText.className = 'active';
        progressText.innerHTML = 'Patch resuming: re-validating files and resuming download...';
        toggleAll(false, true);

        // Wait briefly for connection to stabilize before restarting workers
        await new Promise(resolve => setTimeout(resolve, 500));

        // Clear networkPaused only immediately before starting - if anything above throws,
        // networkPaused stays true so the next reconnect event can retry.
        networkPaused = false;
        await window.electronAPI.startInstall(null, false, true);
    } catch (err) {
        // Restore networkPaused so the next reconnect can attempt resume again
        networkPaused = true;
        console.error('[NETWORK] Resume attempt failed, will retry on next reconnect:', err);
    } finally {
        isResuming = false;
    }
}


/*
 * ---------------------
 *    Launcher Debug
 * ---------------------
 */
versionDiv.addEventListener('click', () => window.electronAPI.toggleDevTools());