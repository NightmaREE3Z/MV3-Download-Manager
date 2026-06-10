// MV3 Download Manager background/service worker script

console.info("[SW] Service worker script loaded at", new Date().toISOString());

let canvas, ctx;
let isInitialized = false;

async function initCanvas() {
  try {
    canvas = new OffscreenCanvas(38, 38);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not get canvas context");
    }
  } catch (e) {
    console.error("[SW] Canvas init error:", e);
    canvas = null;
    ctx = null;
  }
}

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;
let downloadsState = {};
let pollTimer = null;

// === Downloads Anti-WebP background fetch bridge ===
// Google Images preview overlays live on google.* while the actual image may live on
// another CDN. Drawing that cross-origin image directly to canvas taints it, so the
// content script can ask the extension background to fetch the bytes with extension
// host permissions, return a data URL, and let the content script convert that to PNG.
const DOWNLOADS_ANTIWEBP_MAX_FETCH_BYTES = 18 * 1024 * 1024;

function downloadsAntiwebpArrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function downloadsAntiwebpIsHttpImageFetchUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function downloadsAntiwebpIsFetchMessage(message) {
  return !!(message && (
    message.type === 'DOWNLOADS_ANTIWEBP_FETCH_IMAGE_AS_DATA_URL' ||
    message.type === 'BRAVEFOX_ANTIWEBP_FETCH_IMAGE_AS_DATA_URL'
  ));
}

async function downloadsAntiwebpFetchImageAsDataUrl(value) {
  try {
    const url = String(value || '').trim();
    if (!downloadsAntiwebpIsHttpImageFetchUrl(url)) {
      return { ok: false, error: 'Invalid image URL' };
    }

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'Accept': 'image/png,image/jpeg,image/gif,image/bmp,image/*;q=0.8,*/*;q=0.1'
      }
    });

    if (!response || !response.ok) {
      return { ok: false, error: 'Fetch failed', status: response ? response.status : 0 };
    }

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\//i.test(contentType)) {
      return { ok: false, error: 'Response was not an image', contentType };
    }

    // Preserve GIF/SVG instead of flattening/rewriting them.
    if (/^image\/(?:gif|svg\+xml)$/i.test(contentType)) {
      return { ok: false, error: 'Skipped animated/vector image', contentType };
    }

    const buffer = await response.arrayBuffer();
    if (!buffer || buffer.byteLength <= 0) {
      return { ok: false, error: 'Empty image response', contentType };
    }
    if (buffer.byteLength > DOWNLOADS_ANTIWEBP_MAX_FETCH_BYTES) {
      return { ok: false, error: 'Image too large', size: buffer.byteLength, contentType };
    }

    const base64 = downloadsAntiwebpArrayBufferToBase64(buffer);
    return {
      ok: true,
      contentType,
      size: buffer.byteLength,
      dataUrl: `data:${contentType || 'image/png'};base64,${base64}`
    };
  } catch (e) {
    return { ok: false, error: e && (e.message || String(e)) };
  }
}


self.addEventListener('error', function (e) {
  console.error('[SW] Uncaught error:', e.message, e);
});
self.addEventListener('unhandledrejection', function (e) {
  console.error('[SW] Unhandled rejection:', e.reason, e);
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
  console.info("[SW] Activated at", new Date().toISOString());
});

function initialize() {
  if (isInitialized) return;
  console.info("[SW] initialize() called at", new Date().toISOString());
  isInitialized = true;
  
  // Disable Chrome's native download shelf
  if (chrome.downloads && chrome.downloads.setShelfEnabled) {
    chrome.downloads.setShelfEnabled(false);
  }
  
  initCanvas();
  setDefaultBlueIcon();
  refreshStateAndIcon();
}

if (chrome && chrome.runtime) {
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      console.info("[SW] onStartup event fired at", new Date().toISOString());
      initialize();
    });
  }
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      console.info("[SW] onInstalled event fired at", new Date().toISOString());
      initialize();
    });
  }
}

// Only initialize once on startup
setTimeout(() => {
  if (!isInitialized) {
    initialize();
  }
}, 100);

if (chrome && chrome.downloads) {
  chrome.downloads.onCreated.addListener(item => {
    console.info("[SW] downloads.onCreated", item);
    downloadsState[item.id] = item;
    refreshStateAndIcon();
  });

  chrome.downloads.onChanged.addListener(event => {
    console.info("[SW] downloads.onChanged", event);
    if (downloadsState[event.id]) {
      Object.keys(event).forEach(key => {
        if (typeof event[key] === "object" && event[key] !== null && "current" in event[key]) {
          downloadsState[event.id][key] = event[key].current;
        } else {
          downloadsState[event.id][key] = event[key];
        }
      });
    }
    if (event.state && event.state.current === 'complete' && !isPopupOpen) {
      unseen.push(event);
    }
    if (event.danger && event.danger.current !== 'accepted') {
      isUnsafe = true;
    }
    if (event.danger && event.danger.current === 'accepted') {
      isUnsafe = false;
    }
    refreshStateAndIcon();
  });

  chrome.downloads.onErased.addListener(id => {
    console.info("[SW] downloads.onErased", id);
    delete downloadsState[id];
    chrome.downloads.search({}, allDownloads => {
      if (allDownloads.length === 0) {
        unseen = [];
        setDefaultBlueIcon();
        refreshStateAndIcon();
      } else {
        refreshStateAndIcon();
      }
    });
  });
}

