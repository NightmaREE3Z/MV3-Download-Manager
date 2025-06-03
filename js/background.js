// MV3 Download Manager background script – ultra-robust, verbose logging, best practices applied

// ========== VERBOSE LOGGING ==========
console.log("Service worker script loaded at", new Date().toISOString());

let canvas = new OffscreenCanvas(38, 38);
let ctx = canvas.getContext('2d', { willReadFrequently: true });

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;
let downloadsState = {};
let pollTimer = null;

// ========== ERROR HANDLING ==========
self.addEventListener('error', (e) => {
  console.error('[SW] Uncaught error:', e.message, e);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[SW] Unhandled rejection:', e.reason, e);
});

// ========== INITIALIZATION ==========
function initialize() {
  console.log("[SW] initialize() called at", new Date().toISOString());
  setDefaultBlueIcon();
  refreshStateAndIcon();
}
chrome.runtime.onStartup?.addListener(() => {
  console.log("[SW] onStartup event fired at", new Date().toISOString());
  initialize();
});
chrome.runtime.onInstalled?.addListener(() => {
  console.log("[SW] onInstalled event fired at", new Date().toISOString());
  initialize();
});
initialize();

// ========== DOWNLOAD EVENTS ==========
chrome.downloads.onCreated.addListener((item) => {
  console.log("[SW] downloads.onCreated", item);
  downloadsState[item.id] = item;
  refreshStateAndIcon();
});
chrome.downloads.onChanged.addListener((event) => {
  console.log("[SW] downloads.onChanged", event);
  if (downloadsState[event.id]) {
    Object.keys(event).forEach((key) => {
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
chrome.downloads.onErased.addListener((id) => {
  console.log("[SW] downloads.onErased", id);
  delete downloadsState[id];
  chrome.downloads.search({}, (allDownloads) => {
    if (allDownloads.length === 0) {
      unseen = [];
      setDefaultBlueIcon();
      refreshStateAndIcon();
    } else {
      refreshStateAndIcon();
    }
  });
});

// ========== MESSAGE EVENTS ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[SW] onMessage received:", message, "at", new Date().toISOString());
  try {
    if (message && message.type === 'init') {
      sendResponse({ ok: true, time: Date.now() });
      return true;
    }
    if (message === 'popup_open') {
      isPopupOpen = true;
      unseen = [];
      refreshStateAndIcon();
      sendInvalidateGizmo();
      chrome.downloads.search({ orderBy: ["-startTime"] }, (downloads) => {
        if (chrome.runtime.lastError) return;
        updateDownloadsState(downloads);
        chrome.runtime.sendMessage({ type: "downloads_state", data: downloads }, () => {});
      });
    }
    if (message === 'popup_closed') {
      isPopupOpen = false;
      refreshStateAndIcon();
    }
    if (typeof message === 'object' && message.type === 'get_downloads_state') {
      chrome.downloads.search({ orderBy: ["-startTime"] }, (downloads) => {
        if (chrome.runtime.lastError) return sendResponse([]);
        updateDownloadsState(downloads);
        sendResponse(downloads);
      });
      return true;
    }
    if (typeof message === 'object' && 'window' in message) {
      devicePixelRatio = message.window.devicePixelRatio;
      prefersColorSchemeDark = message.window.prefersColorSchemeDark;
      refreshStateAndIcon();
    }
  } catch (err) {
    console.error("[SW] Error in onMessage:", err);
  }
});
chrome.runtime.onConnect?.addListener((externalPort) => {
  externalPort.onDisconnect.addListener(() => {
    isPopupOpen = false;
    refreshStateAndIcon();
  });
  console.log("[SW] onConnect", externalPort);
});

// ========== ICON & POLLING LOGIC ==========
function updateDownloadsState(downloads) {
  downloadsState = {};
  downloads.forEach((item) => { downloadsState[item.id] = item; });
}
function refreshStateAndIcon() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  chrome.downloads.search({}, (allDownloads) => {
    updateDownloadsState(allDownloads);
    const inProgress = allDownloads.filter(
      d => d.state === "in_progress" && !d.paused && d.totalBytes > 0
    );
    if (inProgress.length > 0) {
      let progressItem = inProgress.reduce((latest, item) => {
        const end = new Date(item.estimatedEndTime || 0).getTime();
        const latestEnd = new Date(latest.estimatedEndTime || 0).getTime();
        return end > latestEnd ? item : latest;
      }, inProgress[0]);
      if (progressItem && progressItem.totalBytes > 0) {
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

// ========== GIZMO MESSAGING ==========
function sendShowGizmo() { sendMessageToActiveTab('show_gizmo'); }
function sendInvalidateGizmo() { sendMessageToActiveTab('invalidate_gizmo'); }
function sendMessageToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true, windowType: 'normal' }, (tabs) => {
    if (!tabs || !tabs.length) return;
    tabs.forEach((tab) => {
      if (tab && tab.url && tab.url.startsWith('http')) {
        try {
          chrome.tabs.sendMessage(tab.id, message, () => {});
        } catch (e) {}
      }
    });
  });
}

// ========== ICON DRAWING ==========
function getScale() { return devicePixelRatio < 2 ? 0.5 : 1; }
function getIconColor(state) {
  if (state === "inProgress") return "#FFBB00";
  if (state === "finished") return "#00CC00";
  return "#00286A";
}
function drawToolbarIcon(unseen, forceColor) {
  let iconColor = forceColor || getIconColor((unseen && unseen.length > 0) ? "finished" : "default");
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