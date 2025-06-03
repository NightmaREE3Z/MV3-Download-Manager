// MV3 Download Manager background script (service worker) - event-driven, no polling, robust

let canvas = new OffscreenCanvas(38, 38);
let ctx = canvas.getContext('2d', { willReadFrequently: true });

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;
let downloadsState = {};

function hideNativeDownloadBar() {
  if (chrome?.downloads?.setUiOptions) {
    chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});
  }
}

// Call on startup and after any event that could restart the worker
function initialize() {
  hideNativeDownloadBar();
  setDefaultBlueIcon();
  refreshStateAndIcon();
}

chrome.runtime.onStartup?.addListener(() => {
  initialize();
});
initialize();

chrome.runtime.onInstalled?.addListener(() => {
  initialize();
});

// Event: user opens popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === 'popup_open') {
    isPopupOpen = true;
    unseen = [];
    refreshStateAndIcon();
    sendInvalidateGizmo();
    hideNativeDownloadBar();
    chrome.downloads.search({ orderBy: ["-startTime"] }, (downloads) => {
      if (chrome.runtime.lastError) return;
      updateDownloadsState(downloads);
      chrome.runtime.sendMessage({ type: "downloads_state", data: downloads }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    });
  }
  if (message === 'popup_closed') {
    isPopupOpen = false;
    refreshStateAndIcon();
    hideNativeDownloadBar();
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
    hideNativeDownloadBar();
  }
});

chrome.runtime.onConnect?.addListener((externalPort) => {
  externalPort.onDisconnect.addListener(() => {
    isPopupOpen = false;
    refreshStateAndIcon();
    hideNativeDownloadBar();
  });
});

chrome.downloads.onCreated.addListener((item) => {
  downloadsState[item.id] = item;
  hideNativeDownloadBar();
  refreshStateAndIcon();
});

chrome.downloads.onChanged.addListener((event) => {
  hideNativeDownloadBar();
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
  if (event.filename && event.filename.previous === '') sendShowGizmo();
  if (event.danger && event.danger.current != 'accepted') {
    isUnsafe = true;
  }
  if (event.danger && event.danger.current === 'accepted') {
    isUnsafe = false;
  }
  refreshStateAndIcon();
});

chrome.downloads.onErased.addListener((id) => {
  delete downloadsState[id];
  hideNativeDownloadBar();
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

function updateDownloadsState(downloads) {
  downloadsState = {};
  downloads.forEach((item) => {
    downloadsState[item.id] = item;
  });
}

// Only update icon and state on events, not polling
function refreshStateAndIcon() {
  hideNativeDownloadBar();
  chrome.downloads.search({}, (allDownloads) => {
    updateDownloadsState(allDownloads);
    const inProgressItems = allDownloads.filter(
      d => d.state === "in_progress" && !d.paused && d.totalBytes > 0
    );
    if (inProgressItems.length) {
      // Show progress icon for the download with latest estimatedEndTime
      let latestEndTime = 0;
      let progressItem = null;
      inProgressItems.forEach((item) => {
        const endTime = new Date(item.estimatedEndTime || 0).getTime();
        if (endTime > latestEndTime) {
          latestEndTime = endTime;
          progressItem = item;
        }
      });
      if (progressItem && progressItem.totalBytes > 0) {
        const progress = progressItem.bytesReceived / progressItem.totalBytes;
        if (progress > 0 && progress < 1) {
          drawToolbarProgressIcon(progress);
          return;
        }
      }
    }
    const someComplete = allDownloads.some(item => item.state === "complete" && item.exists !== false);
    if (someComplete) {
      drawToolbarIcon(unseen, "#00CC00");
      return;
    }
    setDefaultBlueIcon();
  });
}

function setDefaultBlueIcon() {
  drawToolbarIcon([], "#00286A");
}

function sendShowGizmo() {
  sendMessageToActiveTab('show_gizmo');
}
function sendInvalidateGizmo() {
  sendMessageToActiveTab('invalidate_gizmo');
}
function sendMessageToActiveTab(message) {
  const current = {
    active: true,
    currentWindow: true,
    windowType: 'normal',
  };
  chrome.tabs.query(current, (tabs) => {
    if (!tabs || !tabs.length) return;
    tabs.forEach((tab) => {
      if (tab && tab.url && tab.url.startsWith('http')) {
        try {
          chrome.tabs.sendMessage(tab.id, message, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        } catch (e) {}
      }
    });
  });
}

function getScale() {
  return devicePixelRatio < 2 ? 0.5 : 1;
}
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