if (chrome && chrome.runtime) {
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    console.info("[SW] onMessage received:", message, "at", new Date().toISOString(), "sender:", sender);

    let responded = false;
    try {
      if (downloadsAntiwebpIsFetchMessage(message)) {
        downloadsAntiwebpFetchImageAsDataUrl(message.url).then(
          response => { try { sendResponse(response); } catch (e) {} },
          error => { try { sendResponse({ ok: false, error: error && (error.message || String(error)) }); } catch (e) {} }
        );
        responded = true;
        return true;
      }
      if (message && message.type === 'init') {
        sendResponse({ ok: true, time: Date.now() });
        responded = true;
        return true;
      }
      if (message && message.ping) {
        sendResponse({ pong: true, time: Date.now() });
        responded = true;
        return true;
      }
      if (message === 'popup_open') {
        isPopupOpen = true;
        unseen = [];
        refreshStateAndIcon();
        sendInvalidateGizmo();
        chrome.downloads.search({ orderBy: ["-startTime"] }, downloads => {
          if (chrome.runtime.lastError) {
            console.error("[SW] popup_open: downloads.search error", chrome.runtime.lastError);
            return;
          }
          updateDownloadsState(downloads);
          chrome.runtime.sendMessage({ type: "downloads_state", data: downloads }, function () { });
        });
      }
      if (message === 'popup_closed') {
        isPopupOpen = false;
        refreshStateAndIcon();
      }
      if (typeof message === 'object' && message.type === 'get_downloads_state') {
        chrome.downloads.search({ orderBy: ["-startTime"] }, downloads => {
          if (chrome.runtime.lastError) {
            console.error("[SW] get_downloads_state: downloads.search error", chrome.runtime.lastError);
            sendResponse([]);
            return;
          }
          updateDownloadsState(downloads);
          sendResponse(downloads);
        });
        responded = true;
        return true;
      }
      if (typeof message === 'object' && message.window) {
        devicePixelRatio = message.window.devicePixelRatio;
        prefersColorSchemeDark = message.window.prefersColorSchemeDark;
        refreshStateAndIcon();
        sendResponse({ ok: true });
        responded = true;
        return;
      }
      if (!responded && typeof sendResponse === 'function') {
        sendResponse({ error: "Unknown message", time: Date.now() });
        responded = true;
        return;
      }
    } catch (err) {
      console.error("[SW] Error in onMessage:", err);
      if (!responded) {
        try { sendResponse({ error: err && err.message }); } catch (e) { }
      }
    }
    if (!responded && typeof sendResponse === 'function') {
      try { sendResponse({ ok: true }); } catch (e) { }
    }
    return;
  });

  chrome.runtime.onConnect.addListener(function (externalPort) {
    externalPort.onDisconnect.addListener(function () {
      isPopupOpen = false;
      refreshStateAndIcon();
    });
    console.info("[SW] onConnect", externalPort);
  });
}

function updateDownloadsState(downloads) {
  downloadsState = {};
  downloads.forEach(item => { downloadsState[item.id] = item; });
}

function refreshStateAndIcon() {
  // Clear existing timer first
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  
  if (!chrome.downloads) return;
  
  chrome.downloads.search({}, function (allDownloads) {
    if (chrome.runtime.lastError) {
      console.error("[SW] refreshStateAndIcon error:", chrome.runtime.lastError);
      return;
    }
    
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
      
      if (progressItem && progressItem.totalBytes > 0) {
        const progress = progressItem.bytesReceived / progressItem.totalBytes;
        if (progress > 0 && progress < 1) {
          drawToolbarProgressIcon(progress);
          // Limit polling frequency to prevent hangs
          pollTimer = setInterval(() => {
            if (pollTimer) refreshStateAndIcon();
          }, 2000);
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

function sendShowGizmo() { sendMessageToActiveTab('show_gizmo'); }
function sendInvalidateGizmo() { sendMessageToActiveTab('invalidate_gizmo'); }
function sendMessageToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true, windowType: 'normal' }, function (tabs) {
    if (!tabs || !tabs.length) return;
    tabs.forEach(tab => {
      if (tab && tab.url && tab.url.startsWith('http')) {
        try {
          chrome.tabs.sendMessage(tab.id, message, function () { });
        } catch (e) { }
      }
    });
  });
}

function getScale() { return devicePixelRatio < 2 ? 0.5 : 1; }
function getIconColor(state) {
  if (state === "inProgress") return "#FFBB00";
  if (state === "finished") return "#00CC00";
  return "#00286A";
}
function drawToolbarIcon(unseen, forceColor) {
  if (!ctx) return;
  const iconColor = forceColor || getIconColor((unseen && unseen.length > 0) ? "finished" : "default");
  const scale = getScale();
  const size = 38 * scale;
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
  chrome.action.setIcon(icon);
}
function drawToolbarProgressIcon(progress) {
  if (!ctx) return;
  const iconColor = getIconColor("inProgress");
  const scale = getScale();
  const size = 38 * scale;
  const width = progress * 38;
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
  chrome.action.setIcon(icon);
}

self.addEventListener('message', event => {
  if (event && event.data === 'ping') {
    event.source && event.source.postMessage('pong');
  }
});