// MV3 Download Manager background script - robust icon drawing

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let timer = null;
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;
let downloadsState = {};

// Utility: Get a fresh canvas/context each time
function getCanvasContext() {
  const canvas = new OffscreenCanvas(38, 38);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

// Initial icon
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => forceSyncIcon());
forceSyncIcon();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === 'popup_open') {
    isPopupOpen = true;
    unseen = [];
    refresh();
    sendInvalidateGizmo();
    chrome.downloads.search({ orderBy: ["-startTime"] }, (downloads) => {
      if (chrome.runtime.lastError) return;
      updateDownloadsState(downloads);
      // Defensive: handle error for sendMessage
      chrome.runtime.sendMessage({ type: "downloads_state", data: downloads }, () => {
        if (chrome.runtime.lastError) {
          // Silently ignore error; means receiver (popup) closed or not listening
        }
      });
    });
  }
  if (message === 'popup_closed') {
    isPopupOpen = false;
    refresh();
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
    refresh();
  }
});

if (chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((externalPort) => {
    externalPort.onDisconnect.addListener(() => {
      isPopupOpen = false;
      refresh();
    });
  });
}

// Download event listeners
chrome.downloads.onCreated.addListener((item) => {
  downloadsState[item.id] = item;
  refresh();
});
chrome.downloads.onChanged.addListener((event) => {
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
  if (event.state || event.paused) refresh();
  if (event.filename && event.filename.previous === '') sendShowGizmo();
  if (event.danger && event.danger.current != 'accepted') {
    isUnsafe = true;
    refresh();
  }
  if (event.danger && event.danger.current === 'accepted') {
    isUnsafe = false;
    refresh();
  }
});
chrome.downloads.onErased.addListener((id) => {
  delete downloadsState[id];
  chrome.downloads.search({}, (allDownloads) => {
    if (allDownloads.length === 0) {
      unseen = [];
      setDefaultBlueIcon();
      refresh();
    }
  });
});

function updateDownloadsState(downloads) {
  downloadsState = {};
  downloads.forEach((item) => {
    downloadsState[item.id] = item;
  });
}

// Defensive: Always sync icon state from downloads
function forceSyncIcon() {
  chrome.downloads.search({}, (allDownloads) => {
    if (chrome.runtime.lastError) return;
    if (!allDownloads || allDownloads.length === 0) {
      setDefaultBlueIcon();
      return;
    }
    let active = allDownloads.some(d => d.state === "in_progress");
    let dangerous = allDownloads.some(d => d.danger && d.danger !== "safe" && d.danger !== "accepted");
    if (dangerous) {
      setDangerIcon();
    } else if (active) {
      setActiveIcon();
    } else {
      setDefaultBlueIcon();
    }
  });
}

function setActiveIcon() {
  drawIcon({ progress: true, danger: false });
}
function setDangerIcon() {
  drawIcon({ progress: false, danger: true });
}
function setDefaultBlueIcon() {
  drawIcon({ progress: false, danger: false });
}

function drawIcon({ progress, danger }) {
  const { canvas, ctx } = getCanvasContext();
  ctx.clearRect(0, 0, 38, 38);

  // Background
  ctx.beginPath();
  ctx.arc(19, 19, 19, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = danger ? "#c00" : "#0b57d0";
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Arrow
  ctx.beginPath();
  ctx.moveTo(19, 7);
  ctx.lineTo(19, 26);
  ctx.moveTo(13, 20);
  ctx.lineTo(19, 26);
  ctx.lineTo(25, 20);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.stroke();

  // Progress ring
  if (progress) {
    ctx.beginPath();
    ctx.arc(19, 19, 16, 0, 1.5 * Math.PI);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.2;
    ctx.setLineDash([2,3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Danger exclamation
  if (danger) {
    ctx.beginPath();
    ctx.arc(19, 19, 11, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(19, 13);
    ctx.lineTo(19, 22);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(19, 26, 1.7, 0, 2 * Math.PI);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }

  // Set icon
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  chrome.action.setIcon({ imageData: { "38": imageData } });
}

function refresh() {
  chrome.downloads.search({}, (allDownloads) => {
    updateDownloadsState(allDownloads);
    const inProgressItems = allDownloads.filter(
      d => d.state === "in_progress" && !d.paused && d.totalBytes > 0
    );
    if (inProgressItems.length) {
      if (timer) clearInterval(timer);
      timer = setInterval(refresh, 1000);
      let longestItem = { estimatedEndTime: 0 };
      inProgressItems.forEach((item) => {
        const estimatedEndTime = new Date(item.estimatedEndTime);
        const longestEndTime = new Date(longestItem.estimatedEndTime);
        if (estimatedEndTime > longestEndTime) longestItem = item;
      });
      const progress =
        longestItem.totalBytes > 0
          ? longestItem.bytesReceived / longestItem.totalBytes
          : 0;
      if (progress > 0 && progress < 1) {
        drawToolbarProgressIcon(progress);
        return;
      }
    } else {
      if (timer) {
        clearInterval(timer);
        timer = null;
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
            if (chrome.runtime.lastError) {
              // Optionally log: console.warn('SendMessage failed:', chrome.runtime.lastError.message);
              // Silently ignore to avoid extension errors for users.
              return;
            }
          });
        } catch (e) {
          // Defensive: shouldn't happen, but don't crash extension
        }
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
  // Always use a new context!
  const { canvas, ctx } = getCanvasContext();
  let iconColor = forceColor || getIconColor((unseen && unseen.length > 0) ? "finished" : "default");
  const scale = getScale();
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
  const size = 38 * scale;
  const icon = { imageData: {} };
  try {
    icon.imageData[size] = ctx.getImageData(0, 0, size, size);
    chrome.action.setIcon(icon);
  } catch (e) {}
}

function drawToolbarProgressIcon(progress) {
  const { canvas, ctx } = getCanvasContext();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 38, 38);

  // Background
  ctx.beginPath();
  ctx.arc(19, 19, 19, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = "#0b57d0";
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Progress arc
  ctx.beginPath();
  ctx.arc(19, 19, 17, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * progress, false);
  ctx.strokeStyle = "#FFD600";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Arrow
  ctx.beginPath();
  ctx.moveTo(19, 7);
  ctx.lineTo(19, 26);
  ctx.moveTo(13, 20);
  ctx.lineTo(19, 26);
  ctx.lineTo(25, 20);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.stroke();

  // Set icon
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  chrome.action.setIcon({ imageData: { "38": imageData } });
}