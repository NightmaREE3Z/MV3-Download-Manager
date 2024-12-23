// background.js

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);
});

chrome.downloads.setShelfEnabled(false);

let isPopupOpen = false;
let isUnsafe = false;
let unseen = [];
let timer;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background script:", message);

  if (message.type === "popup_open") {
    isPopupOpen = true;
    unseen = [];
    refresh();
    sendInvalidateGizmo();
    sendResponse({ status: "Popup opened" });
  }

  // Keeps the service worker alive until `sendResponse` is called
  return true;
});

chrome.downloads.onCreated.addListener(downloadItem => {
  console.log("Download created:", downloadItem);

  // Check if the download is already being handled to avoid loops
  chrome.downloads.search({ url: downloadItem.url }, (results) => {
    if (results.length > 1) {
      console.log("Download already being handled:", downloadItem.url);
      return;
    }

    // Cancel the default download
    chrome.downloads.cancel(downloadItem.id, () => {
      // Handle the download within the extension
      handleDownload(downloadItem);
    });
  });
});

function handleDownload(downloadItem) {
  flashIcon();

  chrome.downloads.download({ url: downloadItem.url }, (newDownloadId) => {
    if (chrome.runtime.lastError) {
      console.warn("Error initiating download:", chrome.runtime.lastError.message);
    } else {
      console.log("Download initiated with ID:", newDownloadId);
    }
  });

  chrome.runtime.sendMessage({ type: "download_created", data: downloadItem }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Error sending message:", chrome.runtime.lastError.message);
    }
  });
}

chrome.downloads.onChanged.addListener(delta => {
  console.log("Download changed:", delta);

  // Flash the icon when a download is completed
  if (delta.state && delta.state.current === 'complete') {
    flashIcon();
  }

  // Sends a message to other parts of the extension about download updates
  if (delta.filename || delta.danger) {
    chrome.runtime.sendMessage({ type: "download_changed", data: delta }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("Error sending message:", chrome.runtime.lastError.message);
      }
    });
  }
});

function flashIcon() {
  // Change the icon to icon32.png
  chrome.action.setIcon({ path: "img/icons/icon32.png" }, () => {
    // Restore the icon to icon48.png after a short delay
    setTimeout(() => {
      chrome.action.setIcon({ path: "img/icons/icon48.png" });
    }, 1000); // Change back after 1 second
  });
}

function refresh() {
  chrome.downloads.search(
    {
      state: "in_progress",
      paused: false
    },
    refreshToolbarIcon
  );
}

function refreshToolbarIcon(items) {
  if (!items.length) {
    clearInterval(timer);
    timer = null;
    drawToolbarIcon(unseen);
    return;
  }

  if (!timer) {
    timer = setInterval(refresh, 500);
  }

  let longestItem = {
    estimatedEndTime: 0
  };
  items.forEach(item => {
    estimatedEndTime = new Date(item.estimatedEndTime);
    longestEndTime = new Date(longestItem.estimatedEndTime);
    if (estimatedEndTime > longestEndTime) {
      longestItem = item;
    }
  });

  const progress = longestItem.bytesReceived / longestItem.totalBytes;
  drawToolbarProgressIcon(progress);
}

function sendShowGizmo() {
  sendMessageToActiveTab("show_gizmo");
}

function sendInvalidateGizmo() {
  sendMessageToActiveTab("invalidate_gizmo");
}

function sendMessageToActiveTab(message) {
  const current = {
    active: true,
    currentWindow: true,
    windowType: "normal"
  };
  chrome.tabs.query(current, tabs => {
    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, message));
  });
}

let canvas = document.createElement("canvas");
canvas.width = 38;
canvas.height = 38;
let ctx = canvas.getContext("2d");
const scale = window.devicePixelRatio < 2 ? 0.5 : 1;
const size = 38 * scale;
ctx.scale(scale, scale);

function getColor(state) {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  let colorLight = "#dddddd";
  let colorDark = "#666666";

  if (state === "default") {
    return isDark ? colorLight : colorDark;
  }

  if (isUnsafe) {
    colorLight = "#d15353";
    colorDark = "#c62828";
  } else {
    colorLight = "#63ace5";
    colorDark = "#1198ff";
  }

  if (state === "active") {
    return isDark ? colorLight : colorDark;
  } else if (state === "in_progress") {
    return isDark ? colorLight + "80" : colorDark + "40";
  }
}

function drawToolbarIcon(unseen) {
  const color = unseen.length > 0 ? getColor("active") : getColor("default");

  ctx.clearRect(0, 0, 38, 38);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(20, 2);
  ctx.lineTo(20, 18);
  ctx.stroke();
  ctx.moveTo(0, 18);
  ctx.lineTo(38, 18);
  ctx.lineTo(20, 38);
  ctx.fill();

  const icon = { imageData: {} };
  icon.imageData[size] = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon(icon);
}

function drawToolbarProgressIcon(progress) {
  const width = progress * 38;

  ctx.clearRect(0, 0, 38, 38);
  ctx.lineWidth = 2;
  ctx.fillStyle = getColor("in_progress");
  ctx.fillRect(0, 28, 38, 12);
  ctx.fillStyle = getColor("active");
  ctx.fillRect(0, 28, width, 12);
  ctx.strokeStyle = getColor("active");
  ctx.fillStyle = getColor("active");
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(20, 14);
  ctx.stroke();
  ctx.moveTo(6, 10);
  ctx.lineTo(34, 10);
  ctx.lineTo(20, 24);
  ctx.fill();

  const icon = { imageData: {} };
  icon.imageData[size] = ctx.getImageData(0, 0, size, size);
  chrome.action.setIcon(icon);
}