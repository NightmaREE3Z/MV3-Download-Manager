// MV3 Download Manager background/service worker script

console.info("[SW] Service worker script loaded at", new Date().toISOString());

self.addEventListener('install', (event) => {
    console.info("[SW] Service worker installed at", new Date().toISOString());
    event.waitUntil(self.skipWaiting());
});

let keepAliveInterval;
function startKeepAlive() {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
        console.debug("[SW] Keeping service worker alive");
        chrome.runtime.getPlatformInfo(() => {});
    }, 20000);
}

let canvas, ctx;
let canvasInitRetries = 0;
const MAX_CANVAS_INIT_RETRIES = 3;

function initializeCanvas() {
    try {
        canvas = new OffscreenCanvas(38, 38);
        ctx = canvas.getContext('2d', { 
            willReadFrequently: true,
            alpha: true 
        });
        console.info("[SW] Canvas initialized");
        return true;
    } catch (e) {
        console.error("[SW] Canvas init error:", e);
        if (canvasInitRetries < MAX_CANVAS_INIT_RETRIES) {
            canvasInitRetries++;
            setTimeout(initializeCanvas, 1000 * canvasInitRetries);
        }
        return false;
    }
}

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;
let downloadsState = {};
let pollTimer = null;
let serviceWorkerReady = false;

self.addEventListener('error', function(e) {
    console.error('[SW] Uncaught error:', e.message, e);
});

self.addEventListener('unhandledrejection', function(e) {
    console.error('[SW] Unhandled rejection:', e.reason, e);
});

self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            new Promise(resolve => {
                if (!ctx && !initializeCanvas()) {
                    console.warn("[SW] Canvas initialization failed during activation");
                }
                serviceWorkerReady = true;
                console.info("[SW] Service worker activated");
                startKeepAlive();
                resolve();
            })
        ])
    );
});

function initialize() {
    try {
        if (!ctx && !initializeCanvas()) {
            console.warn("[SW] Canvas initialization failed during init");
        }

        setDefaultBlueIcon();
        refreshStateAndIcon();
        
        startKeepAlive();
        serviceWorkerReady = true;
    } catch (e) {
        console.error("[SW] Initialization failed:", e);
        setTimeout(initialize, 2000);
    }
}

if (chrome?.runtime) {
    chrome.runtime.onStartup.addListener(initialize);
    chrome.runtime.onInstalled.addListener(initialize);

    chrome.runtime.onConnect.addListener(port => {
        if (port.name === 'popup') {
            isPopupOpen = true;
            port.onDisconnect.addListener(() => {
                isPopupOpen = false;
                refreshStateAndIcon();
            });
        }
    });
}

if (chrome?.downloads) {
    chrome.downloads.onCreated.addListener(item => {
        downloadsState[item.id] = item;
        refreshStateAndIcon();
    });

    chrome.downloads.onChanged.addListener(event => {
        if (downloadsState[event.id]) {
            Object.keys(event).forEach(key => {
                if (event[key] && typeof event[key] === "object" && "current" in event[key]) {
                    downloadsState[event.id][key] = event[key].current;
                }
            });
        }
        
        if (event.state?.current === 'complete' && !isPopupOpen) {
            unseen.push(event);
        }
        
        if (event.danger) {
            isUnsafe = event.danger.current !== 'accepted';
        }
        
        refreshStateAndIcon();
    });

    chrome.downloads.onErased.addListener(id => {
        delete downloadsState[id];
        chrome.downloads.search({}, downloads => {
            if (downloads.length === 0) {
                unseen = [];
                setDefaultBlueIcon();
            }
            refreshStateAndIcon();
        });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'init') {
        sendResponse({ ok: serviceWorkerReady, time: Date.now() });
        return true;
    }
    
    if (message.ping) {
        sendResponse({ pong: true, time: Date.now() });
        return true;
    }
    
    if (message === 'popup_open') {
        isPopupOpen = true;
        unseen = [];
        refreshStateAndIcon();
        chrome.downloads.search({ orderBy: ["-startTime"] }, downloads => {
            if (!chrome.runtime.lastError) {
                updateDownloadsState(downloads);
                chrome.runtime.sendMessage({ 
                    type: "downloads_state", 
                    data: downloads 
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error("[SW] Failed to send downloads state:", chrome.runtime.lastError);
                    }
                });
            }
        });
        return true;
    }
    
    if (message === 'popup_closed') {
        isPopupOpen = false;
        refreshStateAndIcon();
        return true;
    }

    if (message.type === 'get_downloads_state') {
        chrome.downloads.search({ orderBy: ["-startTime"] }, downloads => {
            if (!chrome.runtime.lastError) {
                updateDownloadsState(downloads);
                sendResponse(downloads);
            }
        });
        return true;
    }
    
    if (message.window) {
        devicePixelRatio = message.window.devicePixelRatio;
        prefersColorSchemeDark = message.window.prefersColorSchemeDark;
        refreshStateAndIcon();
        sendResponse({ ok: true });
        return true;
    }

    sendResponse({ error: "Unknown message" });
    return true;
});

