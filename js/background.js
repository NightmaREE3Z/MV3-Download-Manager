let canvas = new OffscreenCanvas(38, 38);
let ctx = canvas.getContext('2d', { willReadFrequently: true });

chrome.downloads.setUiOptions({ enabled: false }).catch(() => {});

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let timer = null;
let devicePixelRatio = 1;
let prefersColorSchemeDark = true;

// Track download state for MV3 popup sync
let downloadsState = {};

chrome.runtime.onStartup?.addListener(() => setDefaultBlueIcon());
setDefaultBlueIcon();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === 'popup_open') {
    isPopupOpen = true;
    unseen = [];
    refresh();
    sendInvalidateGizmo();
    chrome.downloads.search({ orderBy: ["-startTime"] }, (downloads) => {
      if (chrome.runtime.lastError) return;
      // Update downloadsState for MV3 safety
      updateDownloadsState(downloads);
      chrome.runtime.sendMessage({ type: "downloads_state", data: downloads });
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

chrome.runtime.onConnect.addListener((externalPort) => {
  externalPort.onDisconnect.addListener(() => {
    isPopupOpen = false;
    refresh();
  });
});

chrome.downloads.onCreated.addListener((item) => {
  downloadsState[item.id] = item;
  refresh();
});
chrome.downloads.onChanged.addListener((event) => {
  // Partial update for MV3 download state
  if (downloadsState[event.id]) {
    Object.keys(event).forEach((key) => {
      // For delta style objects: {state: {current: "...", previous: "..."}} etc.
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
            }
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