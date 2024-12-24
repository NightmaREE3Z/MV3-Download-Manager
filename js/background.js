chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed and background script running.");
  chrome.downloads.setShelfEnabled(false);

  // Set the initial default icon
  chrome.action.setIcon({ path: chrome.runtime.getURL("icons/iconblue.png") });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.downloads.setShelfEnabled(false); // Ensure this runs on every browser startup
});

let animationTimer;
let isPopupOpen = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in background script:", message);

  if (message.type === "popup_open") {
    isPopupOpen = true;
    sendResponse({ status: "Popup opened successfully!" });
  } else if (message.type === "popup_close") {
    isPopupOpen = false;
    sendResponse({ status: "Popup closed" });
  } else {
    console.warn("Unhandled message type:", message.type);
  }

  // Keeps the service worker alive until `sendResponse` is called
  return true;
});

chrome.downloads.onCreated.addListener(downloadItem => {
  console.log("Download created:", downloadItem);

  // Block the native shelf for new downloads
  chrome.downloads.setShelfEnabled(false);

  flashIcon("inProgress"); // Set the icon to yellow for download in progress
});

chrome.downloads.onChanged.addListener(delta => {
  console.log("Download changed:", delta);

  if (delta.state && delta.state.current === "complete") {
    flashIcon("finished");
  } else if (delta.state && (delta.state.current === "interrupted" || delta.state.current === "cancelled")) {
    flashIcon("default");
  }

  if (delta.bytesReceived && delta.totalBytes) {
    const progress = delta.bytesReceived.current / delta.totalBytes.current;
    console.log(`Progress: ${progress * 100}%`); // Log the progress
    drawToolbarProgressIcon(progress);
  }

  try {
    if (delta.filename || delta.danger) {
      chrome.runtime.sendMessage({ type: "download_changed", data: delta }, response => {
        if (chrome.runtime.lastError) {
          console.warn("Error sending message:", chrome.runtime.lastError.message);
        }
      });
    }
  } catch (error) {
    console.error("Failed to send message:", error);
  }
});

chrome.downloads.onErased.addListener(downloadId => {
  console.log("Download erased:", downloadId);
  flashIcon("default");
});

function flashIcon(state) {
  let iconPath = "";

  if (state === "inProgress") {
    iconPath = "icons/iconyellow.png"; // Icon for download in progress
  } else if (state === "finished") {
    iconPath = "icons/icongreen.png"; // Icon for download finished
  } else {
    iconPath = "icons/iconblue.png"; // Default icon
  }

  console.log(`Setting icon to ${iconPath}`);
  chrome.action.setIcon({ path: chrome.runtime.getURL(iconPath) });

  // Clear animation if any
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
}

// Function to draw the toolbar icon with a progress bar
function drawToolbarProgressIcon(progress) {
  const canvas = document.createElement('canvas');
  const size = 38;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Ensure the base icon is fully loaded before drawing the progress bar
  const img = new Image();
  img.src = chrome.runtime.getURL('icons/iconyellow.png');
  img.onload = () => {
    ctx.drawImage(img, 0, 0, size, size);

    // Draw the progress bar
    ctx.fillStyle = 'green';
    ctx.fillRect(0, size - 4, size * progress, 4);

    // Set the icon
    chrome.action.setIcon({
      imageData: ctx.getImageData(0, 0, size, size)
    });
  };

  img.onerror = (err) => {
    console.error('Failed to load icon image', err);
  };
}