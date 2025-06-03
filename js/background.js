// MV3 Download Manager background script – ultra-robust, verbose logging, best practices applied

// ========== VERBOSE LOGGING ==========
console.log("Service worker script loaded at", new Date().toISOString());

let canvas, ctx;
try {
  canvas = new OffscreenCanvas(38, 38);
  ctx = canvas.getContext('2d', { willReadFrequently: true });
} catch (e) {
  console.error("[SW] Canvas init error:", e);
}

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;
let downloadsState = {};
let pollTimer = null;

// ========== ERROR HANDLING ==========
self.addEventListener('error', function(e) {
  console.error('[SW] Uncaught error:', e.message, e);
});
self.addEventListener('unhandledrejection', function(e) {
  console.error('[SW] Unhandled rejection:', e.reason, e);
});

// ========== INITIALIZATION ==========
function initialize() {
  console.log("[SW] initialize() called at", new Date().toISOString());
  setDefaultBlueIcon();
  refreshStateAndIcon();
}
if (chrome && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(function() {
    console.log("[SW] onStartup event fired at", new Date().toISOString());
    initialize();
  });
}
if (chrome && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(function() {
    console.log("[SW] onInstalled event fired at", new Date().toISOString());
    initialize();
  });
}
initialize();

// ========== DOWNLOAD EVENTS ==========
if (chrome && chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(function(item) {
    console.log("[SW] downloads.onCreated", item);
    downloadsState[item.id] = item;
    refreshStateAndIcon();
  });
}
if (chrome && chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener(function(event) {
    console.log("[SW] downloads.onChanged", event);
    if (downloadsState[event.id]) {
      Object.keys(event).forEach(function(key) {
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
}
if (chrome && chrome.downloads && chrome.downloads.onErased) {
  chrome.downloads.onErased.addListener(function(id) {
    console.log("[SW] downloads.onErased", id);
    delete downloadsState[id];
    chrome.downloads.search({}, function(allDownloads) {
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

// ========== MESSAGE EVENTS ==========
if (chrome && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
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
        chrome.downloads.search({ orderBy: ["-startTime"] }, function(downloads) {
          if (chrome.runtime.lastError) return;
          updateDownloadsState(downloads);
          chrome.runtime.sendMessage({ type: "downloads_state", data: downloads }, function() {});
        });
      }
      if (message === 'popup_closed') {
        isPopupOpen = false;
        refreshStateAndIcon();
      }
      if (typeof message === 'object' && message.type === 'get_downloads_state') {
        chrome.downloads.search({ orderBy: ["-startTime"] }, function(downloads) {
          if (chrome.runtime.lastError) return sendResponse([]);
          updateDownloadsState(downloads);
          sendResponse(downloads);
        });
        return true;
      }
      if (typeof message === 'object' && message.window) {
        devicePixelRatio = message.window.devicePixelRatio;
        prefersColorSchemeDark = message.window.prefersColorSchemeDark;
        refreshStateAndIcon();
      }
    } catch (err) {
      console.error("[SW] Error in onMessage:", err);
    }
  });
}
if (chrome && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener(function(externalPort) {
    externalPort.onDisconnect.addListener(function() {
      isPopupOpen = false;
      refreshStateAndIcon();
    });
    console.log("[SW] onConnect", externalPort);
  });
}

// ========== ICON & POLLING LOGIC ==========
function updateDownloadsState(downloads) {
  downloadsState = {};
  downloads.forEach(function(item) { downloadsState[item.id] = item; });
}
function refreshStateAndIcon() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  chrome.downloads.search({}, function(allDownloads) {
    updateDownloadsState(allDownloads);
    var inProgress = allDownloads.filter(function(d) {
      return d.state === "in_progress" && !d.paused && d.totalBytes > 0;
    });
    if (inProgress.length > 0) {
      var progressItem = inProgress.reduce(function(latest, item) {
        var end = new Date(item.estimatedEndTime || 0).getTime();
        var latestEnd = new Date(latest.estimatedEndTime || 0).getTime();
        return end > latestEnd ? item : latest;
      }, inProgress[0]);
      if (progressItem && progressItem.totalBytes > 0) {
        var progress = progressItem.bytesReceived / progressItem.totalBytes;
        if (progress > 0 && progress < 1) {
          drawToolbarProgressIcon(progress);
          pollTimer = setInterval(refreshStateAndIcon, 1000);
          return;
        }
      }
    }
    if (allDownloads.some(function(item) { return item.state === "complete" && item.exists !== false; })) {
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
  chrome.tabs.query({ active: true, currentWindow: true, windowType: 'normal' }, function(tabs) {
    if (!tabs || !tabs.length) return;
    tabs.forEach(function(tab) {
      if (tab && tab.url && tab.url.indexOf('http') === 0) {
        try {
          chrome.tabs.sendMessage(tab.id, message, function() {});
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
  if (!ctx) return;
  var iconColor = forceColor || getIconColor((unseen && unseen.length > 0) ? "finished" : "default");
  var scale = getScale();
  var size = 38 * scale;
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
  var icon = { imageData: {} };
  icon.imageData[size] = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon(icon);
}
function drawToolbarProgressIcon(progress) {
  if (!ctx) return;
  var iconColor = getIconColor("inProgress");
  var scale = getScale();
  var size = 38 * scale;
  var width = progress * 38;
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
  var icon = { imageData: {} };
  icon.imageData[size] = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon(icon);
}