function updateDownloadsState(downloads) {
    downloadsState = {};
    downloads.forEach(item => {
        downloadsState[item.id] = item;
    });
}

function refreshStateAndIcon() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    
    chrome.downloads.search({}, allDownloads => {
        updateDownloadsState(allDownloads);
        const inProgress = allDownloads.filter(d =>
            d.state === "in_progress" && !d.paused && d.totalBytes > 0
        );
        
        if (inProgress.length > 0) {
            const progressItem = inProgress.reduce((latest, item) => {
                const end = new Date(item.estimatedEndTime || 0).getTime();
                const latestEnd = new Date(latest.estimatedEndTime || 0).getTime();
                return end > latestEnd ? item : latest;
            }, inProgress[0]);
            
            if (progressItem?.totalBytes > 0) {
                const progress = progressItem.bytesReceived / progressItem.totalBytes;
                if (progress > 0 && progress < 1) {
                    drawToolbarProgressIcon(progress);
                    pollTimer = setInterval(refreshStateAndIcon, 1000);
                    return;
                }
            }
        }
        
        if (allDownloads.some(item => item.state === "complete" && item.exists !== false)) {
            drawToolbarIcon(unseen, "#00CC00");
            return;
        }
        
        setDefaultBlueIcon();
    });
}

function setDefaultBlueIcon() {
    drawToolbarIcon([], "#00286A");
}

function getScale() {
    return devicePixelRatio < 2 ? 0.5 : 1;
}

function drawToolbarIcon(unseen, forceColor) {
    if (!ctx) {
        if (!initializeCanvas()) return;
    }
    
    const iconColor = forceColor || (unseen?.length > 0 ? "#00CC00" : "#00286A");
    const scale = getScale();
    const size = 38 * scale;
    
    try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, 38, 38);
        ctx.save();
        ctx.scale(scale, scale);
        
        ctx.strokeStyle = iconColor;
        ctx.fillStyle = iconColor;
        ctx.lineWidth = 14;
        
        ctx.beginPath();
        ctx.moveTo(20, 2);
        ctx.lineTo(20, 18);
        ctx.stroke();
        
        ctx.moveTo(0, 18);
        ctx.lineTo(38, 18);
        ctx.lineTo(20, 38);
        ctx.fill();
        
        ctx.restore();
        
        const icon = { imageData: {} };
        icon.imageData[size] = ctx.getImageData(0, 0, size, size);
        
        chrome.action.setIcon(icon, () => {
            if (chrome.runtime.lastError) {
                console.error("[SW] Error setting icon:", chrome.runtime.lastError);
            }
        });
    } catch (e) {
        console.error("[SW] Error drawing toolbar icon:", e);
        initializeCanvas();
    }
}

function drawToolbarProgressIcon(progress) {
    if (!ctx) {
        if (!initializeCanvas()) return;
    }
    
    const iconColor = "#FFBB00";
    const scale = getScale();
    const size = 38 * scale;
    const width = progress * 38;
    
    try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, 38, 38);
        ctx.save();
        ctx.scale(scale, scale);
        
        ctx.lineWidth = 2;
        ctx.fillStyle = iconColor + '40';
        ctx.fillRect(0, 28, 38, 12);
        
        ctx.fillStyle = iconColor;
        ctx.fillRect(0, 28, width, 12);
        
        ctx.strokeStyle = iconColor;
        ctx.fillStyle = iconColor;
        ctx.lineWidth = 10;
        
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.lineTo(20, 14);
        ctx.stroke();
        
        ctx.moveTo(6, 10);
        ctx.lineTo(34, 10);
        ctx.lineTo(20, 24);
        ctx.fill();
        
        ctx.restore();
        
        const icon = { imageData: {} };
        icon.imageData[size] = ctx.getImageData(0, 0, size, size);
        
        chrome.action.setIcon(icon, () => {
            if (chrome.runtime.lastError) {
                console.error("[SW] Error setting progress icon:", chrome.runtime.lastError);
            }
        });
    } catch (e) {
        console.error("[SW] Error drawing progress icon:", e);
        initializeCanvas();
    }
}

initialize();